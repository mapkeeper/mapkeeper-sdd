"""UC1 structuring through Gemini, checked without a network or an API key."""

import json
from typing import Final
from uuid import uuid4

import pytest

from mapkeeper.adapters.gemini import DeterministicGeminiStub, get_gemini_generator
from mapkeeper.adapters.gemini_proposal import (
    GeminiProposalStructurer,
    UnsupportedChangeError,
    build_proposal_prompt,
    parse_changes,
)
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

    # When / Then: UC1 still works offline.
    assert isinstance(get_gemini_generator(), DeterministicGeminiStub)


def test_with_a_key_the_gemini_structurer_is_used(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given: a configured key.
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-not-real")
    get_settings.cache_clear()

    # When / Then: the same Protocol is satisfied by the model-backed structurer.
    assert isinstance(get_gemini_generator(), GeminiProposalStructurer)


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
