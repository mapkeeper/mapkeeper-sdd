import { apiRequestParsed } from '@/services/api';
import type { ApiResult, GetReviewSummaryResponse } from '@/services/api.types';
import { reviewSummaryResponseSchema } from '@/services/contracts/review';

export function getReviewSummary(storeProfileId: string): Promise<ApiResult<GetReviewSummaryResponse>> {
  return apiRequestParsed(
    `/api/v1/store-profiles/${encodeURIComponent(storeProfileId)}/reviews/summary`,
    reviewSummaryResponseSchema,
  );
}
