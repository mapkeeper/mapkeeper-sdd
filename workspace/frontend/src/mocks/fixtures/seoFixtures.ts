import type { ApiError, Platform } from '@/services/contracts/common';
import { PLATFORMS } from '@/services/contracts/common';
import type { ApproveSeoGenerationResponse, ContentGenerationData, LocalSeoContent } from '@/services/contracts/seo';

export const SEO_SYNC_JOB_ID = '66666666-6666-4666-8666-666666666666';

const CONTENT_RULES: Record<Platform, string[]> = {
  google: ['team-defined-google-rule'],
  naver: ['team-defined-naver-rule'],
  kakao: ['team-defined-kakao-rule'],
};

const DRAFT_TEXT: Record<Platform, string> = {
  google: 'Google용 매장 소개글',
  naver: 'Naver용 매장 소개글',
  kakao: 'Kakao용 매장 소개글',
};

function randomUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const hex = () => Math.floor(Math.random() * 16).toString(16);
  const seg = (length: number) => Array.from({ length }, hex).join('');
  return `${seg(8)}-${seg(4)}-4${seg(3)}-8${seg(3)}-${seg(12)}`;
}

export function buildDrafts(seedKeywords: readonly string[]): LocalSeoContent[] {
  const keywords = seedKeywords.length > 0 ? [...seedKeywords] : ['대표메뉴'];
  return PLATFORMS.map((platform) => ({
    draftId: randomUuid(),
    platform,
    draftText: DRAFT_TEXT[platform],
    keywords,
    contentRules: CONTENT_RULES[platform],
  }));
}

export function buildGeneration(seedKeywords: readonly string[]): ContentGenerationData {
  return {
    generationId: randomUuid(),
    status: 'DRAFT',
    revision: 1,
    drafts: buildDrafts(seedKeywords),
  };
}

export function buildApproval(generation: ContentGenerationData): ApproveSeoGenerationResponse {
  return {
    generationId: generation.generationId,
    generationStatus: 'APPROVED',
    approvedPlatforms: [...PLATFORMS],
    syncJobId: SEO_SYNC_JOB_ID,
    status: 'PENDING',
    statusUrl: `/api/v1/sync-jobs/${SEO_SYNC_JOB_ID}`,
  };
}

export const seoValidationErrorFixture: ApiError = {
  code: 'VALIDATION_ERROR',
  message: '공통 설명과 키워드를 확인해 주세요.',
  details: [{ field: 'briefText', reason: 'briefText must be 1-500 characters' }],
};

export const seoNotFoundErrorFixture: ApiError = {
  code: 'RESOURCE_NOT_FOUND',
  message: '요청한 SEO 문구를 찾을 수 없습니다.',
};

export const seoInvalidStateErrorFixture: ApiError = {
  code: 'INVALID_STATE',
  message: '이미 처리된 문구는 다시 만들거나 승인·거절할 수 없습니다.',
};

export const seoIdempotencyConflictFixture: ApiError = {
  code: 'IDEMPOTENCY_CONFLICT',
  message: '이전 승인 요청과 대상이 달라요.',
};
