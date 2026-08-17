import { apiRequestParsed } from '@/services/api';
import type {
  ApiResult,
  CreateSeoGenerationRequest,
  CreateSeoGenerationResponse,
  RegenerateSeoGenerationRequest,
  RegenerateSeoGenerationResponse,
  SeoApprovalResponse,
} from '@/services/api.types';
import { seoApprovalResponseSchema, seoGenerationResponseSchema } from '@/services/contracts/seo';

export function generateSeoDrafts(
  request: CreateSeoGenerationRequest,
  signal?: AbortSignal,
): Promise<ApiResult<CreateSeoGenerationResponse>> {
  return apiRequestParsed('/api/v1/seo/generations', seoGenerationResponseSchema, {
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
  return apiRequestParsed(
    `/api/v1/seo/generations/${encodeURIComponent(generationId)}/regenerate`,
    seoGenerationResponseSchema,
    {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
    },
  );
}

export function rejectSeoGeneration(
  generationId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CreateSeoGenerationResponse>> {
  return apiRequestParsed(
    `/api/v1/seo/generations/${encodeURIComponent(generationId)}/reject`,
    seoGenerationResponseSchema,
    {
    method: 'POST',
    ...(signal ? { signal } : {}),
    },
  );
}

export function approveSeoGeneration(
  generationId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<SeoApprovalResponse>> {
  return apiRequestParsed(
    `/api/v1/seo/generations/${encodeURIComponent(generationId)}/approve`,
    seoApprovalResponseSchema,
    {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
    },
  );
}
