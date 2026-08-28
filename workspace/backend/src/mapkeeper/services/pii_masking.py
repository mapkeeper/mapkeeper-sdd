"""Minimal deterministic masking for customer PII at the UC1 boundary."""

import re
from collections.abc import Iterable
from typing import Final

PHONE_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"(?<!\d)(?:01\d[- .]?\d{3,4}[- .]?\d{4}|0\d{1,2}[- .]?\d{3,4}[- .]?\d{4})(?!\d)"
)
ADDRESS_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"((?:주소|사는 곳|거주지)\s*(?:는|은|:)?\s*)([^,.;\n]+)",
)
ROAD_ADDRESS_LOCALITY: Final = r"(?:[가-힣]+(?:특별시|광역시|특별자치시|특별자치도|도)|서울시)\s+"
ROAD_ADDRESS_STREET: Final = r"(?:[가-힣]+(?:시|군|구)\s+){1,2}[가-힣0-9]+(?:로|길)\s*\d+(?:-\d+)?"
ROAD_ADDRESS_PATTERN: Final[re.Pattern[str]] = re.compile(
    f"{ROAD_ADDRESS_LOCALITY}{ROAD_ADDRESS_STREET}"
)
CUSTOMER_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"((?:고객|손님|예약자)\s*(?:이름|명)\s*(?:은|는|:)?\s*)([가-힣]{2,4})",
)
CUSTOMER_REFERENCE_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"((?:고객|손님|예약자)\s+)([가-힣]{2,4})(?=의(?:\s|$))",
)
CUSTOMER_SUFFIX_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"([가-힣]{2,4})(\s*(?:고객|손님|예약자)(?:님)?)",
)
# "고객 홍길동님이 예약하셨어요" is how an owner most often names a customer out
# loud, and none of the patterns above saw it: one wants the word "이름", one
# wants "…의", and the suffix one wants the name *before* "고객". So the name went
# into the stored proposal text, the API response and the Gemini prompt intact.
CUSTOMER_HONORIFIC_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"((?:고객|손님|예약자)\s*)([가-힣]{2,4})(?=\s*님)",
)


# A stand-in for an approved business value while the patterns run. It carries no
# digit and no Hangul, so none of the patterns above can match inside it.
_BUSINESS_SENTINEL_PREFIX: Final = "\ue000"
_BUSINESS_SENTINEL: Final = f"{_BUSINESS_SENTINEL_PREFIX}{{index}}\ue001"


def _mask_labeled_address(match: re.Match[str]) -> str:
    if match.group(2).startswith(_BUSINESS_SENTINEL_PREFIX):
        return match.group(0)
    return f"{match.group(1)}[MASKED_ADDRESS]"


def mask_customer_pii(text: str, business_values: Iterable[str] = ()) -> str:
    """Mask explicit customer phone, address and name values without masking hours.

    Args:
        text: The text to mask.
        business_values: Values the store already publishes - its public address
            and representative phone. The constitution treats these as approved
            business information rather than customer PII, so an owner writing
            their own address into their own copy keeps it. Masking them turned
            "서울특별시 관악구 시연로 12로 찾아오세요" into "[MASKED_ADDRESS]로
            찾아오세요" on three public maps.

    Returns:
        The text with customer PII replaced by placeholders.
    """
    # Longest first, so a value contained in another one cannot break it up.
    protected = sorted({value for value in business_values if value}, key=len, reverse=True)
    masked = text
    for index, value in enumerate(protected):
        masked = masked.replace(value, _BUSINESS_SENTINEL.format(index=index))
    masked = PHONE_PATTERN.sub("[MASKED_PHONE]", masked)
    masked = ADDRESS_PATTERN.sub(_mask_labeled_address, masked)
    masked = ROAD_ADDRESS_PATTERN.sub("[MASKED_ADDRESS]", masked)
    masked = CUSTOMER_NAME_PATTERN.sub(r"\1[MASKED_NAME]", masked)
    masked = CUSTOMER_HONORIFIC_NAME_PATTERN.sub(r"\1[MASKED_NAME]", masked)
    masked = CUSTOMER_REFERENCE_NAME_PATTERN.sub(r"\1[MASKED_NAME]", masked)
    masked = CUSTOMER_SUFFIX_NAME_PATTERN.sub(r"[MASKED_NAME]\2", masked)
    for index, value in enumerate(protected):
        masked = masked.replace(_BUSINESS_SENTINEL.format(index=index), value)
    return masked
