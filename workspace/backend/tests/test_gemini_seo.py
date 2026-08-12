"""The Gemini UC2 generator, checked without a network or an API key."""

import json
from collections.abc import Callable
from typing import Final
from uuid import uuid4

import httpx
import pytest

from mapkeeper.adapters.gemini_seo import (
    GENERATION_FAILED_MESSAGE,
    GeminiGenerationError,
    GeminiSEOGenerator,
    HttpGeminiModelClient,
    build_prompt,
    parse_results,
)
from mapkeeper.adapters.seo_generation import DeterministicSEOStub, get_seo_generator
from mapkeeper.api.schemas.seo import ContentGenerationInput
from mapkeeper.core.config import get_settings
from mapkeeper.models import ContentPurpose, Platform, StoreProfile

BRIEF: Final = "만두전골의 깊은 국물 맛을 강조하고 싶어요."


def make_profile() -> StoreProfile:
    """Return a store profile carrying no customer data."""
    return StoreProfile(
        id=uuid4(),
        store_name="만두전골 하우스",
        public_address="서울특별시 관악구 시연로 12",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )


def make_input() -> ContentGenerationInput:
    """Return valid common UC2 input."""
    return ContentGenerationInput(
        brief_text=BRIEF,
        seed_keywords=("만두전골", "가족외식"),
        source_review_ids=None,
    )


def model_output(**overrides: object) -> str:
    """Render a well-formed model response, with optional per-platform overrides."""
    results = [
        {
            "platform": platform,
            "draftText": f"{platform}용 소개글",
            "keywords": ["만두전골", "가족외식"],
            "contentRules": ["team-defined-rule"],
            **overrides,
        }
        for platform in ("google", "naver", "kakao")
    ]
    return json.dumps(results, ensure_ascii=False)


class ScriptedClient:
    """Model client that returns a fixed response and records the prompt it saw."""

    def __init__(self, response: str) -> None:
        """Store the response this client will return."""
        self.response: str = response
        self.prompt: str | None = None

    async def generate(self, prompt: str) -> str:
        """Record the prompt and return the scripted response."""
        self.prompt = prompt
        return self.response


# --- prompt -------------------------------------------------------------------


def test_the_prompt_asks_for_all_three_platforms_at_once() -> None:
    # Given: one common input and a store profile.

    # When: the prompt is built.
    prompt = build_prompt(make_input(), make_profile(), ())

    # Then: a single request covers every platform, which the free tier needs.
    for platform in Platform:
        assert platform.value in prompt


def test_the_prompt_states_the_contract_limits() -> None:
    # Given: the prompt sent to the model.
    prompt = build_prompt(make_input(), make_profile(), ())

    # When / Then: the model is told the limits its output must satisfy.
    assert "750" in prompt
    assert "10" in prompt
    assert "30" in prompt


def test_the_prompt_carries_the_user_input_and_store_facts() -> None:
    # Given: the prompt.
    prompt = build_prompt(make_input(), make_profile(), ())

    # When / Then: it can only describe what the request supplied.
    assert BRIEF in prompt
    assert "만두전골 하우스" in prompt
    assert "가족외식" in prompt


def test_the_news_prompt_selects_announcement_purpose() -> None:
    # Given: a generation explicitly requested for a time-bound store update.
    content_input = make_input().model_copy(update={"purpose": ContentPurpose.NEWS})

    # When: the prompt is built.
    prompt = build_prompt(content_input, make_profile(), ())

    # Then: the machine-readable purpose is routed to the news generation branch.
    assert "작성 목적: NEWS" in prompt
    assert "소개글처럼 일반적인 매장 홍보 문구를 만들지 않는다." in prompt


def test_the_prompt_includes_masked_reviews_only_when_supplied() -> None:
    # Given: a masked review and an empty set.
    with_review = build_prompt(make_input(), make_profile(), ("[고객명]님 국물이 깊어요.",))
    without = build_prompt(make_input(), make_profile(), ())

    # When / Then: only masked text reaches the prompt, and nothing is invented.
    assert "[고객명]" in with_review
    assert "참고 리뷰" in with_review
    assert "참고 리뷰" not in without


def test_the_prompt_caps_how_many_reviews_are_sent() -> None:
    # Given: more reviews than the contract allows a generation to reference.
    reviews = tuple(f"리뷰 {index}" for index in range(20))

    # When: the prompt is built.
    prompt = build_prompt(make_input(), make_profile(), reviews)

    # Then: at most ten reach the model.
    assert "리뷰 9" in prompt
    assert "리뷰 10" not in prompt


