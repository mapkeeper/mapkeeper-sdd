import type { ReviewSummary, SourceReview, StoreProfile } from '@/types/domain';

export const storeProfileFixture: StoreProfile = {
  id: 'store-123',
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
  id: 'review-001',
  storeProfileId: 'store-123',
  bodyMasked: '대표 메뉴가 맛있고 직원 ***님이 친절해요.',
  createdAt: '2026-08-03T00:00:00Z',
}];

export const reviewSummaryFixture: ReviewSummary = {
  summary: '만두전골 국물이 깊고 진하다는 평가가 가장 많았어요. 친절한 응대와 편리한 주차도 손님들이 자주 칭찬했어요.',
  keywords: ['속이알참', '친절함', '주차편함'],
  reviewCount: 128,
};
