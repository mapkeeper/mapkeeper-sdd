import { apiRequest } from '@/services/api';
import type {
  ApiResult,
  CreateStoreChangeRequest,
  CreateStoreChangeResponse,
  PatchStoreChangeRequest,
  PatchStoreChangeResponse,
  StoreChangeApprovalResponse,
} from '@/services/api.types';
import type { ProposalField, ProposalStatus, StoreChangeProposal } from '@/types/domain';

type RawChangeValue = string | { open: string; close: string } | { startDate: string; endDate: string } | null;

interface RawProposalChange {
  field: ProposalField;
  currentValue: RawChangeValue;
  proposedValue: RawChangeValue;
}

interface RawStoreChangeProposal {
  proposalId: string;
  recognizedTextMasked?: string;
  changes: RawProposalChange[];
  status: ProposalStatus;
}

function displayChangeValue(field: ProposalField, value: RawChangeValue): string {
  if (value === null) return '설정 없음';
  if (typeof value === 'string') return value;
  if ('open' in value) return `${value.open}-${value.close}`;
  if (field === 'temporaryClosure' && 'startDate' in value) return `${value.startDate} ~ ${value.endDate}`;
  return '확인 필요';
}

function normalizeProposal(data: RawStoreChangeProposal): StoreChangeProposal {
  return {
    proposalId: data.proposalId,
    ...(data.recognizedTextMasked ? { recognizedTextMasked: data.recognizedTextMasked } : {}),
    changes: data.changes.map((change) => ({
      field: change.field,
      currentValue: displayChangeValue(change.field, change.currentValue),
      proposedValue: displayChangeValue(change.field, change.proposedValue),
    })),
    status: data.status,
  };
}

function normalizeCreateProposal(data: RawStoreChangeProposal): CreateStoreChangeResponse {
  return {
    ...normalizeProposal(data),
    recognizedTextMasked: data.recognizedTextMasked ?? '',
  };
}

export function createStoreChangeProposal(
  request: CreateStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ApiResult<CreateStoreChangeResponse>> {
  return apiRequest<RawStoreChangeProposal>('/api/v1/store-change-proposals', {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  }).then((result) => ({ ...result, data: normalizeCreateProposal(result.data) }));
}

export function patchStoreChangeProposal(
  proposalId: string,
  request: PatchStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ApiResult<PatchStoreChangeResponse>> {
  return apiRequest<RawStoreChangeProposal>(`/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}`, {
    method: 'PATCH',
    body: request,
    ...(signal ? { signal } : {}),
  }).then((result) => ({ ...result, data: normalizeProposal(result.data) }));
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
