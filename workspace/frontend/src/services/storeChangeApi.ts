import { apiRequestParsed } from '@/services/api';
import type { ParsedApiResult } from '@/services/contracts/common';
import {
  createStoreChangeResponseSchema,
  patchStoreChangeResponseSchema,
  rejectStoreChangeResponseSchema,
  storeChangeApprovalResponseSchema,
  type CreateStoreChangeRequest,
  type CreateStoreChangeResponse,
  type PatchStoreChangeRequest,
  type PatchStoreChangeResponse,
  type RejectStoreChangeResponse,
  type StoreChangeApprovalResponse,
} from '@/services/contracts/storeChange';

export function createStoreChangeProposal(
  request: CreateStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ParsedApiResult<CreateStoreChangeResponse>> {
  return apiRequestParsed('/api/v1/store-change-proposals', createStoreChangeResponseSchema, {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  });
}

export function patchStoreChangeProposal(
  proposalId: string,
  request: PatchStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ParsedApiResult<PatchStoreChangeResponse>> {
  return apiRequestParsed(
    `/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}`,
    patchStoreChangeResponseSchema,
    { method: 'PATCH', body: request, ...(signal ? { signal } : {}) },
  );
}

export function rejectStoreChangeProposal(
  proposalId: string,
  signal?: AbortSignal,
): Promise<ParsedApiResult<RejectStoreChangeResponse>> {
  return apiRequestParsed(
    `/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}/reject`,
    rejectStoreChangeResponseSchema,
    { method: 'POST', ...(signal ? { signal } : {}) },
  );
}

// The approval request body is always empty (API Contract §4): the caller supplies only
// the Idempotency-Key header.
export function approveStoreChangeProposal(
  proposalId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ParsedApiResult<StoreChangeApprovalResponse>> {
  return apiRequestParsed(
    `/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}/approve`,
    storeChangeApprovalResponseSchema,
    { method: 'POST', headers: { 'Idempotency-Key': idempotencyKey }, ...(signal ? { signal } : {}) },
  );
}
