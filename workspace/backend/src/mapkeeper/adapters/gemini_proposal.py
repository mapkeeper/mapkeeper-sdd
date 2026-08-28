"""Gemini-backed UC1 structuring, behind the same Protocol as the rule-based stub.

The stub matches four keywords and a clock regex, so anything phrased differently
is refused. Gemini reads the sentence instead, which is the point of the feature.

The safety properties do not move: only masked text reaches the prompt, and the
model's answer is re-validated against the published ProposalChange union before it
becomes a proposal.
"""

import json
from dataclasses import dataclass
from datetime import date, datetime
from typing import Final
from zoneinfo import ZoneInfo

from pydantic import TypeAdapter, ValidationError

from mapkeeper.adapters.gemini_seo import GeminiModelClient, strip_code_fence
from mapkeeper.adapters.intent import (
    is_multiple_menu_request,
    parse_intent,
    unmapped_request_labels,
)
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

UNSUPPORTED_CHANGE_MESSAGE: Final = (
    "말씀하신 내용에서 바꿀 항목을 찾지 못했어요. "
    "바꿀 수 있는 건 영업시간, 임시 휴무, 대표 메뉴, 주차 정보예요. "
    "예를 들어 “내일 하루 쉽니다”, “영업시간을 밤 10시까지로 바꿔줘”처럼 말씀해 주세요."
)
_SEOUL_TIMEZONE: Final = ZoneInfo("Asia/Seoul")
_WEEKDAY_NAMES: Final = ("월", "화", "수", "목", "금", "토", "일")

_changes_adapter: TypeAdapter[tuple[ProposalChange, ...]] = TypeAdapter(tuple[ProposalChange, ...])


class UnsupportedChangeError(MapKeeperError):
    """The sentence did not describe a change this MVP can apply."""

    http_status: int = 422
    code: ApiErrorCode = ApiErrorCode.VALIDATION_ERROR


def today_in_seoul() -> date:
    """Return the current date in the timezone every store in scope operates in."""
    return datetime.now(_SEOUL_TIMEZONE).date()


def build_proposal_prompt(
    masked_text: str,
    profile: StoreProfile,
    today: date | None = None,
) -> str:
    """Ask the model to turn one masked sentence into the allowed change shapes.

    The reference date is passed in rather than left to the model. "내일" is the
    most ordinary way an owner states a closure, and a model with no calendar can
    only refuse it — which is what the earlier prompt told it to do.
    """
    reference = today if today is not None else today_in_seoul()
    weekday = _WEEKDAY_NAMES[reference.weekday()]
    closure = "없음"
    if profile.temporary_closure_start_date and profile.temporary_closure_end_date:
        closure = f"{profile.temporary_closure_start_date} ~ {profile.temporary_closure_end_date}"
    hours = profile.business_hours
    parking = profile.parking_info or "없음"
    return f"""사장님이 말한 문장을 매장 정보 변경안으로 바꾼다.

오늘 날짜: {reference.isoformat()} ({weekday}요일)

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
   "내일", "모레", "다음 주 월요일", "이번 주말" 같은 표현은 위 오늘 날짜를 기준으로
   계산해 확정 날짜로 바꾼다. 기간을 말하지 않았으면 시작일과 종료일을 같은 날로 둔다.
   기준 날짜로도 계산할 수 없는 표현("조만간", "곧")이면 이 항목을 넣지 않는다.
3. representativeMenuName — 대표 메뉴 이름 ({MENU_NAME_MAX_LENGTH}자 이하)
4. parkingInfo — 주차 정보 ({PARKING_INFO_MAX_LENGTH}자 이하)

규칙:
- 한 문장이 여러 항목을 말하면 각각을 배열에 모두 넣는다. 하나만 넣고 나머지를 버리지 않는다.
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
        """Return the parser's changes, or the model's when the parser declines.

        The parser reads one field per sentence. When the owner named a second
        one in the same breath the parser's answer is incomplete, so the model
        reads the whole sentence instead — and the two answers are then added
        together rather than one replacing the other. Choosing between them lost
        whichever half the winner did not carry: "다음 주 월요일 하루 임시 휴무이고
        영업시간은 오전 10시부터 오후 9시까지입니다" came back as an hours change with
        the closure reduced to an unmapped notice, so the owner had to ask for
        their day off a second time.
        """
        if is_multiple_menu_request(masked_text):
            raise UnsupportedChangeError(UNSUPPORTED_CHANGE_MESSAGE)
        parsed = parse_intent(masked_text, profile)
        if parsed is not None and not unmapped_request_labels(masked_text, parsed):
            return parsed
        try:
            from_model = await self.fallback.generate(masked_text, profile)
        except UnsupportedChangeError:
            if parsed is None:
                raise
            return parsed
        if parsed is None:
            return from_model
        # The model read the whole sentence, so its reading of a field it covered
        # wins; the parser only fills in the fields it did not answer for.
        covered = {change.field for change in from_model}
        return (*from_model, *(change for change in parsed if change.field not in covered))


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
