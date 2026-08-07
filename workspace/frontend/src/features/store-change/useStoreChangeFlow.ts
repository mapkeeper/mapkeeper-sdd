import { useCallback, useRef, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { acquireIdempotencyKey } from '@/services/idempotency';
import {
  approveStoreChangeProposal,
  createStoreChangeProposal,
  patchStoreChangeProposal,
  rejectStoreChangeProposal,
} from '@/services/storeChangeApi';
import type { ProposalChange, StoreChangeApprovalResponse, StoreChangeProposalData } from '@/services/contracts/storeChange';

export interface StoreChangeSyncHandoff {
  syncJobId: string;
  statusUrl: string;
}

interface StoreChangeFlow {
  proposal: StoreChangeProposalData | null;
  isCreating: boolean;
  isSaving: boolean;
  isRejecting: boolean;
  isApproving: boolean;
  errorMessage: string | null;
  create(recognizedText: string): Promise<StoreChangeProposalData | null>;
  save(changes: ProposalChange[]): Promise<StoreChangeProposalData | null>;
  reject(): Promise<StoreChangeProposalData | null>;
  approveFromButton(): Promise<StoreChangeApprovalResponse | null>;
  clear(): void;
  clearError(): void;
}

function safeUserMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.causeBody?.code === 'VALIDATION_ERROR') return '입력 내용을 다시 확인해 주세요.';
  if (error.causeBody?.code === 'STALE_PROPOSAL') return '변경안이 그새 바뀌었어요. 새로고침 후 다시 시도해 주세요.';
  if (error.causeBody?.code === 'INVALID_STATE') return '이미 처리된 변경안이에요. 새로 만들어 주세요.';
  if (error.causeBody?.code === 'IDEMPOTENCY_CONFLICT') return '이전 승인 요청과 내용이 달라졌어요. 새로고침 후 다시 시도해 주세요.';
  if (error.causeBody?.code === 'PERMISSION_DENIED' || error.status === 401 || error.status === 403) {
    return '이 작업을 수행할 권한이 없습니다. 관리자에게 문의해 주세요.';
  }
  if (error.causeBody?.code === 'API_TIMEOUT') return '처리 시간이 길어지고 있습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 0) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

// UC1 approval idempotency identity is Proposal ID + approval content (API Contract §7):
// a retry with the exact same changes reuses the key, any content change mints a new one.
function contentSignature(changes: readonly ProposalChange[]): string {
  return [...changes]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((change) => `${change.field}:${JSON.stringify(change.proposedValue)}`)
    .join('|');
}

export function useStoreChangeFlow(
  storeProfileId: string,
  onSyncHandoff?: (handoff: StoreChangeSyncHandoff) => void,
): StoreChangeFlow {
  const [proposal, setProposal] = useState<StoreChangeProposalData | null>(null);
  const [isCreating, setCreating] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [isRejecting, setRejecting] = useState(false);
  const [isApproving, setApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const approvalLockRef = useRef(false);

  const create = useCallback(async (recognizedText: string) => {
    if (isCreating || !recognizedText.trim()) return null;
    setCreating(true);
    setErrorMessage(null);
    try {
      const result = await createStoreChangeProposal({
        storeProfileId,
        recognizedText: recognizedText.trim(),
        locale: 'ko-KR',
      });
      setProposal(result.data);
      return result.data;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return null;
    } finally {
      setCreating(false);
    }
  }, [isCreating, storeProfileId]);

  const save = useCallback(async (changes: ProposalChange[]) => {
    if (!proposal || proposal.status !== 'DRAFT' || isSaving) return null;
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await patchStoreChangeProposal(proposal.proposalId, { changes });
      setProposal(result.data);
      return result.data;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return null;
    } finally {
      setSaving(false);
    }
  }, [isSaving, proposal]);

  const reject = useCallback(async () => {
    if (!proposal || proposal.status !== 'DRAFT' || isRejecting) return null;
    setRejecting(true);
    setErrorMessage(null);
    try {
      const result = await rejectStoreChangeProposal(proposal.proposalId);
      setProposal(result.data);
      return result.data;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return null;
    } finally {
      setRejecting(false);
    }
  }, [isRejecting, proposal]);

  const approveFromButton = useCallback(async () => {
    if (!proposal || proposal.status !== 'DRAFT' || approvalLockRef.current) return null;
    approvalLockRef.current = true;
    setApproving(true);
    setErrorMessage(null);
    const lease = acquireIdempotencyKey(`store-change:${proposal.proposalId}:${contentSignature(proposal.changes)}`);
    try {
      const result = await approveStoreChangeProposal(proposal.proposalId, lease.key);
      lease.settleDefinitive();
      setProposal((current) => current ? { ...current, status: 'APPROVED' } : current);
      onSyncHandoff?.({ syncJobId: result.data.syncJobId, statusUrl: result.data.statusUrl });
      return result.data;
    } catch (error: unknown) {
      // status 0 means the request never definitively reached/returned from the server
      // (network failure) - keep the key so a retry with the same content reuses it.
      if (error instanceof ApiClientError && error.status === 0) {
        lease.retainOnAmbiguous();
      } else {
        lease.settleDefinitive();
      }
      setErrorMessage(safeUserMessage(error));
      return null;
    } finally {
      approvalLockRef.current = false;
      setApproving(false);
    }
  }, [onSyncHandoff, proposal]);

  const clear = useCallback(() => {
    setProposal(null);
    setErrorMessage(null);
  }, []);

  return {
    proposal,
    isCreating,
    isSaving,
    isRejecting,
    isApproving,
    errorMessage,
    create,
    save,
    reject,
    approveFromButton,
    clear,
    clearError: () => setErrorMessage(null),
  };
}
