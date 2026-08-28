"""Protocol and deterministic substitute for UC2 platform copy generation."""

import re
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

PLATFORM_RULES: Final[dict[Platform, str]] = {
    Platform.GOOGLE: "사실 중심",
    Platform.NAVER: "검색어 자연스러운 포함",
    Platform.KAKAO: "짧고 읽기 쉬운 안내",
}
REVIEW_EXCERPT_MAX_LENGTH: Final = 120
# The administrative area inside a public address - "서울특별시 관악구 시연로 12" is
# in 관악구. It is the search word a customer actually types beside a menu name,
# which is what the Naver rule asks the copy to carry. The address names the area
# from widest to narrowest, so the last one is the neighbourhood, not the province:
# taking the first turned "관악구 만두전골" into "서울특별시 만두전골".
_REGION: Final = re.compile(r"\S+?[시군구](?=\s|$)")


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
            mask_customer_pii(
                source_reviews[0], (profile.public_address, profile.representative_phone)
            )[:REVIEW_EXCERPT_MAX_LENGTH]
            if source_reviews
            else ""
        )
        # The platform name used to be both appended to the keywords and put at
        # the head of the copy ("Google용 매장 안내: ..."). Either way it reaches the
        # owner on the published listing itself - a word nobody said, which the
        # real generator never writes. The three results differ by what the
        # contract actually asks of each platform instead: Google states the
        # store's verifiable facts, Naver carries the region and menu a customer
        # searches for, Kakao keeps it short.
        keywords = normalize_keywords(
            (*content_input.seed_keywords, profile.representative_menu_name)
        )[:10]
        regions = _REGION.findall(profile.public_address)
        region = regions[-1] if regions else ""
        results: list[PlatformContentResult] = []
        for platform, rule in PLATFORM_RULES.items():
            results.append(
                PlatformContentResult(
                    draft_id=uuid4(),
                    platform=platform,
                    draft_text=self._draft_text(
                        platform, content_input, profile, region, review_excerpt
                    ),
                    keywords=keywords,
                    content_rules=(rule,),
                )
            )
        return tuple(results)

    def _draft_text(
        self,
        platform: Platform,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        region: str,
        review_excerpt: str,
    ) -> str:
        """Write one platform's copy from the store's own facts.

        Every sentence here is built from a value the owner or the profile already
        supplied - store name, public address, representative menu, the brief, and
        a masked review excerpt. Nothing is added that the input did not state.
        """
        store = profile.store_name
        menu = profile.representative_menu_name
        brief = content_input.brief_text
        is_news = content_input.purpose is ContentPurpose.NEWS
        headline = f"{store} 소식" if is_news else store
        # 짧고 읽기 쉬운 안내: the store, what was announced, and nothing else the
        # reader has to work through.
        if platform is Platform.KAKAO:
            opening, menu_line = headline, ""
        # 사실 중심: the public address is the store fact a reader can verify.
        elif platform is Platform.GOOGLE:
            opening = f"{headline} ({profile.public_address})"
            menu_line = f" 대표 메뉴는 {menu}입니다."
        # 검색어 자연스러운 포함: the area and the menu are what a customer types.
        else:
            opening = f"{region} {headline}" if region else headline
            menu_line = (
                f" {region}에서 찾는 대표 메뉴는 {menu}입니다."
                if region
                else f" 대표 메뉴는 {menu}입니다."
            )
        if is_news:
            # A news post announces the news. The representative menu is not it.
            return f"{opening}. {brief}"
        review_text = f" 리뷰에서는 {review_excerpt}" if review_excerpt else ""
        return f"{opening}. {brief}{menu_line}{review_text}"


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
