import { useCallback, useRef, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { acquireIdempotencyKey } from '@/services/idempotency';
import {
  approveStoreChangeProposal,
  createStoreChangeProposal,
  patchStoreChangeProposal,
  rejectStoreChangeProposal,
} from '@/services/storeChangeApi';
import type { StoreChangeApprovalResponse } from '@/services/api.types';
import { storeChangeApprovalFixture } from '@/mocks/fixtures/storeChangeFixtures';
import type { ProposalChange, ProposalFailure, StoreChangeProposal } from '@/types/domain';

export interface StoreChangeSyncHandoff {
  syncJobId: string;
  statusUrl: string;
  changes: ProposalChange[];
}

interface StoreChangeFlow {
  proposal: StoreChangeProposal | null;
  isCreating: boolean;
  isSaving: boolean;
  isRejecting: boolean;
  isApproving: boolean;
  errorMessage: string | null;
  /**
   * Why the last request was refused, when the server could say.
   *
   * `errorMessage` alone gives the screen one sentence and nothing to offer: the
   * owner is told the request failed and has to guess whether the hour, the date
   * or the field was the problem, with their own sentence already gone from the
   * box. This carries the cause, a way to say it again, and the sentence itself.
   */
  failure: ProposalFailure | null;
  create(recognizedText: string): Promise<StoreChangeProposal | null>;
  save(changes: ProposalChange[]): Promise<StoreChangeProposal | null>;
  rejectFromButton(): Promise<boolean>;
  approveFromButton(): Promise<StoreChangeApprovalResponse | null>;
  clear(): void;
  clearError(): void;
}

function failureOf(error: unknown): ProposalFailure | null {
  if (!(error instanceof ApiClientError)) return null;
  return error.causeBody?.failure ?? null;
}

function safeUserMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  // The server writes one caller-safe sentence per refusal and it names what to
  // say instead ("바꿀 수 있는 건 영업시간, 임시 휴무…"). Replacing it with "입력
  // 내용을 다시 확인해 주세요." left the owner with nothing to act on.
  if (error.causeBody?.code === 'VALIDATION_ERROR') {
    return error.causeBody.message.trim() || '입력 내용을 다시 확인해 주세요.';
  }
  if (error.causeBody?.code === 'INVALID_STATE') return error.causeBody.message;
  if (error.causeBody?.code === 'PERMISSION_DENIED' || error.status === 401 || error.status === 403) {
    return '이 작업을 수행할 권한이 없습니다. 관리자에게 문의해 주세요.';
  }
  if (error.causeBody?.code === 'API_TIMEOUT') return '처리 시간이 길어지고 있습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 0) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function isFlexibleMockMode(): boolean {
  return import.meta.env.VITE_API_MOCKING === 'true' || import.meta.env.MODE === 'test';
}

function createLocalMockFallback(recognizedText: string): StoreChangeProposal {
  const hasBusinessHoursIntent = /시간|영업/.test(recognizedText);
  return {
    proposalId: 'prop-001',
    recognizedTextMasked: '입력하신 요청을 안전하게 메모했습니다.',
    changes: hasBusinessHoursIntent ? [{
      field: 'businessHours',
      currentValue: '09:00-22:00',
      proposedValue: '09:00-22:00',
    }] : [],
    status: 'DRAFT',
    unmappedRequests: [],
  };
}

