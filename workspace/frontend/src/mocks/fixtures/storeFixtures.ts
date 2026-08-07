import type { ReviewSummary, SourceReview, StoreProfile } from '@/types/domain';

// UUIDs match the API Contract's documented examples (§5 storeProfileId, §5 sourceReviewIds).
export const STORE_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
export const SOURCE_REVIEW_ID = '55555555-5555-4555-8555-555555555555';

export const storeProfileFixture: StoreProfile = {
  id: STORE_PROFILE_ID,
  storeName: '맵키퍼 식당',
  publicAddress: '서울시 중구 공개로 10',
  businessHours: '09:00-22:00',
  representativeMenuName: '비빔밥',
  representativePhone: '02-0000-0000',
  platformAccountRefs: { google: 'g-public-123', naver: 'n-public-123', kakao: 'k-public-123' },
  createdAt: '2026-08-03T00:00:00Z',
  updatedAt: '2026-08-03T00:00:00Z',
};

export const sourceReviewFixtures: SourceReview[] = [{
  id: SOURCE_REVIEW_ID,
  storeProfileId: STORE_PROFILE_ID,
  bodyMasked: '대표 메뉴가 맛있고 직원 ***님이 친절해요.',
  createdAt: '2026-08-03T00:00:00Z',
}];

export const reviewSummaryFixture: ReviewSummary = {
  summary: '만두전골 국물이 깊고 진하다는 평가가 가장 많았어요. 친절한 응대와 편리한 주차도 손님들이 자주 칭찬했어요.',
  keywords: ['속이알찬', '친절함', '주차편함'],
  reviewCount: 128,
};
