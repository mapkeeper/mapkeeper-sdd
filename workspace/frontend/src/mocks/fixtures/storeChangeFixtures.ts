import type { ApiError } from '@/services/contracts/common';
import type { StoreChangeApprovalResponse, StoreChangeProposalData } from '@/services/contracts/storeChange';

export const STORE_CHANGE_PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
export const STORE_CHANGE_SYNC_JOB_ID = '66666666-6666-4666-8666-666666666666';

export const storeChangeValidationErrorFixture: ApiError = {
  code: 'VALIDATION_ERROR',
  message: '허용되지 않은 필드이거나 입력값을 확인할 수 없습니다.',
  details: [{ field: 'changes[0].field', reason: 'unsupported field' }],
};

export const storeChangeNotFoundErrorFixture: ApiError = {
  code: 'RESOURCE_NOT_FOUND',
  message: '요청한 변경안을 찾을 수 없습니다.',
};

export const storeChangeInvalidStateErrorFixture: ApiError = {
  code: 'INVALID_STATE',
  message: '이미 처리된 변경안은 수정·거절·승인할 수 없습니다.',
};

export const storeChangeStaleProposalErrorFixture: ApiError = {
  code: 'STALE_PROPOSAL',
  message: '변경안이 그새 바뀌었습니다. 새로고침 후 다시 시도해 주세요.',
};

export const storeChangeIdempotencyConflictFixture: ApiError = {
  code: 'IDEMPOTENCY_CONFLICT',
  message: '이전 승인 요청과 대상이 달라요.',
};

export function buildApproval(proposal: StoreChangeProposalData): StoreChangeApprovalResponse {
  return {
    proposalId: proposal.proposalId,
    proposalStatus: 'APPROVED',
    syncJobId: STORE_CHANGE_SYNC_JOB_ID,
    status: 'PENDING',
    statusUrl: `/api/v1/sync-jobs/${STORE_CHANGE_SYNC_JOB_ID}`,
  };
}
