import { apiRequest } from '@/services/api';
import type {
  ApiResult,
  CreateStoreChangeRequest,
  CreateStoreChangeResponse,
  PatchStoreChangeRequest,
  PatchStoreChangeResponse,
  StoreChangeApprovalResponse,
} from '@/services/api.types';

export function createStoreChangeProposal(
  request: CreateStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ApiResult<CreateStoreChangeResponse>> {
  return apiRequest('/api/v1/store-change-proposals', {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function patchStoreChangeProposal(
  proposalId: string,
  request: PatchStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ApiResult<PatchStoreChangeResponse>> {
  return apiRequest(`/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}`, {
    method: 'PATCH',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function approveStoreChangeProposal(
  proposalId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<StoreChangeApprovalResponse>> {
  return apiRequest(`/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}/approve`, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
  });
}
