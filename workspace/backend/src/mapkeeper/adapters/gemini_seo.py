"""Gemini-backed UC2 copy generation, behind the same Protocol as the stub.

Three separations keep this testable and safe:

- The HTTP call sits behind ``GeminiModelClient``, so prompt building and response
  handling are checked without a network or an API key.
- Whatever the model returns is re-validated against the published response schema
  before anything is stored. Length, keyword count and platform coverage are the
  contract's, not the model's.
- Only masked input reaches the prompt. The caller masks before handing values over,
  and nothing here reads raw reviews or customer data.
"""

import json
from dataclasses import dataclass
from http import HTTPStatus
from typing import Final, Protocol, cast
from uuid import uuid4

import httpx
from pydantic import TypeAdapter, ValidationError

from mapkeeper.api.schemas.seo import (
    DRAFT_TEXT_MAX_LENGTH,
    KEYWORD_MAX_LENGTH,
    PLATFORM_KEYWORDS_MAX,
    PLATFORM_KEYWORDS_MIN,
    ContentGenerationInput,
    PlatformContentResult,
)
from mapkeeper.core.errors import MapKeeperError
from mapkeeper.core.json_types import JsonValue
from mapkeeper.core.logging import get_logger
from mapkeeper.models import Platform, StoreProfile

logger = get_logger(__name__)

GEMINI_ENDPOINT: Final = "https://generativelanguage.googleapis.com/v1beta/models"
GENERATION_FAILED_MESSAGE: Final = "문구를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."
MAX_SOURCE_REVIEWS: Final = 10

PLATFORM_GUIDANCE: Final[dict[Platform, str]] = {
    Platform.GOOGLE: "확인 가능한 매장 정보를 사실 중심으로 간결하게 작성한다.",
    Platform.NAVER: "지역명과 메뉴명 같은 검색어를 문장에 자연스럽게 포함한다.",
    Platform.KAKAO: "짧고 읽기 쉬운 매장 안내 중심으로 작성한다.",
}

_results_adapter: TypeAdapter[tuple[PlatformContentResult, ...]] = TypeAdapter(
    tuple[PlatformContentResult, ...]
)


class GeminiGenerationError(MapKeeperError):
    """Generation could not be completed. The caller sees a safe message."""


class GeminiModelClient(Protocol):
    """Sends one prompt and returns the model's raw text response."""

    async def generate(self, prompt: str) -> str:
        """Return the model output for this prompt.

        Raises:
            GeminiGenerationError: the model could not be reached or refused.
        """
        ...


def build_prompt(
    content_input: ContentGenerationInput,
    profile: StoreProfile,
    source_reviews: tuple[str, ...],
) -> str:
    """Build one prompt that asks for all three platform results at once.

    One call rather than three keeps the request count inside the free tier and
    lets the model differentiate the platforms against each other.
    """
    rules = "\n".join(
        f"- {platform.value}: {guidance}" for platform, guidance in PLATFORM_GUIDANCE.items()
    )
    reviews = "\n".join(f"- {review}" for review in source_reviews[:MAX_SOURCE_REVIEWS])
    review_block = f"\n참고 리뷰(마스킹 완료):\n{reviews}\n" if reviews else ""
    return f"""당신은 한국 소상공인 매장의 플랫폼 소개글을 작성한다.

매장 정보:
- 매장명: {profile.store_name}
- 주소: {profile.public_address}
- 대표 메뉴: {profile.representative_menu_name}

사장님이 강조하고 싶은 내용:
{content_input.brief_text}

반드시 고려할 키워드: {", ".join(content_input.seed_keywords)}
{review_block}
플랫폼별 작성 규칙:
{rules}

공통 규칙:
- 입력에 없는 사실을 만들지 않는다. 과장하지 않는다.
- 고객 이름·전화번호 같은 개인정보를 쓰지 않는다.
- draftText는 {DRAFT_TEXT_MAX_LENGTH}자 이하로 쓴다.
- keywords는 {PLATFORM_KEYWORDS_MIN}~{PLATFORM_KEYWORDS_MAX}개이며 각 {KEYWORD_MAX_LENGTH}자 이하다.
- keywords에 '#'을 붙이지 않는다.

아래 JSON 배열만 출력한다. 설명·코드블록을 덧붙이지 않는다.
[
  {{"platform": "google", "draftText": "...", "keywords": ["..."], "contentRules": ["..."]}},
  {{"platform": "naver",  "draftText": "...", "keywords": ["..."], "contentRules": ["..."]}},
  {{"platform": "kakao",  "draftText": "...", "keywords": ["..."], "contentRules": ["..."]}}
]"""


