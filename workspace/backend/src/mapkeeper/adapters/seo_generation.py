"""Protocol and deterministic substitute for UC2 platform copy generation."""

from dataclasses import dataclass
from typing import Final, Protocol
from uuid import uuid4

from mapkeeper.adapters.gemini_seo import GeminiSEOGenerator, HttpGeminiModelClient
from mapkeeper.api.schemas.seo import (
    ContentGenerationInput,
    PlatformContentResult,
    normalize_keywords,
)
from mapkeeper.core.config import get_settings
from mapkeeper.models import ContentPurpose, Platform, StoreProfile
from mapkeeper.services.pii_masking import mask_customer_pii

PLATFORM_RULES: Final[dict[Platform, tuple[str, str]]] = {
    Platform.GOOGLE: ("사실 중심", "Google용 매장 안내"),
    Platform.NAVER: ("검색어 자연스러운 포함", "Naver용 지역 검색 안내"),
    Platform.KAKAO: ("짧고 읽기 쉬운 안내", "Kakao용 매장 안내"),
}
REVIEW_EXCERPT_MAX_LENGTH: Final = 120


class SEOContentGenerator(Protocol):
    """Generate one validated result for every supported platform."""

    async def generate(
        self,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        source_reviews: tuple[str, ...],
    ) -> tuple[PlatformContentResult, ...]:
        """Return exactly one structured result per platform."""
        ...


@dataclass(frozen=True, slots=True)
class DeterministicSEOStub:
    """Offline generator used until a real Gemini HTTP adapter is configured."""

    async def generate(
        self,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        source_reviews: tuple[str, ...],
    ) -> tuple[PlatformContentResult, ...]:
        """Create contract-valid platform-specific copy without external I/O."""
        review_excerpt = (
            mask_customer_pii(source_reviews[0])[:REVIEW_EXCERPT_MAX_LENGTH]
            if source_reviews
            else ""
        )
        results: list[PlatformContentResult] = []
        for platform, (rule, prefix) in PLATFORM_RULES.items():
            keywords = normalize_keywords(
                (*content_input.seed_keywords, profile.representative_menu_name, platform.value)
            )[:10]
            match content_input.purpose:
                case ContentPurpose.INTRODUCTION:
                    prefix_text = f"{prefix}: {profile.store_name}."
                    review_text = f" 리뷰에서는 {review_excerpt}" if review_excerpt else ""
                    suffix = (
                        f"{content_input.brief_text} "
                        f"대표 메뉴는 {profile.representative_menu_name}입니다.{review_text}"
                    )
                case ContentPurpose.NEWS:
                    prefix_text = f"{prefix}: {profile.store_name} 소식. {content_input.brief_text}"
                    suffix = ""
            results.append(
                PlatformContentResult(
                    draft_id=uuid4(),
                    platform=platform,
                    draft_text=f"{prefix_text} {suffix}",
                    keywords=keywords,
                    content_rules=(rule,),
                )
            )
        return tuple(results)


def get_seo_generator() -> SEOContentGenerator:
    """Return the Gemini generator when a key is configured, otherwise the stub.

    The stub is kept rather than removed: without a key the UC2 flow still runs
    offline, and a demo does not depend on an external service being reachable.
    """
    settings = get_settings()
    if settings.gemini_api_key is None:
        return DeterministicSEOStub()
    return GeminiSEOGenerator(
        HttpGeminiModelClient(
            api_key=settings.gemini_api_key.get_secret_value(),
            model=settings.gemini_model,
            timeout_seconds=settings.gemini_timeout_seconds,
        )
    )


__all__ = ["DeterministicSEOStub", "SEOContentGenerator", "get_seo_generator"]
