import type { ApiErrorBody, CreateStoreChangeResponse, PatchStoreChangeResponse, StoreChangeApprovalResponse } from '@/services/api.types';
import type { ProposalFailure, ProposalFailureReason } from '@/types/domain';

export const storeChangeDraftFixture: CreateStoreChangeResponse = {
  proposalId: 'prop-001',
  recognizedTextMasked: '영업시간 ***까지로 바꿔줘',
  changes: [{ field: 'businessHours', currentValue: '09:00-22:00', proposedValue: '09:00-10:00' }],
  status: 'DRAFT',
  unmappedRequests: [],
};

export const editedStoreChangeDraftFixture: PatchStoreChangeResponse = {
  proposalId: 'prop-001',
  status: 'DRAFT',
  changes: [{ field: 'businessHours', currentValue: '09:00-22:00', proposedValue: '09:00-20:00' }],
  unmappedRequests: [],
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

/**
 * The same refusal copy `services/proposal_failure.py` serves.
 *
 * Mock mode has to refuse the way the real API refuses, or the screen is only
 * ever exercised against a dead end it will not see in production.
 */
export const FAILURE_COPY: Record<ProposalFailureReason, Omit<ProposalFailure, 'reason' | 'recognizedTextMasked'>> = {
  AMBIGUOUS_TIME: {
    message: '몇 시인지 정확히 알 수 없어요.',
    guidance: '“오후”, “저녁”처럼 대략적인 때만 말씀하셨거나 시계에 없는 시각이라 시각을 정하지 못했어요.',
    retry: '몇 시인지 함께 말씀해 주세요. 하루 종일 쉬시는 거라면 시각 대신 날짜로 말씀해 주세요.',
    examples: ['영업시간을 밤 10시까지로 바꿔줘', '내일 하루 쉽니다'],
  },
  AMBIGUOUS_DATE: {
    message: '며칠인지 정확히 알 수 없어요.',
    guidance: '“조만간”처럼 날짜를 특정할 수 없는 표현이라 며칠인지 정하지 못했어요.',
    retry: '“내일”, “다음 주 월요일”, “9월 1일”처럼 날짜를 함께 말씀해 주세요.',
    examples: ['내일 하루 쉽니다', '9월 1일은 임시 휴무입니다'],
  },
  UNREADABLE_DATE_RANGE: {
    message: '기간의 시작일과 종료일을 모두 읽지 못했어요.',
    guidance: '쉬시는 기간을 말씀하셨지만 끝나는 날을 정하지 못했어요. 한쪽만 반영하면 실제보다 짧게 쉬는 것으로 올라가요.',
    retry: '시작일과 종료일을 모두 말씀해 주세요.',
    examples: ['다음 주 월요일부터 수요일까지 쉽니다', '9월 1일부터 9월 3일까지 쉽니다'],
  },
  INVALID_DATE: {
    message: '말씀하신 날짜를 그대로 쓸 수 없어요.',
    guidance: '말씀하신 날짜가 실제로 없는 날이거나, 끝나는 날이 시작하는 날보다 앞서 있어요.',
    retry: '실제 있는 날짜로, 시작일이 종료일보다 앞서도록 다시 말씀해 주세요.',
    examples: ['9월 1일은 임시 휴무입니다', '다음 주 월요일부터 수요일까지 쉽니다'],
  },
  MULTIPLE_MENU_CANDIDATES: {
    message: '대표 메뉴를 하나로 정하지 못했어요.',
    guidance: '대표 메뉴는 한 개만 저장할 수 있는데 여러 개를 말씀하셨어요.',
    retry: '대표로 올릴 메뉴 하나만 말씀해 주세요.',
    examples: ['대표 메뉴를 김치찌개로 바꿔줘'],
  },
  UNSUPPORTED_FIELD: {
    message: '지금은 바꿀 수 없는 항목이에요.',
    guidance: '바꿀 수 있는 건 영업시간, 임시 휴무, 대표 메뉴, 주차 정보예요.',
    retry: '네 항목 중 하나를 골라 다시 말씀해 주세요.',
    examples: ['영업시간을 밤 10시까지로 바꿔줘', '내일 하루 쉽니다', '대표 메뉴를 김치찌개로 바꿔줘', '주차 정보를 건물 뒤 3대 가능으로 바꿔줘'],
  },
  NO_CHANGE_FOUND: {
    message: '말씀하신 내용에서 바꿀 항목을 찾지 못했어요.',
    guidance: '바꿀 수 있는 건 영업시간, 임시 휴무, 대표 메뉴, 주차 정보예요.',
    retry: '바꾸실 항목과 값을 함께 말씀해 주세요.',
    examples: ['영업시간을 밤 10시까지로 바꿔줘', '내일 하루 쉽니다', '대표 메뉴를 김치찌개로 바꿔줘', '주차 정보를 건물 뒤 3대 가능으로 바꿔줘'],
  },
  NO_EFFECTIVE_CHANGE: {
    message: '현재 매장 정보와 달라진 내용이 없어요.',
    guidance: '말씀하신 값이 지금 저장된 값과 같아서 바꿀 것이 없어요.',
    retry: '지금과 다른 값으로 다시 말씀해 주세요.',
    examples: ['영업시간을 밤 10시까지로 바꿔줘', '대표 메뉴를 김치찌개로 바꿔줘'],
  },
};
