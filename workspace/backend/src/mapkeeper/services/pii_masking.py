"""Minimal deterministic masking for customer PII at the UC1 boundary."""

import re
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


def mask_customer_pii(text: str) -> str:
    """Mask explicit customer phone, address and name values without masking hours."""
    masked = PHONE_PATTERN.sub("[MASKED_PHONE]", text)
    masked = ADDRESS_PATTERN.sub(r"\1[MASKED_ADDRESS]", masked)
    masked = ROAD_ADDRESS_PATTERN.sub("[MASKED_ADDRESS]", masked)
    masked = CUSTOMER_NAME_PATTERN.sub(r"\1[MASKED_NAME]", masked)
    masked = CUSTOMER_REFERENCE_NAME_PATTERN.sub(r"\1[MASKED_NAME]", masked)
    return CUSTOMER_SUFFIX_NAME_PATTERN.sub(r"[MASKED_NAME]\2", masked)
