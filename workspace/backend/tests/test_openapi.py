from pathlib import Path
from typing import Final

import pytest

from mapkeeper.core.json_types import JsonObject
from mapkeeper.models.enums import ApiErrorCode, Platform, PlatformErrorCode
from mapkeeper.openapi import build_openapi, default_output_path, main, render_openapi
from tests.jsonassert import arr, number_of, obj, strings_of, text_of

CONTRACT_ENDPOINTS: Final[tuple[tuple[str, str, str], ...]] = (
    ("post", "/api/v1/store-change-proposals", "201"),
    ("patch", "/api/v1/store-change-proposals/{proposalId}", "200"),
    ("post", "/api/v1/store-change-proposals/{proposalId}/reject", "200"),
    ("post", "/api/v1/store-change-proposals/{proposalId}/approve", "202"),
    ("post", "/api/v1/seo/generations", "201"),
    ("post", "/api/v1/seo/generations/{generationId}/regenerate", "200"),
    ("post", "/api/v1/seo/generations/{generationId}/reject", "200"),
    ("post", "/api/v1/seo/generations/{generationId}/approve", "202"),
    ("get", "/api/v1/sync-jobs/{syncJobId}", "200"),
    ("post", "/api/v1/sync-jobs/{syncJobId}/retry", "202"),
    ("get", "/api/v1/store-profiles/{storeProfileId}/reviews/summary", "200"),
)
APPROVAL_ENDPOINTS: Final = (
    ("post", "/api/v1/store-change-proposals/{proposalId}/approve"),
    ("post", "/api/v1/seo/generations/{generationId}/approve"),
)
BODYLESS_ENDPOINTS: Final = (
    ("post", "/api/v1/store-change-proposals/{proposalId}/reject"),
    ("post", "/api/v1/store-change-proposals/{proposalId}/approve"),
    ("post", "/api/v1/seo/generations/{generationId}/reject"),
    ("post", "/api/v1/seo/generations/{generationId}/approve"),
    ("post", "/api/v1/sync-jobs/{syncJobId}/retry"),
)
CONTRACT_ERROR_STATUSES: Final = frozenset({"400", "404", "409", "422", "429", "500"})
IDEMPOTENCY_KEY_PATTERN: Final = r"^[A-Za-z0-9._:-]+$"


@pytest.fixture(scope="module")
def document() -> JsonObject:
    """Return the OpenAPI document the application serves."""
    return build_openapi()


def paths_of(document: JsonObject) -> JsonObject:
    """Return the path item map."""
    return obj(document["paths"])


def operation_of(document: JsonObject, method: str, path: str) -> JsonObject:
    """Return one operation, failing with a readable message when it is absent."""
    paths = paths_of(document)
    assert path in paths, f"{path} is missing from the contract"
    operations = obj(paths[path])
    assert method in operations, f"{method.upper()} {path} is missing from the contract"
    return obj(operations[method])


def schema_of(document: JsonObject, name: str) -> JsonObject:
    """Return one component schema, failing with a readable message when it is absent."""
    schemas = obj(obj(document["components"])["schemas"])
    assert name in schemas, f"{name} is missing from the contract"
    return obj(schemas[name])


def properties_of(document: JsonObject, name: str) -> JsonObject:
    """Return the properties of one component schema."""
    return obj(schema_of(document, name)["properties"])


def parameters_of(operation: JsonObject) -> list[JsonObject]:
    """Return the declared parameters of one operation."""
    return [obj(parameter) for parameter in arr(operation.get("parameters", []))]


def test_the_contract_publishes_the_agreed_endpoints(document: JsonObject) -> None:
    # Given: the published OpenAPI document.
    paths = paths_of(document)

    # When: the API paths are separated from the operational health probe.
    api_operations = {
        (method, path)
        for path, operations in paths.items()
        for method in obj(operations)
        if path.startswith("/api/v1")
    }

    # Then: only the endpoints of the v0.2 contract are exposed.
    assert api_operations == {(method, path) for method, path, _ in CONTRACT_ENDPOINTS}


@pytest.mark.parametrize(("method", "path", "success_status"), CONTRACT_ENDPOINTS)
def test_each_endpoint_declares_its_agreed_success_status(
    document: JsonObject,
    method: str,
    path: str,
    success_status: str,
) -> None:
    # Given: one endpoint of the contract.
    responses = obj(operation_of(document, method, path)["responses"])

    # When / Then: it documents exactly the success code the contract fixes.
    assert [code for code in responses if code.startswith("2")] == [success_status]


