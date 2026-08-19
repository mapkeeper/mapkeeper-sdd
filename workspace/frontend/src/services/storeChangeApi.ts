import { apiRequestParsed } from '@/services/api';
import type {
  ApiResult,
  CreateStoreChangeRequest,
  CreateStoreChangeResponse,
  PatchStoreChangeRequest,
  PatchStoreChangeResponse,
  ProposalChangeRequest,
  StoreChangeApprovalResponse,
} from '@/services/api.types';
import type { ProposalChange, ProposalField, StoreChangeProposal } from '@/types/domain';
import {
  storeChangeApprovalResponseSchema,
  storeChangeProposalResponseSchema,
  type RawStoreChangeProposal,
} from '@/services/contracts/storeChange';

type RawChangeValue = string | { open: string; close: string } | { startDate: string; endDate: string } | null;

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

class InvalidProposalChangeError extends Error {
  constructor(readonly field: ProposalField, value: string) {
    super(`${field} 값을 API 계약 형식으로 변환할 수 없습니다: ${value}`);
    this.name = 'InvalidProposalChangeError';
  }
}

function parseBusinessHours(field: ProposalField, value: string): { open: string; close: string } {
  const match = value.match(/^(\d{2}:\d{2})\s*[-~]\s*(\d{2}:\d{2})$/);
  if (!match?.[1] || !match[2]) throw new InvalidProposalChangeError(field, value);
  return { open: match[1], close: match[2] };
}

function parseParkingInfo(field: ProposalField, value: string): string | null {
  if (value === '설정 없음') return null;
  const trimmed = value.trim();
  if (!trimmed) throw new InvalidProposalChangeError(field, value);
  return trimmed;
}

function parseTemporaryClosure(field: ProposalField, value: string): { startDate: string; endDate: string } | null {
  if (value === '설정 없음' || value === '영업') return null;
  const dates = value.match(/\d{4}-\d{2}-\d{2}/g);
  const startDate = dates?.[0];
  const endDate = dates?.[1] ?? startDate;
  if (!startDate || !endDate) throw new InvalidProposalChangeError(field, value);
  return { startDate, endDate };
}

function toProposalChangeRequest(change: ProposalChange): ProposalChangeRequest {
  switch (change.field) {
    case 'businessHours':
      return {
        field: change.field,
        currentValue: parseBusinessHours(change.field, change.currentValue),
        proposedValue: parseBusinessHours(change.field, change.proposedValue),
      };
    case 'temporaryClosure': {
      const proposedValue = parseTemporaryClosure(change.field, change.proposedValue);
      if (proposedValue === null) throw new InvalidProposalChangeError(change.field, change.proposedValue);
      return {
        field: change.field,
        currentValue: parseTemporaryClosure(change.field, change.currentValue),
        proposedValue,
      };
    }
    case 'representativeMenuName':
      return {
        field: change.field,
        currentValue: change.currentValue.trim(),
        proposedValue: change.proposedValue.trim(),
      };
    case 'parkingInfo': {
      const proposedValue = parseParkingInfo(change.field, change.proposedValue);
      if (proposedValue === null) throw new InvalidProposalChangeError(change.field, change.proposedValue);
      return {
        field: change.field,
        currentValue: parseParkingInfo(change.field, change.currentValue),
        proposedValue,
      };
    }
    default:
      return assertNever(change.field);
  }
}

function assertNever(value: never): never {
  throw new InvalidProposalChangeError(value, String(value));
}

export function createStoreChangeProposal(
  request: CreateStoreChangeRequest,
  signal?: AbortSignal,
): Promise<ApiResult<CreateStoreChangeResponse>> {
  return apiRequestParsed('/api/v1/store-change-proposals', storeChangeProposalResponseSchema, {
    method: 'POST',
    body: request,
    ...(signal ? { signal } : {}),
  }).then((result) => ({ ...result, data: normalizeCreateProposal(result.data) }));
}

export function patchStoreChangeProposal(
  proposalId: string,
  changes: ProposalChange[],
  signal?: AbortSignal,
): Promise<ApiResult<PatchStoreChangeResponse>> {
  const request: PatchStoreChangeRequest = { changes: changes.map(toProposalChangeRequest) };
  return apiRequestParsed(
    `/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}`,
    storeChangeProposalResponseSchema,
    {
    method: 'PATCH',
    body: request,
    ...(signal ? { signal } : {}),
    },
  ).then((result) => ({ ...result, data: normalizeProposal(result.data) }));
}

export function rejectStoreChangeProposal(
  proposalId: string,
  signal?: AbortSignal,
): Promise<ApiResult<PatchStoreChangeResponse>> {
  return apiRequestParsed(
    `/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}/reject`,
    storeChangeProposalResponseSchema,
    { method: 'POST', ...(signal ? { signal } : {}) },
  ).then((result) => ({ ...result, data: normalizeProposal(result.data) }));
}

export function approveStoreChangeProposal(
  proposalId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ApiResult<StoreChangeApprovalResponse>> {
  return apiRequestParsed(
    `/api/v1/store-change-proposals/${encodeURIComponent(proposalId)}/approve`,
    storeChangeApprovalResponseSchema,
    {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    ...(signal ? { signal } : {}),
    },
  );
}
