"""UC1 structuring through Gemini, checked without a network or an API key."""

import json
from typing import Final
from uuid import uuid4

import pytest

from mapkeeper.adapters.gemini import DeterministicGeminiStub, get_gemini_generator
from mapkeeper.adapters.gemini_proposal import (
    DeterministicFirstGenerator,
    GeminiProposalStructurer,
    UnsupportedChangeError,
    build_proposal_prompt,
    parse_changes,
)
from mapkeeper.adapters.gemini_seo import GENERATION_TIMEOUT_MESSAGE, GeminiTimeoutError
from mapkeeper.api.schemas.store_change import BusinessHoursChange
from mapkeeper.core.config import get_settings
from mapkeeper.models import StoreProfile

HOURS: Final = {"open": "09:00", "close": "22:00"}


def make_profile() -> StoreProfile:
    """Return a store open 09:00 to 22:00 with no closure."""
    return StoreProfile(
        id=uuid4(),
        store_name="만두전골 하우스",
        public_address="서울특별시 관악구 시연로 12",
        business_hours=dict(HOURS),
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )


def hours_output(open_at: str, close_at: str) -> str:
    """Render a well-formed business-hours change."""
    return json.dumps(
        [
            {
                "field": "businessHours",
                "currentValue": HOURS,
                "proposedValue": {"open": open_at, "close": close_at},
            }
        ]
    )


class ScriptedClient:
    """Model client returning a fixed response and recording the prompt."""

    def __init__(self, response: str) -> None:
        """Store the response this client returns."""
        self.response: str = response
        self.prompt: str = ""

    async def generate(self, prompt: str) -> str:
        """Record the prompt and return the scripted response."""
        self.prompt = prompt
        return self.response


def test_the_prompt_states_the_current_store_values() -> None:
    # Given: the sentence and the store it applies to.
    prompt = build_proposal_prompt("가게 문 10시에 열게", make_profile())

    # When / Then: the model can fill currentValue without guessing.
    assert "09:00" in prompt
    assert "22:00" in prompt
    assert "만두전골" in prompt


def test_the_prompt_distinguishes_opening_from_closing() -> None:
    # Given: the prompt.
    prompt = build_proposal_prompt("문 10시에 열게", make_profile())

    # When / Then: the model is told which side of the day each phrase means.
    assert "open" in prompt
    assert "close" in prompt
    assert "문 연다" in prompt


def test_the_prompt_forbids_guessing_relative_dates() -> None:
    # Given: the prompt.
    prompt = build_proposal_prompt("내일 쉴게요", make_profile())

    # When / Then: "내일" has no fixed date here, so the model must refuse.
    assert "내일" in prompt
    assert "빈 배열" in prompt


@pytest.mark.asyncio
async def test_an_opening_time_change_is_structured() -> None:
    # Given: a model that read the sentence as an opening-time change.
    client = ScriptedClient(hours_output("10:00", "22:00"))

    # When: the sentence is structured.
    (change,) = await GeminiProposalStructurer(client).generate(
        "내가 내일 가게 문 오전 10시에 열게", make_profile()
    )

    # Then: the opening time moves and the closing time is preserved.
    assert isinstance(change, BusinessHoursChange)
    assert change.proposed_value.open == "10:00"
    assert change.proposed_value.close == "22:00"


@pytest.mark.asyncio
async def test_multiple_menu_names_are_refused_before_the_model_call() -> None:
    # Given: a request that names two independent representative menus.
    client = ScriptedClient("[]")

    # When / Then: the unsupported multi-menu request is rejected before Gemini runs.
    with pytest.raises(UnsupportedChangeError):
        _ = await GeminiProposalStructurer(client).generate(
            "대표 메뉴를 김치찌개와 냉면으로 바꿔줘", make_profile()
        )
    assert client.prompt == ""


@pytest.mark.parametrize(
    "raw",
    ["[]", "not json", '{"field": "businessHours"}', '[{"field": "representativePhone"}]'],
)
def test_output_the_contract_does_not_allow_is_refused(raw: str) -> None:
    # Given: an empty answer, malformed output, or a field outside the allow-list.

    # When / Then: the caller sees 422 rather than a bad proposal.
    with pytest.raises(UnsupportedChangeError):
        _ = parse_changes(raw)


def test_a_refusal_is_reported_as_a_validation_error() -> None:
    # Given: the error raised when a sentence cannot be structured.
    error = UnsupportedChangeError("지원하지 않습니다")

    # When / Then: the contract answers 422 VALIDATION_ERROR, not 500.
    assert error.http_status == 422
    assert error.code.value == "VALIDATION_ERROR"


