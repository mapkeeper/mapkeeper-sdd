import { http, HttpResponse } from 'msw';
import { reviewSummaryFixture, sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { successEnvelope } from '@/mocks/factories/envelopeFactory';

export const reviewHandlers = [
  http.get('*/api/v1/store-profiles/:storeProfileId/reviews/summary', ({ params }) => HttpResponse.json(successEnvelope({
    storeProfileId: String(params.storeProfileId),
    ...reviewSummaryFixture,
    sourceReviews: sourceReviewFixtures,
  }))),
];
