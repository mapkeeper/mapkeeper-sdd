import { apiRequestParsed } from '@/services/api';
import type { ParsedApiResult } from '@/services/contracts/common';
import {
  approveSeoGenerationResponseSchema,
  createSeoGenerationResponseSchema,
  regenerateSeoGenerationResponseSchema,
  rejectSeoGenerationResponseSchema,
  seoCommonInputSchema,
  type ApproveSeoGenerationResponse,
  type ContentGenerationData,
  type CreateSeoGenerationRequest,
  type RegenerateSeoGenerationRequest,
} from '@/services/contracts/seo';

/**
 * `storeProfileId` and `sourceReviewIds` are supplied by the caller (the running app's
 * store/review identity, not something this slice owns) and are not re-validated here;
 * `apiRequestParsed` still strictly validates whatever the server sends back. The part of
 * the request this slice does own - `briefText` / `seedKeywords` - is checked defensively
 * against the same schema the UI uses before every request leaves the browser.
 */
export function createSeoGeneration(
  request: CreateSeoGenerationRequest,
  signal?: AbortSignal,
): Promise<ParsedApiResult<ContentGenerationData>> {
  seoCommonInputSchema.parse({ briefText: request.briefText, seedKeywords: request.seedKeywords });
  return apiRequestParsed('/api/v1/seo/generations', createSeoGenerationResponseSchema, {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function regenerateSeoGeneration(
  generationId: string,
  request: RegenerateSeoGenerationRequest,
  signal?: AbortSignal,
): Promise<ParsedApiResult<ContentGenerationData>> {
  seoCommonInputSchema.parse({ briefText: request.briefText, seedKeywords: request.seedKeywords });
  return apiRequestParsed(
    `/api/v1/seo/generations/${encodeURIComponent(generationId)}/regenerate`,
    regenerateSeoGenerationResponseSchema,
    { method: 'POST', body: request, ...(signal ? { signal } : {}) },
  );
}

export function rejectSeoGeneration(
  generationId: string,
  signal?: AbortSignal,
): Promise<ParsedApiResult<ContentGenerationData>> {
  return apiRequestParsed(
    `/api/v1/seo/generations/${encodeURIComponent(generationId)}/reject`,
    rejectSeoGenerationResponseSchema,
    { method: 'POST', ...(signal ? { signal } : {}) },
  );
}

// The approval request body is always empty (API Contract §5): no `draftIds`, no
// `approvedPlatforms` - those are response-only fields the server decides.
export function approveSeoGeneration(
  generationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ParsedApiResult<ApproveSeoGenerationResponse>> {
  return apiRequestParsed(
    `/api/v1/seo/generations/${encodeURIComponent(generationId)}/approve`,
    approveSeoGenerationResponseSchema,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, ...(signal ? { signal } : {}) },
  );
}