def _strip_code_fence(raw: str) -> str:
    text = raw.strip()
    if not text.startswith("```"):
        return text
    body = text.split("\n", 1)[1] if "\n" in text else ""
    return body.rsplit("```", 1)[0].strip()


def _load_json(raw: str) -> JsonValue:
    return cast("JsonValue", json.loads(raw))


def parse_results(raw: str) -> tuple[PlatformContentResult, ...]:
    """Turn the model output into validated results, or refuse it.

    The published schema does the checking, so a model that ignores a limit is
    rejected here instead of reaching the database.

    Raises:
        GeminiGenerationError: the output was not usable.
    """
    try:
        payload = _load_json(_strip_code_fence(raw))
    except json.JSONDecodeError as exc:
        logger.warning("gemini returned output that is not JSON: %s", exc)
        raise GeminiGenerationError(GENERATION_FAILED_MESSAGE) from exc

    if not isinstance(payload, list):
        logger.warning("gemini returned %s rather than a list of results", type(payload).__name__)
        raise GeminiGenerationError(GENERATION_FAILED_MESSAGE)

    # The model is not asked for ids; MapKeeper owns them.
    prepared = [
        {**item, "draftId": str(uuid4())} if isinstance(item, dict) else item for item in payload
    ]

    try:
        results = _results_adapter.validate_python(prepared)
    except ValidationError as exc:
        logger.warning("gemini output failed contract validation: %s", exc.error_count())
        raise GeminiGenerationError(GENERATION_FAILED_MESSAGE) from exc

    platforms = {result.platform for result in results}
    if platforms != set(PLATFORM_GUIDANCE):
        logger.warning("gemini returned platforms %s", sorted(p.value for p in platforms))
        raise GeminiGenerationError(GENERATION_FAILED_MESSAGE)
    return results


@dataclass(frozen=True, slots=True)
class HttpGeminiModelClient:
    """Calls the Gemini REST API. The key never appears in a log or an error."""

    api_key: str
    model: str
    timeout_seconds: float
    # Lets the transport be replaced so the request and every failure path are
    # checked without a network or a real key.
    transport: httpx.AsyncBaseTransport | None = None

    async def generate(self, prompt: str) -> str:
        """Send the prompt and return the model's text, normalizing every failure."""
        url = f"{GEMINI_ENDPOINT}/{self.model}:generateContent"
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"responseMimeType": "application/json"},
        }
        try:
            async with httpx.AsyncClient(
                timeout=self.timeout_seconds, transport=self.transport
            ) as client:
                response = await client.post(
                    url, headers={"x-goog-api-key": self.api_key}, json=body
                )
        except httpx.HTTPError as exc:
            logger.warning("gemini request failed: %s", type(exc).__name__)
            raise GeminiGenerationError(GENERATION_FAILED_MESSAGE) from exc

        if response.status_code != HTTPStatus.OK:
            # The body can echo the request, so only the status is recorded.
            logger.warning("gemini answered HTTP %s", response.status_code)
            raise GeminiGenerationError(GENERATION_FAILED_MESSAGE)

        return _extract_text(response.text)


def _walk(value: JsonValue, *keys: str | int) -> JsonValue:
    """Follow a path through parsed JSON, returning None as soon as it does not fit."""
    for key in keys:
        if isinstance(key, int):
            if not isinstance(value, list) or len(value) <= key:
                return None
            value = value[key]
        elif isinstance(value, dict):
            value = value.get(key)
        else:
            return None
    return value


def _extract_text(raw_response: str) -> str:
    """Pull the model text out of the API envelope, refusing any other shape."""
    try:
        payload = _load_json(raw_response)
    except json.JSONDecodeError as exc:
        logger.warning("gemini response was not JSON")
        raise GeminiGenerationError(GENERATION_FAILED_MESSAGE) from exc

    parts = _walk(payload, "candidates", 0, "content", "parts")
    pieces: list[str] = []
    if isinstance(parts, list):
        for part in parts:
            value = part.get("text") if isinstance(part, dict) else None
            if isinstance(value, str):
                pieces.append(value)

    text = "".join(pieces)
    if not text.strip():
        logger.warning("gemini response had an unexpected shape")
        raise GeminiGenerationError(GENERATION_FAILED_MESSAGE)
    return text


@dataclass(frozen=True, slots=True)
class GeminiSEOGenerator:
    """Generate the three platform results with one Gemini call."""

    client: GeminiModelClient

    async def generate(
        self,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        source_reviews: tuple[str, ...],
    ) -> tuple[PlatformContentResult, ...]:
        """Return one validated result per platform."""
        prompt = build_prompt(content_input, profile, source_reviews)
        return parse_results(await self.client.generate(prompt))
