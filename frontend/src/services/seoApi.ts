import { apiRequest } from '@/services/api';
import type {
  ApiResult,
  ApproveSeoGenerationRequest,
  CreateSeoGenerationRequest,
  CreateSeoGenerationResponse,
  PatchSeoDraftRequest,
  PatchSeoDraftResponse,
  SeoApprovalResponse,
} from '@/services/api.types';

export function generateSeoDrafts(
  request: CreateSeoGenerationRequest,
  signal?: AbortSignal,
): Promise<ApiResult<CreateSeoGenerationResponse>> {
  return apiRequest('/api/v1/seo/generations', {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function patchSeoDraft(
  draftId: string,
  request: PatchSeoDraftRequest,
  signal?: AbortSignal,
): Promise<ApiResult<PatchSeoDraftResponse>> {
  return apiRequest(`/api/v1/seo/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PATCH',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function approveSeoGeneration(
  generationId: string,
  request: ApproveSeoGenerationRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<SeoApprovalResponse>> {
  return apiRequest(`/api/v1/seo/generations/${encodeURIComponent(generationId)}/approve`, {
    method: 'POST',
    body: request,
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
  });
}