@pytest.mark.parametrize(("method", "path", "success_status"), CONTRACT_ENDPOINTS)
def test_every_endpoint_documents_the_contract_error_codes(
    document: JsonObject,
    method: str,
    path: str,
    success_status: str,
) -> None:
    # Given: one endpoint of the contract.
    documented = set(obj(operation_of(document, method, path)["responses"]))

    # When: the documented failures are compared with the contract's error table.
    expected = {"400", "422", "429", "500"}
    if "{" in path:
        expected.add("404")

    # Then: every failure a client must handle is described and nothing else is invented.
    assert expected <= documented
    assert documented <= {success_status} | CONTRACT_ERROR_STATUSES


def test_reject_endpoints_exist_for_both_use_cases(document: JsonObject) -> None:
    # Given: the published document.
    paths = paths_of(document)

    # When / Then: UC1 and UC2 can both be turned down without approving.
    assert "/api/v1/store-change-proposals/{proposalId}/reject" in paths
    assert "/api/v1/seo/generations/{generationId}/reject" in paths


@pytest.mark.parametrize(("method", "path"), APPROVAL_ENDPOINTS)
def test_approval_endpoints_require_a_constrained_idempotency_key(
    document: JsonObject,
    method: str,
    path: str,
) -> None:
    # Given: an approval endpoint.
    parameters = parameters_of(operation_of(document, method, path))

    # When: its Idempotency-Key header is located.
    headers = [
        parameter
        for parameter in parameters
        if parameter["in"] == "header" and parameter["name"] == "Idempotency-Key"
    ]

    # Then: it is mandatory and carries the contract's character and length limits.
    assert len(headers) == 1
    schema = obj(headers[0]["schema"])
    assert headers[0]["required"] is True
    assert number_of(schema["minLength"]) == 1
    assert number_of(schema["maxLength"]) == 128
    assert text_of(schema["pattern"]) == IDEMPOTENCY_KEY_PATTERN


def test_only_approval_endpoints_require_an_idempotency_key(document: JsonObject) -> None:
    # Given: every contract endpoint.
    required_on = {
        (method, path)
        for method, path, _ in CONTRACT_ENDPOINTS
        for parameter in parameters_of(operation_of(document, method, path))
        if parameter["name"] == "Idempotency-Key" and parameter["required"] is True
    }

    # When / Then: retry and read endpoints do not demand one.
    assert required_on == set(APPROVAL_ENDPOINTS)


@pytest.mark.parametrize(
    ("method", "path"), [(method, path) for method, path, _ in CONTRACT_ENDPOINTS]
)
def test_every_endpoint_publishes_the_optional_request_id_header(
    document: JsonObject,
    method: str,
    path: str,
) -> None:
    # Given: one endpoint of the contract.
    parameters = parameters_of(operation_of(document, method, path))

    # When: the trace header is located.
    headers = [parameter for parameter in parameters if parameter["name"] == "X-Request-ID"]

    # Then: clients may send one, and the server fills it in when they do not.
    assert len(headers) == 1
    assert headers[0]["required"] is False


@pytest.mark.parametrize(
    ("schema_name", "field", "limit", "value"),
    [
        ("CreateStoreChangeProposalRequest", "recognizedText", "maxLength", 500),
        ("StoreChangeProposalResponse", "recognizedTextMasked", "maxLength", 500),
        ("RepresentativeMenuNameChange", "proposedValue", "maxLength", 50),
        ("RepresentativeMenuNameChange", "currentValue", "maxLength", 50),
        ("CreateContentGenerationRequest", "briefText", "maxLength", 500),
        ("CreateContentGenerationRequest", "seedKeywords", "minItems", 1),
        ("CreateContentGenerationRequest", "seedKeywords", "maxItems", 5),
        ("RegenerateContentGenerationRequest", "seedKeywords", "maxItems", 5),
        ("PlatformContentResult", "draftText", "maxLength", 750),
        ("PlatformContentResult", "keywords", "minItems", 1),
        ("PlatformContentResult", "keywords", "maxItems", 10),
    ],
)
def test_input_limits_reach_the_published_contract(
    document: JsonObject,
    schema_name: str,
    field: str,
    limit: str,
    value: int,
) -> None:
    # Given: one limit fixed by the API Contract's input table.
    definition = obj(properties_of(document, schema_name)[field])

    # When / Then: the frontend can read it straight from the contract.
    assert number_of(definition[limit]) == value


def test_source_review_ids_are_capped_at_ten(document: JsonObject) -> None:
    # Given: the optional review references of a generation.
    definition = obj(properties_of(document, "CreateContentGenerationRequest")["sourceReviewIds"])

    # When: the array variant of the optional field is located.
    variants = [obj(variant) for variant in arr(definition["anyOf"])]
    arrays = [variant for variant in variants if variant.get("type") == "array"]

    # Then: at most ten reviews may be referenced.
    assert len(arrays) == 1
    assert number_of(arrays[0]["maxItems"]) == 10


