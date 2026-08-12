import { useCallback, useRef, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { acquireIdempotencyKey } from '@/services/idempotency';
import { approveSeoGeneration, generateSeoDrafts } from '@/services/seoApi';
import type { SeoDraft } from '@/types/domain';
import { seoGenerationFixture } from '@/mocks/fixtures/seoFixtures';

export interface SeoSyncHandoff {
  syncJobId: string;
  statusUrl: string;
}

interface SeoGenerationFlow {
  generationId: string | null;
  drafts: SeoDraft[];
  isGenerating: boolean;
  isApproving: boolean;
  errorMessage: string | null;
  generate(request: { purpose: 'INTRODUCTION' | 'NEWS'; briefText: string; seedKeywords: string[]; sourceReviewIds: string[] }): Promise<SeoDraft[] | null>;
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
  const [isGenerating, setGenerating] = useState(false);
  const [isApproving, setApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const approvalLockRef = useRef(false);

  const generate = useCallback(async (request: { purpose: 'INTRODUCTION' | 'NEWS'; briefText: string; seedKeywords: string[]; sourceReviewIds: string[] }) => {
    if (isGenerating) return null;
    setGenerating(true);
    setErrorMessage(null);
    try {
      const result = await generateSeoDrafts({ storeProfileId, ...request });
      const nextDrafts = result.data.drafts.map((draft) => ({ ...draft, status: draft.status ?? 'DRAFT' }));
      setGenerationId(result.data.generationId);
      setDrafts(nextDrafts);
      return nextDrafts;
    } catch (error: unknown) {
      if (import.meta.env.VITE_API_MOCKING === 'true') {
        const nextDrafts = seoGenerationFixture.drafts.map((draft) => ({ ...draft, status: draft.status ?? 'DRAFT' }));
        setGenerationId(seoGenerationFixture.generationId);
        setDrafts(nextDrafts);
        return nextDrafts;
      }
      setErrorMessage(safeUserMessage(error));
      return null;
    } finally {
      setGenerating(false);
    }
  }, [isGenerating, storeProfileId]);

  const approveFromButton = useCallback(async () => {
    if (!generationId || drafts.length !== 3 || approvalLockRef.current) return false;
    approvalLockRef.current = true;
    setApproving(true);
    setErrorMessage(null);
    const lease = acquireIdempotencyKey(`seo-generation:${generationId}`);
    try {
      const result = await approveSeoGeneration(generationId, lease.key);
      lease.resolve();
      setDrafts((current) => current.map((draft) => ({ ...draft, status: 'APPROVED' })));
      onSyncHandoff?.({ syncJobId: result.data.syncJobId, statusUrl: result.data.statusUrl });
      return true;
    } catch (error: unknown) {
      if (!(error instanceof ApiClientError) || error.status !== 0) lease.resolve();
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      approvalLockRef.current = false;
      setApproving(false);
    }
  }, [drafts.length, generationId, onSyncHandoff]);

  return {
    generationId,
    drafts,
    isGenerating,
    isApproving,
    errorMessage,
    generate,
    approveFromButton,
    setValidationError: setErrorMessage,
  };
}
