import { useCallback, useRef, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { acquireIdempotencyKey } from '@/services/idempotency';
import { approveSeoGeneration, generateSeoDrafts, patchSeoDraft } from '@/services/seoApi';
import type { SeoDraft } from '@/types/domain';

export interface SeoSyncHandoff {
  syncJobId: string;
  statusUrl: string;
}

interface SeoGenerationFlow {
  generationId: string | null;
  drafts: SeoDraft[];
  selectedDraftIds: string[];
  isGenerating: boolean;
  isSaving: boolean;
  isApproving: boolean;
  errorMessage: string | null;
  generate(sourceReviewIds: string[]): Promise<SeoDraft[] | null>;
  saveDraft(draftId: string, draftText: string): Promise<boolean>;
  rejectDraft(draftId: string): void;
  setDraftSelected(draftId: string, selected: boolean): void;
  approveFromButton(): Promise<boolean>;
  setValidationError(message: string): void;
}

function safeUserMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.causeBody?.code === 'VALIDATION_ERROR') {
    return '선택한 리뷰와 SEO 문구 내용을 확인해 주세요.';
  }
  if (error.causeBody?.code === 'PERMISSION_DENIED' || error.status === 401 || error.status === 403) {
    return 'SEO 문구를 처리할 권한이 없습니다. 관리자에게 문의해 주세요.';
  }
  if (error.causeBody?.code === 'API_TIMEOUT') return '문구 생성 시간이 길어지고 있습니다. 잠시 후 다시 시도해 주세요.';
  if (error.status === 0) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  return 'SEO 문구 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function useSeoGenerationFlow(
  storeProfileId: string,
  onSyncHandoff?: (handoff: SeoSyncHandoff) => void,
): SeoGenerationFlow {
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<SeoDraft[]>([]);
  const [selectedDraftIds, setSelectedDraftIds] = useState<string[]>([]);
  const [isGenerating, setGenerating] = useState(false);
  const [isSaving, setSaving] = useState(false);
  const [isApproving, setApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const approvalLockRef = useRef(false);

  const generate = useCallback(async (sourceReviewIds: string[]) => {
    if (isGenerating) return null;
    setGenerating(true);
    setErrorMessage(null);
    try {
      const result = await generateSeoDrafts({ storeProfileId, sourceReviewIds });
      const nextDrafts = result.data.drafts.map((draft) => ({ ...draft, status: draft.status ?? 'DRAFT' }));
      setGenerationId(result.data.generationId);
      setDrafts(nextDrafts);
      setSelectedDraftIds(nextDrafts.map(({ draftId }) => draftId));
      return nextDrafts;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return null;
    } finally {
      setGenerating(false);
    }
  }, [isGenerating, storeProfileId]);

  const saveDraft = useCallback(async (draftId: string, draftText: string) => {
    if (isSaving) return false;
    setSaving(true);
    setErrorMessage(null);
    try {
      const result = await patchSeoDraft(draftId, { draftText });
      setDrafts((current) => current.map((draft) => (
        draft.draftId === draftId
          ? { ...draft, draftText: result.data.draftText, status: 'DRAFT' }
          : draft
      )));
      return true;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      setSaving(false);
    }
  }, [isSaving]);

  const rejectDraft = useCallback((draftId: string) => {
    setDrafts((current) => current.map((draft) => (
      draft.draftId === draftId ? { ...draft, status: 'REJECTED' } : draft
    )));
    setSelectedDraftIds((current) => current.filter((id) => id !== draftId));
  }, []);

  const setDraftSelected = useCallback((draftId: string, selected: boolean) => {
    setSelectedDraftIds((current) => {
      if (selected) return current.includes(draftId) ? current : [...current, draftId];
      return current.filter((id) => id !== draftId);
    });
  }, []);

  const approveFromButton = useCallback(async () => {
    if (!generationId || selectedDraftIds.length === 0 || approvalLockRef.current) return false;
    approvalLockRef.current = true;
    setApproving(true);
    setErrorMessage(null);
    const lease = acquireIdempotencyKey(`seo-generation:${generationId}`);
    try {
      const result = await approveSeoGeneration(
        generationId,
        { draftIds: selectedDraftIds },
        lease.key,
      );
      setDrafts((current) => current.map((draft) => (
        selectedDraftIds.includes(draft.draftId) ? { ...draft, status: 'APPROVED' } : draft
      )));
      onSyncHandoff?.({ syncJobId: result.data.syncJobId, statusUrl: result.data.statusUrl });
      return true;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      lease.resolve();
      approvalLockRef.current = false;
      setApproving(false);
    }
  }, [generationId, onSyncHandoff, selectedDraftIds]);

  return {
    generationId,
    drafts,
    selectedDraftIds,
    isGenerating,
    isSaving,
    isApproving,
    errorMessage,
    generate,
    saveDraft,
    rejectDraft,
    setDraftSelected,
    approveFromButton,
    setValidationError: setErrorMessage,
  };
}
