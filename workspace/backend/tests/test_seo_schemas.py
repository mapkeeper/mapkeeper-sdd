from uuid import UUID

import pytest
from pydantic import ValidationError

from mapkeeper.api.schemas.seo import (
    ContentGenerationApprovalResponse,
    ContentGenerationResponse,
    CreateContentGenerationRequest,
    PlatformContentResult,
)

STORE_PROFILE_ID = UUID("11111111-1111-4111-8111-111111111111")


def test_generation_request_parses_common_input_once() -> None:
    # Given: one common description and keyword set for all three platforms.
    payload = {
        "storeProfileId": str(STORE_PROFILE_ID),
        "purpose": "NEWS",
        "briefText": "만두전골의 깊은 국물 맛을 강조하고 싶어요.",
        "seedKeywords": ["만두전골", "가족외식", "주차편한곳"],
        "sourceReviewIds": ["22222222-2222-4222-8222-222222222222"],
    }

    # When: the generation request is parsed.
    request = CreateContentGenerationRequest.model_validate(payload)

    # Then: common input stays separate from platform output.
    assert request.store_profile_id == STORE_PROFILE_ID
    assert request.purpose.value == "NEWS"
    assert request.seed_keywords == ("만두전골", "가족외식", "주차편한곳")
    assert request.source_review_ids == (UUID("22222222-2222-4222-8222-222222222222"),)


def test_generation_response_requires_exactly_one_result_per_platform() -> None:
    # Given: a generation response missing the Kakao result.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "status": "DRAFT",
        "revision": 1,
        "drafts": [
            {
                "draftId": "44444444-4444-4444-8444-444444444444",
                "platform": "google",
                "draftText": "Google용 소개글",
                "keywords": ["만두전골"],
                "contentRules": ["google-rule"],
            },
            {
                "draftId": "55555555-5555-4555-8555-555555555555",
                "platform": "naver",
                "draftText": "Naver용 소개글",
                "keywords": ["가족외식"],
                "contentRules": ["naver-rule"],
            },
        ],
    }

    # When / Then: the API boundary rejects an incomplete three-platform result.
    with pytest.raises(ValidationError):
        _ = ContentGenerationResponse.model_validate(payload)


def test_platform_result_rejects_an_individual_approval_status() -> None:
    # Given: a platform draft carrying the removed per-draft approval status.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "status": "DRAFT",
        "revision": 1,
        "drafts": [
            {
                "draftId": "44444444-4444-4444-8444-444444444444",
                "platform": "google",
                "draftText": "Google용 소개글",
                "keywords": ["만두전골"],
                "contentRules": ["google-rule"],
                "status": "APPROVED",
            },
            {
                "draftId": "55555555-5555-4555-8555-555555555555",
                "platform": "naver",
                "draftText": "Naver용 소개글",
                "keywords": ["가족외식"],
                "contentRules": ["naver-rule"],
            },
            {
                "draftId": "66666666-6666-4666-8666-666666666666",
                "platform": "kakao",
                "draftText": "Kakao용 소개글",
                "keywords": ["주차편한곳"],
                "contentRules": ["kakao-rule"],
            },
        ],
    }

    # When / Then: individual approval state is rejected by the contract.
    with pytest.raises(ValidationError):
        _ = ContentGenerationResponse.model_validate(payload)


def test_generation_response_accepts_one_result_for_each_platform() -> None:
    # Given: one generated result for Google, Naver, and Kakao.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "status": "DRAFT",
        "revision": 1,
        "drafts": [
            {
                "draftId": "44444444-4444-4444-8444-444444444444",
                "platform": "google",
                "draftText": "Google용 소개글",
                "keywords": ["만두전골"],
                "contentRules": ["google-rule"],
            },
            {
                "draftId": "55555555-5555-4555-8555-555555555555",
                "platform": "naver",
                "draftText": "Naver용 소개글",
                "keywords": ["가족외식"],
                "contentRules": ["naver-rule"],
            },
            {
                "draftId": "66666666-6666-4666-8666-666666666666",
                "platform": "kakao",
                "draftText": "Kakao용 소개글",
                "keywords": ["주차편한곳"],
                "contentRules": ["kakao-rule"],
            },
        ],
    }

    # When: the generation response is parsed.
    response = ContentGenerationResponse.model_validate(payload)

    # Then: all platform results remain part of the generation-level response.
    assert {draft.platform.value for draft in response.drafts} == {"google", "naver", "kakao"}


def test_generation_response_rejects_a_duplicate_platform_result() -> None:
    # Given: three results containing Google twice and no Kakao result.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "status": "DRAFT",
        "revision": 1,
        "drafts": [
            {
                "draftId": "44444444-4444-4444-8444-444444444444",
                "platform": "google",
                "draftText": "첫 번째 Google 소개글",
                "keywords": ["만두전골"],
                "contentRules": [],
            },
            {
                "draftId": "55555555-5555-4555-8555-555555555555",
                "platform": "google",
                "draftText": "두 번째 Google 소개글",
                "keywords": ["가족외식"],
                "contentRules": [],
            },
            {
                "draftId": "66666666-6666-4666-8666-666666666666",
                "platform": "naver",
                "draftText": "Naver용 소개글",
                "keywords": ["주차편한곳"],
                "contentRules": [],
            },
        ],
    }

    # When / Then: platform coverage validation rejects the duplicate.
    with pytest.raises(ValidationError):
        _ = ContentGenerationResponse.model_validate(payload)