def test_an_impossible_time_is_refused() -> None:
    # Given: a model that returned a time outside the clock.
    raw = hours_output("25:00", "22:00")

    # When / Then: the published schema decides, not the model.
    with pytest.raises(UnsupportedChangeError):
        _ = parse_changes(raw)


def test_without_a_key_the_rule_based_stub_is_used() -> None:
    # Given: no GEMINI_API_KEY.
    get_settings.cache_clear()

    # When / Then: UC1 still works offline, behind the deterministic parser.
    generator = get_gemini_generator()
    assert isinstance(generator, DeterministicFirstGenerator)
    assert isinstance(generator.fallback, DeterministicGeminiStub)


def test_with_a_key_the_gemini_structurer_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given: a configured key.
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    get_settings.cache_clear()

    # When / Then: the parser still runs first; the model is only the fallback.
    generator = get_gemini_generator()
    assert isinstance(generator, DeterministicFirstGenerator)
    assert isinstance(generator.fallback, GeminiProposalStructurer)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sentence", "expected_open", "expected_close"),
    [
        ("영업시간을 오후 8시까지로 바꿔줘", "09:00", "20:00"),
        ("영업시간을 오전 10시에 열게", "10:00", "22:00"),
        ("영업시간 오전 10시 오픈", "10:00", "22:00"),
    ],
)
async def test_the_stub_changes_the_side_of_the_day_that_was_spoken(
    sentence: str,
    expected_open: str,
    expected_close: str,
) -> None:
    # Given: a sentence about opening or about closing.
    stub = DeterministicGeminiStub()

    # When: the offline stub structures it.
    (change,) = await stub.generate(sentence, make_profile())

    # Then: an opening-time sentence no longer overwrites the closing time.
    assert isinstance(change, BusinessHoursChange)
    assert change.proposed_value.open == expected_open
    assert change.proposed_value.close == expected_close


# --- routing between the parser and the model ---------------------------------


class CountingClient:
    """Model client that records how many times it was asked to generate."""

    def __init__(self, response: str) -> None:
        """Start with no calls recorded."""
        self.response: str = response
        self.calls: int = 0

    async def generate(self, prompt: str) -> str:
        """Count the call and return the scripted response."""
        _ = prompt
        self.calls += 1
        return self.response


class TimingOutClient:
    """Model client that always times out."""

    async def generate(self, prompt: str) -> str:
        """Fail the way a slow model does."""
        _ = prompt
        raise GeminiTimeoutError


@pytest.mark.asyncio
async def test_a_sentence_the_parser_understands_never_reaches_the_model() -> None:
    # Given: a plain rename the deterministic parser handles.
    client = CountingClient(hours_output("10:00", "22:00"))
    generator = DeterministicFirstGenerator(GeminiProposalStructurer(client))

    # When: the sentence is structured.
    (change,) = await generator.generate("메뉴를 고기 만두로 바꿔줘", make_profile())

    # Then: the user waits for no model round trip, so no timeout is possible.
    assert client.calls == 0
    assert change.proposed_value == "고기 만두"


@pytest.mark.asyncio
async def test_a_sentence_the_parser_declines_falls_back_to_the_model() -> None:
    # Given: a sentence phrased in a way no rule covers.
    client = CountingClient(hours_output("10:00", "22:00"))
    generator = DeterministicFirstGenerator(GeminiProposalStructurer(client))

    # When: the sentence is structured.
    (change,) = await generator.generate("내가 내일 가게 문 좀 늦게 열까 하는데", make_profile())

    # Then: the model reads what the parser could not.
    assert client.calls == 1
    assert isinstance(change, BusinessHoursChange)


@pytest.mark.asyncio
async def test_a_model_timeout_is_reported_as_a_retryable_failure() -> None:
    # Given: a sentence that needs the model, and a model that does not answer.
    generator = DeterministicFirstGenerator(GeminiProposalStructurer(TimingOutClient()))

    # When: the sentence is structured.
    with pytest.raises(GeminiTimeoutError) as caught:
        _ = await generator.generate("내가 내일 가게 문 좀 늦게 열까 하는데", make_profile())

    # Then: the contract's existing envelope carries a safe, actionable message.
    error = caught.value
    assert error.retryable is True
    assert error.code.value == "INTERNAL_SERVER_ERROR"
    assert error.message == GENERATION_TIMEOUT_MESSAGE
    for leak in ("gemini", "timeout", "http"):
        assert leak not in error.message.lower()
