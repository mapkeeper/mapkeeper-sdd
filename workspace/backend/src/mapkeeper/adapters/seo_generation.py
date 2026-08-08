"""Protocol and deterministic substitute for UC2 platform copy generation."""

from dataclasses import dataclass
from typing import Final, Protocol
from uuid import uuid4

from mapkeeper.api.schemas.seo import (
    ContentGenerationInput,
    PlatformContentResult,
    normalize_keywords,
)
from mapkeeper.models import Platform, StoreProfile

PLATFORM_RULES: Final[dict[Platform, tuple[str, str]]] = {
    Platform.GOOGLE: ("사실 중심", "Google용 매장 안내"),
    Platform.NAVER: ("검색어 자연스러운 포함", "Naver용 지역 검색 안내"),
    Platform.KAKAO: ("짧고 읽기 쉬운 안내", "Kakao용 매장 안내"),
}


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
        del source_reviews
        results: list[PlatformContentResult] = []
        for platform, (rule, prefix) in PLATFORM_RULES.items():
            keywords = normalize_keywords(
                (*content_input.seed_keywords, profile.representative_menu_name, platform.value)
            )[:10]
            results.append(
                PlatformContentResult(
                    draft_id=uuid4(),
                    platform=platform,
                    draft_text=(
                        f"{prefix}: {profile.store_name}. {content_input.brief_text} "
                        f"대표 메뉴는 {profile.representative_menu_name}입니다."
                    ),
                    keywords=keywords,
                    content_rules=(rule,),
                )
            )
        return tuple(results)


def get_seo_generator() -> SEOContentGenerator:
    """Return the deterministic generator until Gemini HTTP integration is available."""
    return DeterministicSEOStub()


__all__ = ["SEOContentGenerator", "get_seo_generator"]