def test_generation_approval_requires_all_platforms() -> None:
    # Given: an approval handoff containing a duplicate platform.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "generationStatus": "APPROVED",
        "approvedPlatforms": ["google", "google", "naver"],
        "syncJobId": "77777777-7777-4777-8777-777777777777",
        "status": "PENDING",
        "statusUrl": "/api/v1/sync-jobs/77777777-7777-4777-8777-777777777777",
    }

    # When / Then: generation-level approval rejects incomplete platform coverage.
    with pytest.raises(ValidationError):
        _ = ContentGenerationApprovalResponse.model_validate(payload)


def test_generation_approval_accepts_all_platforms() -> None:
    # Given: a generation-level approval handoff covering every platform.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "generationStatus": "APPROVED",
        "approvedPlatforms": ["google", "naver", "kakao"],
        "syncJobId": "77777777-7777-4777-8777-777777777777",
        "status": "PENDING",
        "statusUrl": "/api/v1/sync-jobs/77777777-7777-4777-8777-777777777777",
    }

    # When: the approval response is parsed.
    response = ContentGenerationApprovalResponse.model_validate(payload)

    # Then: the response hands off one pending SyncJob.
    assert response.sync_job_id == UUID("77777777-7777-4777-8777-777777777777")


def test_seed_keywords_drop_a_leading_hash_and_collapse_duplicates() -> None:
    # Given: keywords typed with hashes and repeats, as the UI presents them.
    request = CreateContentGenerationRequest.model_validate(
        {
            "storeProfileId": "11111111-1111-4111-8111-111111111111",
            "briefText": "만두전골을 알리고 싶어요.",
            "seedKeywords": ["#만두전골", " 가족외식 ", "만두전골", "#가족외식"],
        }
    )

    # When / Then: hashes are stripped and the first occurrence order is kept.
    assert request.seed_keywords == ("만두전골", "가족외식")


def test_seed_keywords_reject_more_than_five_distinct_values() -> None:
    # Given: six distinct keywords.
    payload = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "briefText": "만두전골을 알리고 싶어요.",
        "seedKeywords": ["가", "나", "다", "라", "마", "바"],
    }

    # When / Then: the contract caps user keywords at five.
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(payload)


def test_seed_keywords_reject_a_list_that_normalizes_to_nothing() -> None:
    # Given: keywords that are empty once trimmed and de-hashed.
    payload = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "briefText": "만두전골을 알리고 싶어요.",
        "seedKeywords": ["#", "   "],
    }

    # When / Then: an empty result fails the minimum count.
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(payload)


@pytest.mark.parametrize("invalid_keyword", [123, None, {"value": "가족외식"}])
def test_seed_keywords_reject_non_text_items(invalid_keyword: object) -> None:
    # Given: one keyword array mixes a valid keyword with a non-text value.
    payload = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "briefText": "만두전골을 알리고 싶어요.",
        "seedKeywords": ["만두전골", invalid_keyword],
    }

    # When / Then: the whole request is rejected instead of silently dropping the value.
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(payload)


def test_brief_text_is_capped_at_five_hundred_characters() -> None:
    # Given: a brief one character over the limit.
    payload = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "briefText": "가" * 501,
        "seedKeywords": ["만두전골"],
    }

    # When / Then: the contract limit is enforced at the boundary.
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(payload)


def test_source_review_ids_reject_duplicates_and_overflow() -> None:
    # Given: a repeated review reference.
    base = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "briefText": "만두전골을 알리고 싶어요.",
        "seedKeywords": ["만두전골"],
    }
    repeated = "55555555-5555-4555-8555-555555555555"

    # When / Then: duplicates and more than ten references are both refused.
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(
            {**base, "sourceReviewIds": [repeated, repeated]}
        )
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(
            {
                **base,
                "sourceReviewIds": [
                    f"5555555{i:04d}-5555-4555-8555-555555555555" for i in range(11)
                ],
            }
        )


def test_keywords_that_are_not_a_list_fall_through_to_field_validation() -> None:
    # Given: a single string where the contract requires an array of keywords.
    payload = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "briefText": "만두전골을 알리고 싶어요.",
        "seedKeywords": "만두전골",
    }

    # When / Then: normalization does not silently accept a bare string.
    with pytest.raises(ValidationError):
        _ = CreateContentGenerationRequest.model_validate(payload)


def test_platform_keywords_are_normalized_like_user_keywords() -> None:
    # Given: a generated result whose keywords arrive with hashes and repeats.
    payload = {
        "generationId": "33333333-3333-4333-8333-333333333333",
        "status": "DRAFT",
        "revision": 1,
        "drafts": [
            {
                "draftId": f"44444444-4444-4444-8444-44444444444{index}",
                "platform": platform,
                "draftText": f"{platform}용 소개글",
                "keywords": ["#만두전골", "만두전골", " 가족외식 "],
                "contentRules": ["team-defined-rule"],
            }
            for index, platform in enumerate(("google", "naver", "kakao"), start=1)
        ],
    }

    # When: the generation response is validated.
    response = ContentGenerationResponse.model_validate(payload)

    # Then: every platform stores clean, de-duplicated keywords.
    for draft in response.drafts:
        assert draft.keywords == ("만두전골", "가족외식")


def test_platform_keywords_that_are_not_a_list_fall_through_to_field_validation() -> None:
    # Given: a generated result whose keywords arrive as a bare string.
    payload = {
        "draftId": "44444444-4444-4444-8444-444444444441",
        "platform": "google",
        "draftText": "Google용 소개글",
        "keywords": "만두전골",
        "contentRules": ["team-defined-google-rule"],
    }

    # When / Then: normalization does not silently accept a bare string.
    with pytest.raises(ValidationError):
        _ = PlatformContentResult.model_validate(payload)
