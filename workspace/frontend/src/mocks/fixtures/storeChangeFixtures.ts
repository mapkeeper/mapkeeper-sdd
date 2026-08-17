import type { ApiErrorBody, CreateStoreChangeResponse, PatchStoreChangeResponse, StoreChangeApprovalResponse } from '@/services/api.types';

export const storeChangeDraftFixture: CreateStoreChangeResponse = {
  proposalId: 'prop-001',
  recognizedTextMasked: '영업시간 ***까지로 바꿔줘',
  changes: [{ field: 'businessHours', currentValue: '09:00-22:00', proposedValue: '09:00-10:00' }],
  status: 'DRAFT',
};

export const editedStoreChangeDraftFixture: PatchStoreChangeResponse = {
  proposalId: 'prop-001',
  status: 'DRAFT',
  changes: [{ field: 'businessHours', currentValue: '09:00-22:00', proposedValue: '09:00-20:00' }],
};

export const storeChangeValidationErrorFixture: ApiErrorBody = {
  code: 'VALIDATION_ERROR',
  message: '허용되지 않은 필드입니다.',
  details: [{ field: 'changes[0].field', reason: 'unsupported field' }],
};

export const storeChangeApprovalFixture: StoreChangeApprovalResponse = {
  proposalId: 'prop-001',
  proposalStatus: 'APPROVED',
  syncJobId: 'job-001',
  status: 'PENDING',
  statusUrl: '/api/v1/sync-jobs/job-001',
};
