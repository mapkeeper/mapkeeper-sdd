import { describe, expect, test } from 'vitest';
import { ApiClientError } from '@/services/api';
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

  test('상대 날짜·기간·복합 요청을 실제 백엔드가 구조화해 돌려준다', async () => {
    // Given / When: the three shapes an owner actually speaks, through the running API.
    const [relative, period, compound] = await Promise.all([
      createStoreChangeProposal({ storeProfileId: storeProfileFixture.id, recognizedText: '내일 하루 쉽니다', locale: 'ko-KR' }),
      createStoreChangeProposal({ storeProfileId: storeProfileFixture.id, recognizedText: '9월 1일부터 9월 3일까지 쉽니다', locale: 'ko-KR' }),
      createStoreChangeProposal({ storeProfileId: storeProfileFixture.id, recognizedText: '9월 1일은 임시 휴무이고 주차는 불가능합니다', locale: 'ko-KR' }),
    ]);

    // Then: the relative day is an exact date, the period keeps both of its ends,
    // and neither half of the compound request is left out.
    expect(relative.data.changes).toHaveLength(1);
    expect(relative.data.changes[0]?.proposedValue).toMatch(/^\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}$/);
    expect(period.data.changes[0]?.proposedValue).toBe('2026-09-01 ~ 2026-09-03');
    expect(compound.data.changes.map(({ field }) => field)).toEqual(['temporaryClosure', 'parkingInfo']);
    expect(compound.data.unmappedRequests).toEqual([]);
  });

  test('읽지 못한 문장은 원인·재시도 방법·원본 입력과 함께 거절된다', async () => {
    // Given: a sentence naming a time of day and no hour.
    const sentence = '오후에 문을 닫습니다';

    // When: the production service calls the running FastAPI application.
    const failure = await createStoreChangeProposal({
      storeProfileId: storeProfileFixture.id,
      recognizedText: sentence,
      locale: 'ko-KR',
    }).then(() => null, (error: unknown) => (error instanceof ApiClientError ? error : null));

    // Then: the strict envelope schema accepts the cause, and the screen has a
    // machine-readable reason, a retry sentence and the owner's own words.
    expect(failure?.status).toBe(422);
    expect(failure?.causeBody?.failure?.reason).toBe('AMBIGUOUS_TIME');
    expect(failure?.causeBody?.failure?.retry).not.toBe('');
    expect(failure?.causeBody?.failure?.examples.length).toBeGreaterThan(0);
    expect(failure?.causeBody?.failure?.recognizedTextMasked).toBe(sentence);
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