# --- response validation ------------------------------------------------------


@pytest.mark.asyncio
async def test_a_well_formed_response_becomes_three_results() -> None:
    # Given: a model that answers in the requested shape.
    generator = GeminiSEOGenerator(ScriptedClient(model_output()))

    # When: a generation runs.
    results = await generator.generate(make_input(), make_profile(), ())

    # Then: exactly one result per platform, each with an id MapKeeper owns.
    assert {result.platform for result in results} == set(Platform)
    assert len({result.draft_id for result in results}) == 3


@pytest.mark.asyncio
async def test_news_stub_does_not_append_the_representative_menu() -> None:
    # Given: a deterministic offline generation requested for a store update.
    content_input = make_input().model_copy(update={"purpose": ContentPurpose.NEWS})

    # When: the configured-key fallback generates drafts.
    results = await DeterministicSEOStub().generate(content_input, make_profile(), ())

    # Then: the news draft stays focused on the supplied announcement.
    assert all("대표 메뉴는" not in result.draft_text for result in results)
    assert all(BRIEF in result.draft_text for result in results)


@pytest.mark.asyncio
async def test_a_response_wrapped_in_a_code_fence_is_accepted() -> None:
    # Given: a model that wrapped its JSON in a markdown fence.
    fenced = f"```json\n{model_output()}\n```"

    # When: the generation runs.
    results = await GeminiSEOGenerator(ScriptedClient(fenced)).generate(
        make_input(), make_profile(), ()
    )

    # Then: a common formatting habit does not fail the request.
    assert len(results) == 3


@pytest.mark.parametrize(
    "raw",
    [
        "not json at all",
        '{"platform": "google"}',
        "[]",
        json.dumps([{"platform": "google", "draftText": "x", "keywords": ["k"]}]),
    ],
)
def test_output_that_breaks_the_contract_is_refused(raw: str) -> None:
    # Given: model output that is malformed, incomplete or the wrong shape.

    # When / Then: it never reaches the database.
    with pytest.raises(GeminiGenerationError):
        _ = parse_results(raw)


def test_output_over_the_length_limit_is_refused() -> None:
    # Given: a model that ignored the 750 character limit.
    raw = model_output(draftText="가" * 751)

    # When / Then: the published schema decides, not the model.
    with pytest.raises(GeminiGenerationError):
        _ = parse_results(raw)


def test_output_with_too_many_keywords_is_refused() -> None:
    # Given: a model that returned eleven keywords.
    raw = model_output(keywords=[f"키워드{index}" for index in range(11)])

    # When / Then: the keyword ceiling is enforced on the way in.
    with pytest.raises(GeminiGenerationError):
        _ = parse_results(raw)


def test_output_missing_a_platform_is_refused() -> None:
    # Given: a model that only answered for two platforms.
    raw = json.dumps(
        [
            {
                "platform": platform,
                "draftText": "소개글",
                "keywords": ["만두전골"],
                "contentRules": ["rule"],
            }
            for platform in ("google", "naver")
        ]
    )

    # When / Then: approving all three would not be equivalent, so it is refused.
    with pytest.raises(GeminiGenerationError):
        _ = parse_results(raw)


def test_keywords_are_normalized_like_user_input() -> None:
    # Given: a model that returned hashed and duplicated keywords.
    raw = model_output(keywords=["#만두전골", "만두전골", " 가족외식 "])

    # When: the output is validated.
    results = parse_results(raw)

    # Then: the same normalization as user input applies.
    assert results[0].keywords == ("만두전골", "가족외식")


def test_the_failure_message_reveals_nothing_about_the_model() -> None:
    # Given: the message a caller sees when generation fails.
    lowered = GENERATION_FAILED_MESSAGE.lower()

    # When / Then: it names no provider, endpoint or key.
    for leak in ("gemini", "google", "http", "api", "key", "token"):
        assert leak not in lowered


# --- generator selection ------------------------------------------------------


def test_without_a_key_the_offline_stub_is_used() -> None:
    # Given: no GEMINI_API_KEY in the environment.
    get_settings.cache_clear()

    # When: the generator is resolved.
    generator = get_seo_generator()

    # Then: UC2 still runs, so a demo does not depend on an external service.
    assert isinstance(generator, DeterministicSEOStub)


