import { apiRequest } from '@/services/api';
import type { ApiResult, GetReviewSummaryResponse } from '@/services/api.types';

export function getReviewSummary(storeProfileId: string): Promise<ApiResult<GetReviewSummaryResponse>> {
  return apiRequest(`/api/v1/store-profiles/${encodeURIComponent(storeProfileId)}/reviews/summary`);
}