@pytest.mark.parametrize(
    ("schema_name", "field"),
    [
        ("CreateContentGenerationRequest", "seedKeywords"),
        ("PlatformContentResult", "keywords"),
    ],
)
def test_every_keyword_is_capped_at_thirty_characters(
    document: JsonObject,
    schema_name: str,
    field: str,
) -> None:
    # Given: one keyword array of the contract.
    items = obj(obj(properties_of(document, schema_name)[field])["items"])

    # When / Then: each single keyword carries the same length limit.
    assert number_of(items["minLength"]) == 1
    assert number_of(items["maxLength"]) == 30


def test_attempt_count_is_published_with_its_retry_ceiling(document: JsonObject) -> None:
    # Given: the per-platform task status.
    definition = obj(properties_of(document, "PlatformTaskStatus")["attemptCount"])

    # When / Then: the frontend knows a platform is tried at most three times.
    assert number_of(definition["minimum"]) == 0
    assert number_of(definition["maximum"]) == 3


def test_the_error_envelope_lists_every_api_error_code(document: JsonObject) -> None:
    # Given: the error code enum published with the contract.
    published = strings_of(schema_of(document, "ApiErrorCode")["enum"])

    # When / Then: it matches the API Contract error table exactly.
    assert published == [code.value for code in ApiErrorCode]


def test_platform_task_errors_publish_their_own_code_set(document: JsonObject) -> None:
    # Given: the per-platform error code enum.
    published = strings_of(schema_of(document, "PlatformErrorCode")["enum"])

    # When / Then: platform failures never reuse the MapKeeper API error codes.
    assert published == [code.value for code in PlatformErrorCode]
    assert not set(published) & {code.value for code in ApiErrorCode}


def test_partial_success_is_published_only_for_the_job(document: JsonObject) -> None:
    # Given: the two status enums exposed by the status endpoint.
    job = strings_of(schema_of(document, "SyncJobStatus")["enum"])
    task = strings_of(schema_of(document, "PlatformSyncTaskStatus")["enum"])

    # When / Then: PARTIAL_SUCCESS aggregates platforms and never describes one.
    assert "PARTIAL_SUCCESS" in job
    assert "PARTIAL_SUCCESS" not in task


def test_platform_values_stay_lowercase(document: JsonObject) -> None:
    # Given: the platform enum shared by every schema.
    published = strings_of(schema_of(document, "Platform")["enum"])

    # When / Then: the frontend, the API and the database use the same spelling.
    assert published == [platform.value for platform in Platform]
    assert published == ["google", "naver", "kakao"]


def test_no_schema_offers_per_draft_selection(document: JsonObject) -> None:
    # Given: every published schema.
    schemas = obj(obj(document["components"])["schemas"])

    # When: schemas carrying a per-draft selection field are collected.
    carrying = [
        name
        for name, definition in schemas.items()
        if "draftIds" in obj(obj(definition).get("properties", {}))
    ]

    # Then: UC2 is approved as a whole generation, never draft by draft.
    assert carrying == []


@pytest.mark.parametrize(("method", "path"), BODYLESS_ENDPOINTS)
def test_reject_approve_and_retry_take_no_request_body(
    document: JsonObject,
    method: str,
    path: str,
) -> None:
    # Given: an endpoint the contract defines as bodyless.
    operation = operation_of(document, method, path)

    # When / Then: it declares no request body at all.
    assert "requestBody" not in operation


@pytest.mark.parametrize(
    "schema_name",
    [
        "CreateStoreChangeProposalRequest",
        "PatchStoreChangeProposalRequest",
        "CreateContentGenerationRequest",
        "RegenerateContentGenerationRequest",
    ],
)
def test_undefined_request_fields_are_rejected(document: JsonObject, schema_name: str) -> None:
    # Given: one request schema of the contract.
    definition = schema_of(document, schema_name)

    # When / Then: unknown fields are refused rather than silently ignored.
    assert definition["additionalProperties"] is False


def test_the_committed_openapi_file_is_up_to_date() -> None:
    # Given: the contract file the frontend consumes.
    path = default_output_path()
    assert path.is_file(), "openapi.json is missing; run python -m mapkeeper.openapi"

    # When / Then: it matches what the application currently serves.
    assert path.read_text(encoding="utf-8") == render_openapi(), (
        "openapi.json is stale; run python -m mapkeeper.openapi"
    )


def test_regenerating_the_contract_reproduces_the_committed_file(tmp_path: Path) -> None:
    # Given: a fresh output location.
    target = tmp_path / "openapi.json"

    # When: the export command runs.
    main(target)

    # Then: it writes exactly what the committed contract holds.
    assert target.read_text(encoding="utf-8") == default_output_path().read_text(encoding="utf-8")
