import { apiRequest } from '@/services/api';
import type {
  ApiResult,
  CreateSeoGenerationRequest,
  CreateSeoGenerationResponse,
  RegenerateSeoGenerationRequest,
  RegenerateSeoGenerationResponse,
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

export function regenerateSeoGeneration(
  generationId: string,
  request: RegenerateSeoGenerationRequest,
  signal?: AbortSignal,
): Promise<ApiResult<RegenerateSeoGenerationResponse>> {
  return apiRequest(`/api/v1/seo/generations/${encodeURIComponent(generationId)}/regenerate`, {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function rejectSeoGeneration(
  generationId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CreateSeoGenerationResponse>> {
  return apiRequest(`/api/v1/seo/generations/${encodeURIComponent(generationId)}/reject`, {
    method: 'POST',
    ...(signal ? { signal } : {}),
  });
}

export function approveSeoGeneration(
  generationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<SeoApprovalResponse>> {
  return apiRequest(`/api/v1/seo/generations/${encodeURIComponent(generationId)}/approve`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
  });
}
