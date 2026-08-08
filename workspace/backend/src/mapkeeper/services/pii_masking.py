"""Minimal deterministic masking for customer PII at the UC1 boundary."""

import re
from typing import Final

PHONE_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"(?<!\d)(?:01\d[- .]?\d{3,4}[- .]?\d{4}|0\d{1,2}[- .]?\d{3,4}[- .]?\d{4})(?!\d)"
)
ADDRESS_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"((?:주소|사는 곳|거주지)\s*(?:는|은|:)?\s*)([^,.;\n]+)",
)
CUSTOMER_NAME_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"((?:고객|손님|예약자)\s*(?:이름|명)\s*(?:은|는|:)?\s*)([가-힣]{2,4})",
)


def mask_customer_pii(text: str) -> str:
    """Mask explicit customer phone, address and name values without masking hours."""
    masked = PHONE_PATTERN.sub("[MASKED_PHONE]", text)
    masked = ADDRESS_PATTERN.sub(r"\1[MASKED_ADDRESS]", masked)
    return CUSTOMER_NAME_PATTERN.sub(r"\1[MASKED_NAME]", masked)
