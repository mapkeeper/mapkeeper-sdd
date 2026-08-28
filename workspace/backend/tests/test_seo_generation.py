import pytest

from mapkeeper.adapters.seo_generation import DeterministicSEOStub
from mapkeeper.api.schemas.seo import ContentGenerationInput
from mapkeeper.models import ContentPurpose, Platform, StoreProfile

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


async def test_offline_keywords_never_carry_the_platform_name() -> None:
    """A keyword becomes a hashtag on the published post.

    The offline generator appended the platform name so the three keyword lists
    would differ. The owner saw "#google" under the Google copy - a word nobody
    said, on a public listing - and the real generator never produces it.
    """
    # Given: a store and a brief that mention no platform.
    profile = StoreProfile(
        store_name="만두전골 하우스",
        public_address="서울특별시 어딘가 1길 2",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )
    content_input = ContentGenerationInput(
        brief_text="추석 연휴에도 정상 영업합니다.",
        seed_keywords=(),
    )

    # When: the offline generator writes the three platform results.
    results = await DeterministicSEOStub().generate(content_input, profile, ())

    # Then: every keyword is a word about the store, and none is empty.
    for result in results:
        assert result.keywords
        assert not {"google", "naver", "kakao"} & set(result.keywords)


async def test_offline_copy_never_names_the_platform_it_is_written_for() -> None:
    """The draft text is what gets published, word for word.

    The offline generator opened every result with "Google용 매장 안내: " so the
    three would differ. That label is the first thing a customer reads on the
    listing, it is a word nobody said, and the real generator never writes it.
    """
    # Given: a store and a brief that name no platform.
    profile = _demo_profile()
    content_input = ContentGenerationInput(
        brief_text="추석 연휴에도 정상 영업합니다.",
        seed_keywords=(),
        purpose=ContentPurpose.NEWS,
    )

    # When: the offline generator writes the three platform results.
    results = await DeterministicSEOStub().generate(content_input, profile, ())

    # Then: no result names a platform, and the three still read differently.
    for result in results:
        lowered = result.draft_text.lower()
        assert "google" not in lowered
        assert "naver" not in lowered
        assert "kakao" not in lowered
        assert "구글" not in result.draft_text
        assert "네이버" not in result.draft_text
        assert "카카오" not in result.draft_text
    assert len({result.draft_text for result in results}) == 3


async def test_offline_copy_follows_each_platform_rule() -> None:
    """The three results differ by the contract's rules, not by a label.

    Google states verifiable store facts, Naver carries the region and menu a
    customer searches for, and Kakao stays the shortest of the three.
    """
    # Given: the demo store, whose public address is in 관악구.
    profile = _demo_profile()
    content_input = ContentGenerationInput(
        brief_text="가족이 함께 즐기는 깊은 국물 맛",
        seed_keywords=(),
    )

    # When: the offline generator writes the three platform results.
    generated = await DeterministicSEOStub().generate(content_input, profile, ())
    results = {result.platform: result for result in generated}

    # Then: each result carries what its rule asks for.
    assert profile.public_address in results[Platform.GOOGLE].draft_text
    naver_text = results[Platform.NAVER].draft_text
    assert "관악구" in naver_text
    assert profile.representative_menu_name in naver_text
    kakao_length = len(results[Platform.KAKAO].draft_text)
    assert kakao_length < len(results[Platform.GOOGLE].draft_text)
    assert kakao_length < len(naver_text)


def _demo_profile() -> StoreProfile:
    """Return the demo store the SDD uses as the common reference profile."""
    return StoreProfile(
        store_name="만두전골 하우스",
        public_address="서울특별시 관악구 시연로 12",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )


async def test_a_tone_request_is_never_written_into_the_published_copy() -> None:
    """A rewrite request is an instruction, not something to announce.

    The tone buttons used to be appended to ``briefText``, which made them the
    owner's content: this generator echoes the brief, so pressing "정중하게"
    offline produced three drafts ending in "다시 써주세요" — the exact text an
    approval publishes to Google, Naver and Kakao.
    """
    # Given: a brief and a separate request to rewrite it more politely.
    content_input = ContentGenerationInput(
        brief_text="추석 연휴에도 정상 영업합니다.",
        seed_keywords=(),
        purpose=ContentPurpose.NEWS,
        tone_instruction="문구를 조금 더 정중하고 격식 있는 말투로 다시 써주세요.",
    )

    # When: the offline generator writes the three platform results.
    results = await DeterministicSEOStub().generate(content_input, _demo_profile(), ())

    # Then: no result repeats the instruction back at the owner's customers.
    for result in results:
        assert "다시 써주세요" not in result.draft_text
        assert "말투" not in result.draft_text
        assert content_input.brief_text in result.draft_text


async def test_the_stores_own_address_survives_the_copy_it_is_written_into() -> None:
    """The Google rule asks for verifiable store facts, and the address is one.

    The generator writes the public address into the Google draft. Re-masking that
    draft as customer PII on the way back in published "만두전골 하우스
    ([MASKED_ADDRESS])".
    """
    # Given: the demo store and a brief naming its own public address.
    profile = _demo_profile()
    content_input = ContentGenerationInput(
        brief_text=f"{profile.public_address}로 찾아오세요.",
        seed_keywords=(),
    )

    # When: the offline generator writes the three platform results.
    results = await DeterministicSEOStub().generate(content_input, profile, ())

    # Then: the address reads as an address, not as a placeholder.
    for result in results:
        assert "[MASKED_ADDRESS]" not in result.draft_text
