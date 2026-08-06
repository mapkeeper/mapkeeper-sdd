import type { ApiErrorBody, CreateSeoGenerationResponse, PatchSeoDraftResponse, SeoApprovalResponse } from '@/services/api.types';

export const seoGenerationFixture: CreateSeoGenerationResponse = {
  generationId: 'gen-001',
  drafts: [
    { draftId: 'draft-001', platform: 'google', draftText: '가성비 좋은 대표 메뉴 소개', contentRules: ['team-defined-content-rule-1'], status: 'DRAFT' },
    { draftId: 'draft-002', platform: 'naver', draftText: '정성으로 준비한 대표 메뉴를 만나보세요', contentRules: ['team-defined-content-rule-1'], status: 'DRAFT' },
    { draftId: 'draft-003', platform: 'kakao', draftText: '동네에서 즐기는 맛있는 한 끼', contentRules: ['team-defined-content-rule-1'], status: 'DRAFT' },
  ],
};

export const editedSeoDraftFixture: PatchSeoDraftResponse = { draftId: 'draft-001', status: 'DRAFT', draftText: '수정된 소개글' };
export const seoValidationErrorFixture: ApiErrorBody = {
  code: 'VALIDATION_ERROR', message: '선택한 문구를 확인해 주세요.',
  details: [{ field: 'draftIds', reason: 'at least one draft is required' }],
};
export const seoApprovalFixture: SeoApprovalResponse = {
  generationId: 'gen-001', syncJobId: 'job-001', statusUrl: '/api/v1/sync-jobs/job-001',
};
