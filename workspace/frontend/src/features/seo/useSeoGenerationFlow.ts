import { useCallback, useRef, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { acquireIdempotencyKey } from '@/services/idempotency';
import { approveSeoGeneration, createSeoGeneration, regenerateSeoGeneration, rejectSeoGeneration } from '@/services/seoApi';
import type { ContentGenerationData } from '@/services/contracts/seo';

export interface SeoSyncHandoff {
  syncJobId: string;
  statusUrl: string;
}

export interface SeoCommonInputValue {
  briefText: string;
  seedKeywords: string[];
}

interface SeoGenerationFlow {
  generation: ContentGenerationData | null;
  isGenerating: boolean;
  isRejecting: boolean;
  isApproving: boolean;
  errorMessage: string | null;
  create(input: SeoCommonInputValue, sourceReviewIds: readonly string[]): Promise<boolean>;
  regenerate(input: SeoCommonInputValue, sourceReviewIds: readonly string[]): Promise<boolean>;
  reject(): Promise<boolean>;
  approveFromButton(): Promise<boolean>;
  reset(): void;
  setValidationError(message: string): void;
}

function safeUserMessage(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  if (error.causeBody?.code === 'VALIDATION_ERROR') {
    return '공통 설명과 키워드를 확인해 주세요.';
  }
  if (error.causeBody?.code === 'INVALID_STATE') {
    return '이미 처리된 문구예요. 새로 만들어 주세요.';
  }
  if (error.causeBody?.code === 'IDEMPOTENCY_CONFLICT') {
    return '이전 승인 요청과 내용이 달라졌어요. 새로고침 후 다시 시도해 주세요.';
  }
  if (error.status === 401 || error.status === 403) {
    return 'SEO 문구를 처리할 권한이 없습니다. 관리자에게 문의해 주세요.';
  }
  if (error.status === 0) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.';
  return 'SEO 문구 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

export function useSeoGenerationFlow(
  storeProfileId: string,
  onSyncHandoff?: (handoff: SeoSyncHandoff) => void,
): SeoGenerationFlow {
  const [generation, setGeneration] = useState<ContentGenerationData | null>(null);
  const [isGenerating, setGenerating] = useState(false);
  const [isRejecting, setRejecting] = useState(false);
  const [isApproving, setApproving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const approvalLockRef = useRef(false);

  const create = useCallback(async (input: SeoCommonInputValue, sourceReviewIds: readonly string[]) => {
    if (isGenerating) return false;
    setGenerating(true);
    setErrorMessage(null);
    try {
      const result = await createSeoGeneration({
        storeProfileId,
        briefText: input.briefText,
        seedKeywords: input.seedKeywords,
        ...(sourceReviewIds.length > 0 ? { sourceReviewIds: [...sourceReviewIds] } : {}),
      });
      setGeneration(result.data);
      return true;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      setGenerating(false);
    }
  }, [isGenerating, storeProfileId]);

  const regenerate = useCallback(async (input: SeoCommonInputValue, sourceReviewIds: readonly string[]) => {
    if (isGenerating || !generation) return false;
    setGenerating(true);
    setErrorMessage(null);
    try {
      const result = await regenerateSeoGeneration(generation.generationId, {
        briefText: input.briefText,
        seedKeywords: input.seedKeywords,
        ...(sourceReviewIds.length > 0 ? { sourceReviewIds: [...sourceReviewIds] } : {}),
      });
      setGeneration(result.data);
      return true;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      setGenerating(false);
    }
  }, [generation, isGenerating]);

  const reject = useCallback(async () => {
    if (!generation || isRejecting) return false;
    setRejecting(true);
    setErrorMessage(null);
    try {
      const result = await rejectSeoGeneration(generation.generationId);
      setGeneration(result.data);
      return true;
    } catch (error: unknown) {
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      setRejecting(false);
    }
  }, [generation, isRejecting]);

  const approveFromButton = useCallback(async () => {
    if (!generation || approvalLockRef.current) return false;
    approvalLockRef.current = true;
    setApproving(true);
    setErrorMessage(null);
    // UC2 idempotency identity is generationId + revision (API Contract §7): a retry with
    // the same revision reuses the key, a new revision (after regenerate) mints a new one.
    const lease = acquireIdempotencyKey(`seo-generation:${generation.generationId}:${generation.revision}`);
    try {
      const result = await approveSeoGeneration(generation.generationId, lease.key);
      lease.settleDefinitive();
      setGeneration((current) => (current ? { ...current, status: 'APPROVED' } : current));
      onSyncHandoff?.({ syncJobId: result.data.syncJobId, statusUrl: result.data.statusUrl });
      return true;
    } catch (error: unknown) {
      // status 0 means the request never definitively reached/returned from the server
      // (network failure) - keep the key so a retry with the same content reuses it.
      if (error instanceof ApiClientError && error.status === 0) {
        lease.retainOnAmbiguous();
      } else {
        lease.settleDefinitive();
      }
      setErrorMessage(safeUserMessage(error));
      return false;
    } finally {
      approvalLockRef.current = false;
      setApproving(false);
    }
  }, [generation, onSyncHandoff]);

  const reset = useCallback(() => {
    setGeneration(null);
    setErrorMessage(null);
  }, []);

  return {
    generation,
    isGenerating,
    isRejecting,
    isApproving,
    errorMessage,
    create,
    regenerate,
    reject,
    approveFromButton,
    reset,
    setValidationError: setErrorMessage,
  };
}