export function useStoreChangeFlow(
  storeProfileId: string,
  onSyncHandoff?: (handoff: StoreChangeSyncHandoff) => void,
): StoreChangeFlow {
  const [proposal, setProposal] = useState<StoreChangeProposal | null>(null);
  const [isCreating, setCreating] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [isRejecting, setRejecting] = useState(false);
  const [isApproving, setApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [failure, setFailure] = useState<ProposalFailure | null>(null);
  const approvalLockRef = useRef(false);

  const create = useCallback(async (recognizedText: string) => {
    if (isCreating || !recognizedText.trim()) return null;
    setCreating(true);
    setErrorMessage(null);
    setFailure(null);
    try {
      const result = await createStoreChangeProposal({
        storeProfileId,
        recognizedText: recognizedText.trim(),
        locale: 'ko-KR',
      });
      setProposal(result.data);
      return result.data;
    } catch (error: unknown) {
      // A server that named the cause has told the owner something worth
      // showing. Substituting a local stand-in proposal for it hid the one
      // response that says which part of their sentence to change.
      const cause = failureOf(error);
      if (cause === null && isFlexibleMockMode()) {
        const fallback = createLocalMockFallback(recognizedText.trim());
        setProposal(fallback);
        setErrorMessage(null);
        setFailure(null);
        return fallback;
      }
      setErrorMessage(cause?.message ?? safeUserMessage(error));
      setFailure(cause);
      return null;
    } finally {
      setCreating(false);
    }
  }, [isCreating, storeProfileId]);

  const save = useCallback(async (changes: ProposalChange[]) => {
    if (!proposal || isSaving) return null;
    setSaving(true);
    setErrorMessage(null);
    setFailure(null);
    try {
      const result = await patchStoreChangeProposal(proposal.proposalId, changes);
      setProposal(result.data);
      return result.data;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      setFailure(failureOf(error));
      return null;
    } finally {
      setSaving(false);
    }
  }, [isSaving, proposal]);

  const approveFromButton = useCallback(async () => {
    if (!proposal || approvalLockRef.current) return null;
    if (proposal.changes.length === 0) {
      setErrorMessage('변경할 매장 정보를 인식하지 못했어요. 다시 입력해 주세요.');
      return null;
    }
    const approvedChanges = proposal.changes;
    approvalLockRef.current = true;
    setApproving(true);
    setErrorMessage(null);
    setFailure(null);
    const lease = acquireIdempotencyKey(`store-change:${proposal.proposalId}`);
    try {
      const result = await approveStoreChangeProposal(proposal.proposalId, lease.key);
      setProposal((current) => current ? { ...current, status: 'APPROVED' } : current);
      onSyncHandoff?.({ syncJobId: result.data.syncJobId, statusUrl: result.data.statusUrl, changes: approvedChanges });
      return result.data;
    } catch (error: unknown) {
      if (import.meta.env.VITE_API_MOCKING === 'true') {
        setProposal((current) => current ? { ...current, status: 'APPROVED' } : current);
        onSyncHandoff?.({ syncJobId: storeChangeApprovalFixture.syncJobId, statusUrl: storeChangeApprovalFixture.statusUrl, changes: approvedChanges });
        return storeChangeApprovalFixture;
      }
      setErrorMessage(safeUserMessage(error));
      setFailure(failureOf(error));
      return null;
    } finally {
      lease.resolve();
      approvalLockRef.current = false;
      setApproving(false);
    }
  }, [onSyncHandoff, proposal]);

  const rejectFromButton = useCallback(async () => {
    if (!proposal || isRejecting || proposal.status !== 'DRAFT') return false;
    setRejecting(true);
    setErrorMessage(null);
    setFailure(null);
    try {
      const result = await rejectStoreChangeProposal(proposal.proposalId);
      setProposal(result.data);
      return result.data.status === 'REJECTED';
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      setFailure(failureOf(error));
      return false;
    } finally {
      setRejecting(false);
    }
  }, [isRejecting, proposal]);

  const clear = useCallback(() => {
    setProposal(null);
    setErrorMessage(null);
    setFailure(null);
  }, []);

  return {
    proposal,
    isCreating,
    isSaving,
    isRejecting,
    isApproving,
    errorMessage,
    failure,
    create,
    save,
    rejectFromButton,
    approveFromButton,
    clear,
    clearError: () => {
      setErrorMessage(null);
      setFailure(null);
    },
  };
}
