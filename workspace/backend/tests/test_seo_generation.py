import pytest

from mapkeeper.adapters.seo_generation import DeterministicSEOStub
from mapkeeper.api.schemas.seo import ContentGenerationInput
from mapkeeper.models import Platform, StoreProfile

pytestmark = pytest.mark.asyncio


async def test_deterministic_generator_returns_one_masked_safe_result_per_platform() -> None:
    profile = StoreProfile(
        store_name="만두전골 하우스",
        public_address="서울특별시 어딘가 1길 2",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )
    content_input = ContentGenerationInput(
        brief_text="가족이 함께 즐기는 깊은 국물 맛",
        seed_keywords=("만두전골",),
    )

    results = await DeterministicSEOStub().generate(
        content_input,
        profile,
        ("고객 홍길동의 리뷰",),
    )

    assert {result.platform for result in results} == {
        Platform.GOOGLE,
        Platform.NAVER,
        Platform.KAKAO,
    }
    assert len({result.draft_id for result in results}) == 3
    assert all("고객 홍길동" not in result.draft_text for result in results)
    assert all(1 <= len(result.keywords) <= 10 for result in results)
