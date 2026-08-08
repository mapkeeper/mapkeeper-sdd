"""Routing-level checks: the published paths resolve and enforce their header contract.

The handler bodies arrive in T225 and T227~T234, so every contract route answers 501
for now. These checks pin the routing, the path parameter names and the header rules.
"""

from collections.abc import Iterator
from typing import Final

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from mapkeeper.main import app

PROPOSAL_ID: Final = "22222222-2222-4222-8222-222222222222"
GENERATION_ID: Final = "33333333-3333-4333-8333-333333333333"
SYNC_JOB_ID: Final = "66666666-6666-4666-8666-666666666666"
STORE_PROFILE_ID: Final = "11111111-1111-4111-8111-111111111111"

CREATE_PROPOSAL_BODY: Final = {
    "storeProfileId": STORE_PROFILE_ID,
    "recognizedText": "영업시간을 오후 8시까지로 바꿔줘",
    "locale": "ko-KR",
}
CREATE_GENERATION_BODY: Final = {
    "storeProfileId": STORE_PROFILE_ID,
    "briefText": "만두전골의 깊은 국물 맛을 강조하고 싶어요.",
    "seedKeywords": ["만두전골", "가족외식"],
}
DECLARED_ROUTES: Final = (
    ("post", "/api/v1/store-change-proposals", CREATE_PROPOSAL_BODY, None),
    (
        "patch",
        f"/api/v1/store-change-proposals/{PROPOSAL_ID}",
        {
            "changes": [
                {
                    "field": "representativeMenuName",
                    "currentValue": "아메리카노",
                    "proposedValue": "라테",
                }
            ]
        },
        None,
    ),
    ("post", f"/api/v1/store-change-proposals/{PROPOSAL_ID}/reject", None, None),
    ("post", f"/api/v1/store-change-proposals/{PROPOSAL_ID}/approve", None, "approve-1"),
    ("post", "/api/v1/seo/generations", CREATE_GENERATION_BODY, None),
    (
        "post",
        f"/api/v1/seo/generations/{GENERATION_ID}/regenerate",
        {"briefText": "다시 써줘", "seedKeywords": ["만두전골"]},
        None,
    ),
    ("post", f"/api/v1/seo/generations/{GENERATION_ID}/reject", None, None),
    ("post", f"/api/v1/seo/generations/{GENERATION_ID}/approve", None, "approve-2"),
    ("get", f"/api/v1/sync-jobs/{SYNC_JOB_ID}", None, None),
    ("post", f"/api/v1/sync-jobs/{SYNC_JOB_ID}/retry", None, None),
)
APPROVE_PATHS: Final = (
    f"/api/v1/store-change-proposals/{PROPOSAL_ID}/approve",
    f"/api/v1/seo/generations/{GENERATION_ID}/approve",
)


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Return a client for the assembled application."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.parametrize(("method", "path", "body", "key"), DECLARED_ROUTES)
def test_every_contract_route_resolves(
    client: TestClient,
    method: str,
    path: str,
    body: dict[str, object] | None,
    key: str | None,
) -> None:
    # Given: one endpoint of the published contract.
    headers = {"Idempotency-Key": key} if key else {}

    # When: it is called with a valid request.
    response = client.request(method, path, json=body, headers=headers)

    # Then: routing works and the missing implementation is reported honestly.
    assert response.status_code == status.HTTP_501_NOT_IMPLEMENTED


@pytest.mark.parametrize("path", APPROVE_PATHS)
def test_approval_without_an_idempotency_key_is_rejected(client: TestClient, path: str) -> None:
    # Given: an approval call that forgot the required header.

    # When: it is sent.
    response = client.post(path)

    # Then: the request never reaches the approval logic.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.parametrize("path", APPROVE_PATHS)
@pytest.mark.parametrize("key", ["with space", "with/slash", "a" * 129, ""])
def test_approval_rejects_an_idempotency_key_outside_the_contract(
    client: TestClient,
    path: str,
    key: str,
) -> None:
    # Given: a key using characters or a length the contract forbids.

    # When: the approval is attempted.
    response = client.post(path, headers={"Idempotency-Key": key})

    # Then: the key format is enforced at the API edge.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_a_malformed_path_id_is_rejected(client: TestClient) -> None:
    # Given: a path id that is not a UUID.

    # When: the status endpoint is called.
    response = client.get("/api/v1/sync-jobs/not-a-uuid")

    # Then: the path parameter is validated before any lookup.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_an_over_long_recognized_text_is_rejected(client: TestClient) -> None:
    # Given: a recognized sentence beyond the 500 character limit.
    body = {**CREATE_PROPOSAL_BODY, "recognizedText": "가" * 501}

    # When: the proposal is created.
    response = client.post("/api/v1/store-change-proposals", json=body)

    # Then: the contract limit is enforced by the API, not by the database.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_an_undefined_request_field_is_rejected(client: TestClient) -> None:
    # Given: a request carrying a field the contract does not define.
    body = {**CREATE_GENERATION_BODY, "draftIds": ["44444444-4444-4444-8444-444444444441"]}

    # When: the generation is requested.
    response = client.post("/api/v1/seo/generations", json=body)

    # Then: unknown fields are refused rather than silently ignored.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


def test_the_request_id_header_is_accepted(client: TestClient) -> None:
    # Given: a client supplying its own trace id.

    # When: any contract route is called with it.
    response = client.get(
        f"/api/v1/sync-jobs/{SYNC_JOB_ID}",
        headers={"X-Request-ID": "trace-1234"},
    )

    # Then: the header is accepted rather than rejected as undefined.
    assert response.status_code == status.HTTP_501_NOT_IMPLEMENTED


def test_undeclared_endpoints_do_not_exist(client: TestClient) -> None:
    # Given: endpoints the contract explicitly rules out.

    # When / Then: no per-draft route was invented.
    assert client.patch(f"/api/v1/seo/drafts/{GENERATION_ID}").status_code == (
        status.HTTP_404_NOT_FOUND
    )
