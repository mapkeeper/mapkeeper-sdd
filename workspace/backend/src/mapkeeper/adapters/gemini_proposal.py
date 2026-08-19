"""Gemini-backed UC1 structuring, behind the same Protocol as the rule-based stub.

The stub matches four keywords and a clock regex, so anything phrased differently
is refused. Gemini reads the sentence instead, which is the point of the feature.

The safety properties do not move: only masked text reaches the prompt, and the
model's answer is re-validated against the published ProposalChange union before it
becomes a proposal.
"""

import json
from dataclasses import dataclass
from typing import Final

from pydantic import TypeAdapter, ValidationError

from mapkeeper.adapters.gemini_seo import GeminiModelClient, strip_code_fence
from mapkeeper.adapters.intent import is_multiple_menu_request, parse_intent
from mapkeeper.api.schemas.store_change import (
    MENU_NAME_MAX_LENGTH,
    PARKING_INFO_MAX_LENGTH,
    ProposalChange,
)
from mapkeeper.core.errors import MapKeeperError
from mapkeeper.core.json_types import JsonValue
from mapkeeper.core.logging import get_logger
from mapkeeper.models import StoreProfile
from mapkeeper.models.enums import ApiErrorCode
from mapkeeper.protocols import GeminiProposalGenerator

logger = get_logger(__name__)

UNSUPPORTED_CHANGE_MESSAGE: Final = "지원하지 않는 변경 내용이거나 해석할 수 없는 값입니다."

_changes_adapter: TypeAdapter[tuple[ProposalChange, ...]] = TypeAdapter(tuple[ProposalChange, ...])


class UnsupportedChangeError(MapKeeperError):
    """The sentence did not describe a change this MVP can apply."""

    http_status: int = 422
    code: ApiErrorCode = ApiErrorCode.VALIDATION_ERROR


def build_proposal_prompt(masked_text: str, profile: StoreProfile) -> str:
    """Ask the model to turn one masked sentence into the allowed change shapes."""
    closure = "없음"
    if profile.temporary_closure_start_date and profile.temporary_closure_end_date:
        closure = f"{profile.temporary_closure_start_date} ~ {profile.temporary_closure_end_date}"
    hours = profile.business_hours
    parking = profile.parking_info or "없음"
    return f"""사장님이 말한 문장을 매장 정보 변경안으로 바꾼다.

현재 매장 상태:
- 영업시간: 여는 시각 {hours.get("open")}, 닫는 시각 {hours.get("close")}
- 임시 휴무: {closure}
- 대표 메뉴: {profile.representative_menu_name}
- 주차 정보: {parking}

사장님 문장:
{masked_text}

바꿀 수 있는 항목은 아래 넷뿐이다. 그 외 요청이면 빈 배열 []만 출력한다.

1. businessHours — 여는 시각과 닫는 시각
   "문 연다/오픈"은 open, "문 닫는다/마감"은 close를 뜻한다.
   말하지 않은 쪽은 현재 값을 그대로 넣는다.
   "오전/오후"가 없으면 매장 영업 상식에 맞게 해석한다.
2. temporaryClosure — 쉬는 기간의 시작일과 종료일
   "내일", "다음 주 월요일" 같은 표현은 확정 날짜를 알 수 없으므로 빈 배열을 출력한다.
3. representativeMenuName — 대표 메뉴 이름 ({MENU_NAME_MAX_LENGTH}자 이하)
4. parkingInfo — 주차 정보 ({PARKING_INFO_MAX_LENGTH}자 이하)

규칙:
- 시각은 "HH:mm" 24시간 형식이다.
- 날짜는 "YYYY-MM-DD" 형식이다.
- currentValue에는 위 현재 상태를 그대로 넣는다.
- 문장에 없는 항목을 추측해 만들지 않는다.
- 애매하면 빈 배열 []을 출력한다. 틀리게 채우지 않는다.

아래 형식의 JSON 배열만 출력한다. 설명을 덧붙이지 않는다.
[{{"field": "businessHours",
  "currentValue": {{"open": "09:00", "close": "22:00"}},
  "proposedValue": {{"open": "10:00", "close": "22:00"}}}}]"""


def _load(raw: str) -> JsonValue:
    return json.loads(strip_code_fence(raw))  # pyright: ignore[reportAny]


def parse_changes(raw: str) -> tuple[ProposalChange, ...]:
    """Validate the model's answer, refusing anything the contract does not allow.

    Raises:
        UnsupportedChangeError: the sentence was not usable as a change.
    """
    try:
        payload = _load(raw)
    except json.JSONDecodeError as exc:
        logger.warning("gemini proposal output was not JSON")
        raise UnsupportedChangeError(UNSUPPORTED_CHANGE_MESSAGE) from exc

    if not isinstance(payload, list) or not payload:
        # An empty array is how the model reports "I could not tell", which is a
        # refusal rather than a crash.
        logger.info("gemini could not structure the sentence")
        raise UnsupportedChangeError(UNSUPPORTED_CHANGE_MESSAGE)

    try:
        return _changes_adapter.validate_python(payload)
    except ValidationError as exc:
        logger.warning("gemini proposal failed contract validation: %s", exc.error_count())
        raise UnsupportedChangeError(UNSUPPORTED_CHANGE_MESSAGE) from exc


@dataclass(frozen=True, slots=True)
class DeterministicFirstGenerator:
    """Answer clear sentences locally and hand the rest to the model.

    The parser is tried first because most UC1 sentences are ordinary and a model
    round trip on those is latency the user waits through — and a timeout there
    turns a trivial rename into a failed request. The parser returns None rather
    than guessing, so anything it cannot read still reaches the model unchanged.
    """

    fallback: GeminiProposalGenerator

    async def generate(
        self,
        masked_text: str,
        profile: StoreProfile,
    ) -> tuple[ProposalChange, ...]:
        """Return the parser's changes, or the model's when the parser declines."""
        if is_multiple_menu_request(masked_text):
            raise UnsupportedChangeError(UNSUPPORTED_CHANGE_MESSAGE)
        parsed = parse_intent(masked_text, profile)
        if parsed is not None:
            return parsed
        return await self.fallback.generate(masked_text, profile)


@dataclass(frozen=True, slots=True)
class GeminiProposalStructurer:
    """Turn one masked sentence into validated proposal changes."""

    client: GeminiModelClient

    async def generate(
        self,
        masked_text: str,
        profile: StoreProfile,
    ) -> tuple[ProposalChange, ...]:
        """Return the changes the sentence describes."""
        if is_multiple_menu_request(masked_text):
            raise UnsupportedChangeError(UNSUPPORTED_CHANGE_MESSAGE)
        prompt = build_proposal_prompt(masked_text, profile)
        return parse_changes(await self.client.generate(prompt))
