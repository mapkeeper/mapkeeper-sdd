import { describe, expect, test } from 'vitest';
import { storeProfileFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { getReviewSummary } from '@/services/reviewApi';
import { generateSeoDrafts } from '@/services/seoApi';
import { createStoreChangeProposal } from '@/services/storeChangeApi';

describe('실제 FastAPI 계약 경계', () => {
  test('홈과 SEO가 같은 백엔드 리뷰 요약을 공유한다', async () => {
    // Given: the canonical profile and its PostgreSQL seed data.

    // When: the production review service calls the running FastAPI application.
    const result = await getReviewSummary(storeProfileFixture.id);

    // Then: both screens receive the same backend-owned count and source reviews.
    expect(result.data.storeProfileId).toBe(storeProfileFixture.id);
    expect(result.data.reviewCount).toBe(128);
    expect(result.data.summary).toContain('만두');
    expect(result.data.sourceReviews).toHaveLength(10);
    expect(result.data.sourceReviews.every(
      (review) => review.storeProfileId === storeProfileFixture.id,
    )).toBe(true);
  });

  test('구조화된 영업시간 응답을 프론트 표시 값으로 정규화한다', async () => {
    // Given: the seeded backend profile and a Korean closing-time request.

    // When: the production frontend service calls the running FastAPI application.
    const result = await createStoreChangeProposal({
      storeProfileId: storeProfileFixture.id,
      recognizedText: '영업시간을 밤 9시까지로 바꿔줘',
      locale: 'ko-KR',
    });

    // Then: the real {open, close} response reaches React as render-safe text.
    expect(result.data.changes).toEqual([{
      field: 'businessHours',
      currentValue: '09:00-22:00',
      proposedValue: '09:00-21:00',
    }]);
  });

  test('생성 문구가 공식 데모 매장과 사용자 입력 및 허용 리뷰에 근거한다', async () => {
    // Given: the frontend's canonical demo profile and one backend-owned review id.
    const allowedReview = sourceReviewFixtures[0];
    expect(allowedReview).toBeDefined();

    // When: the production frontend service requests an introduction from FastAPI.
    const result = await generateSeoDrafts({
      storeProfileId: storeProfileFixture.id,
      purpose: 'INTRODUCTION',
      briefText: '가족 외식에 어울리는 깊은 국물 맛을 소개해줘',
      seedKeywords: ['만두전골', '가족외식'],
      sourceReviewIds: allowedReview ? [allowedReview.id] : [],
    });

    // Then: every platform draft uses only the shared profile, answer and allowed review.
    for (const draft of result.data.drafts) {
      expect(draft.draftText).toContain(storeProfileFixture.storeName);
      expect(draft.draftText).toContain('가족 외식에 어울리는 깊은 국물 맛을 소개해줘');
      expect(draft.draftText).toContain('아이와 함께 갔는데 자리가 넓어 좋았어요');
    }
  });
});
