import type { ApiErrorBody, CreateSeoGenerationResponse, SeoApprovalResponse } from '@/services/api.types';

export const seoGenerationFixture: CreateSeoGenerationResponse = {
  generationId: 'gen-001',
  status: 'DRAFT',
  revision: 1,
  drafts: [
    { draftId: 'draft-001', platform: 'google', draftText: '가성비 좋은 대표 메뉴 소개', keywords: ['대표메뉴'], contentRules: ['team-defined-content-rule-1'], status: 'DRAFT' },
    { draftId: 'draft-002', platform: 'naver', draftText: '정성으로 준비한 대표 메뉴를 만나보세요', keywords: ['정성'], contentRules: ['team-defined-content-rule-1'], status: 'DRAFT' },
    { draftId: 'draft-003', platform: 'kakao', draftText: '동네에서 즐기는 맛있는 한 끼', keywords: ['동네맛집'], contentRules: ['team-defined-content-rule-1'], status: 'DRAFT' },
  ],
};

export const seoValidationErrorFixture: ApiErrorBody = {
  code: 'VALIDATION_ERROR', message: 'SEO 문구 내용을 확인해 주세요.',
  details: [{ field: 'briefText', reason: 'required' }],
};
export const seoApprovalFixture: SeoApprovalResponse = {
  generationId: 'gen-001', generationStatus: 'APPROVED',
  approvedPlatforms: ['google', 'naver', 'kakao'], syncJobId: 'job-001',
  status: 'PENDING', statusUrl: '/api/v1/sync-jobs/job-001',
};
