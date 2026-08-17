import type { ReviewSummary, SourceReview, StoreProfile } from '@/types/domain';
import { DEMO_SOURCE_REVIEW_ID, DEMO_STORE } from '@/config/demoStore';

export const storeProfileFixture: StoreProfile = {
  id: DEMO_STORE.id,
  storeName: DEMO_STORE.name,
  publicAddress: DEMO_STORE.publicAddress,
  businessHours: DEMO_STORE.businessHours,
  representativeMenuName: DEMO_STORE.representativeMenuName,
  representativePhone: DEMO_STORE.representativePhone,
  platformAccountRefs: { google: 'g-public-123', naver: 'n-public-123', kakao: 'k-public-123' },
  createdAt: '2026-08-03T00:00:00Z',
  updatedAt: '2026-08-03T00:00:00Z',
};

export const sourceReviewFixtures: SourceReview[] = [{
  id: DEMO_SOURCE_REVIEW_ID,
  storeProfileId: DEMO_STORE.id,
  bodyMasked: '아이와 함께 갔는데 자리가 넓어 좋았어요. 만두전골 양이 푸짐합니다.',
  createdAt: '2026-08-03T00:00:00Z',
}];

export const reviewSummaryFixture: ReviewSummary = {
  summary: '속이 꽉 찬 만두와 깔끔한 국물이 인기예요. 친절한 응대와 넉넉한 양도 자주 칭찬해요.',
  keywords: ['속이알참', '친절함', '주차편함'],
  reviewCount: 128,
};