def test_with_a_key_the_gemini_generator_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given: a configured API key.
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    get_settings.cache_clear()

    # When: the generator is resolved.
    generator = get_seo_generator()

    # Then: the same Protocol is satisfied by the real implementation.
    assert isinstance(generator, GeminiSEOGenerator)


def test_the_configured_key_is_not_exposed_by_the_settings_repr(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: a configured API key.
    monkeypatch.setenv("GEMINI_API_KEY", "super-secret-key")
    get_settings.cache_clear()

    # When: settings are printed, as they might be in a debug log.
    printed = repr(get_settings())

    # Then: the key does not leak through the representation.
    assert "super-secret-key" not in printed


# --- HTTP client --------------------------------------------------------------


def envelope(text: str) -> dict[str, object]:
    """Render the Gemini API response envelope around some model text."""
    return {"candidates": [{"content": {"parts": [{"text": text}]}}]}


def client_with(handler: Callable[[httpx.Request], httpx.Response]) -> HttpGeminiModelClient:
    """Return a client whose transport is driven by the given handler."""
    return HttpGeminiModelClient(
        api_key="test-key-not-real",
        model="gemini-2.5-flash",
        timeout_seconds=5.0,
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_the_client_returns_the_model_text() -> None:
    # Given: the API answering with a normal envelope.
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        return httpx.Response(200, json=envelope(model_output()))

    # When: a prompt is sent.
    raw = await client_with(handler).generate("프롬프트")

    # Then: only the model text comes back, not the envelope.
    assert "google" in raw
    assert "candidates" not in raw


@pytest.mark.asyncio
async def test_the_client_sends_the_key_as_a_header_and_the_prompt_as_json() -> None:
    # Given: a transport that inspects the outgoing request.
    seen: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["key"] = request.headers.get("x-goog-api-key", "")
        seen["body"] = request.content.decode()
        seen["url"] = str(request.url)
        return httpx.Response(200, json=envelope(model_output()))

    # When: a prompt is sent.
    _ = await client_with(handler).generate("깊은 국물 맛")

    # Then: the key travels in the header and never in the URL.
    assert seen["key"] == "test-key-not-real"
    assert "test-key-not-real" not in seen["url"]
    assert "깊은 국물 맛" in seen["body"]


@pytest.mark.asyncio
@pytest.mark.parametrize("status_code", [400, 401, 403, 429, 500, 503])
async def test_any_error_status_becomes_a_safe_failure(status_code: int) -> None:
    # Given: the API refusing the request.
    def handler(request: httpx.Request) -> httpx.Response:
        _ = request
        return httpx.Response(status_code, json={"error": {"message": "quota exceeded for key"}})

    # When / Then: the upstream message never reaches the caller.
    with pytest.raises(GeminiGenerationError, match=GENERATION_FAILED_MESSAGE):
        _ = await client_with(handler).generate("프롬프트")


@pytest.mark.asyncio
async def test_a_transport_failure_becomes_a_safe_failure() -> None:
    # Given: the request never completing.
    def handler(request: httpx.Request) -> httpx.Response:
        _ = request
        message = "connection reset"
        raise httpx.ConnectError(message)

    # When / Then: a network problem is reported like any other failure.
    with pytest.raises(GeminiGenerationError):
        _ = await client_with(handler).generate("프롬프트")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload_json",
    [
        "{}",
        '{"candidates": []}',
        '{"candidates": [{"content": {}}]}',
        '{"candidates": [{"content": {"parts": []}}]}',
    ],
)
async def test_an_unexpected_envelope_becomes_a_safe_failure(payload_json: str) -> None:
    # Given: a 200 response whose shape does not match the API.
    def handler(request: httpx.Request) -> httpx.Response:
        _ = request
        return httpx.Response(
            200, content=payload_json, headers={"content-type": "application/json"}
        )

    # When / Then: a surprising response is refused rather than parsed loosely.
    with pytest.raises(GeminiGenerationError):
        _ = await client_with(handler).generate("프롬프트")


@pytest.mark.asyncio
async def test_a_non_json_body_becomes_a_safe_failure() -> None:
    # Given: a 200 response that is not JSON at all.
    def handler(request: httpx.Request) -> httpx.Response:
        _ = request
        return httpx.Response(200, text="<html>gateway</html>")

    # When / Then: the caller still sees the contract's safe message.
    with pytest.raises(GeminiGenerationError):
        _ = await client_with(handler).generate("프롬프트")
