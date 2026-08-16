import { HttpResponse, http } from 'msw';
import { server } from '@/mocks/server';
import {
  approveSeoGeneration,
  generateSeoDrafts,
  regenerateSeoGeneration,
  rejectSeoGeneration,
} from '@/services/seoApi';

const timestamp = '2026-08-03T00:00:00Z';

describe('seoApi', () => {
  test('공통 입력과 마스킹 리뷰 ID로 3개 플랫폼 초안을 생성한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations', async ({ request }) => {
        expect(await request.json()).toEqual({
          storeProfileId: 'store-123',
          purpose: 'INTRODUCTION',
          briefText: '따뜻한 동네 맛집',
          seedKeywords: ['친절함', '만두전골'],
          sourceReviewIds: ['review-001'],
        });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { generationId: 'gen-001', status: 'DRAFT', revision: 1, drafts: [] },
          error: null,
          timestamp,
        }, { headers: { 'X-Request-ID': 'req-seo-create' } });
      }),
    );

    const result = await generateSeoDrafts({
      storeProfileId: 'store-123',
      purpose: 'INTRODUCTION',
      briefText: '따뜻한 동네 맛집',
      seedKeywords: ['친절함', '만두전골'],
      sourceReviewIds: ['review-001'],
    });

    expect(result.requestId).toBe('req-seo-create');
  });

  test('기존 Generation 재생성은 같은 ID에 수정 입력을 보내고 revision을 보존한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations/gen-001/regenerate', async ({ request }) => {
        expect(await request.json()).toEqual({
          purpose: 'INTRODUCTION',
          briefText: '수정한 매장 소개',
          seedKeywords: ['만두전골'],
          sourceReviewIds: ['review-001'],
        });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            generationId: 'gen-001',
            status: 'DRAFT',
            revision: 2,
            drafts: [{
              draftId: 'draft-001',
              platform: 'google',
              draftText: '수정된 문구',
              keywords: ['만두전골'],
              contentRules: ['rule'],
            }],
          },
          error: null,
          timestamp,
        });
      }),
    );

    const result = await regenerateSeoGeneration('gen-001', {
      purpose: 'INTRODUCTION',
      briefText: '수정한 매장 소개',
      seedKeywords: ['만두전골'],
      sourceReviewIds: ['review-001'],
    });

    expect(result.data).toMatchObject({ generationId: 'gen-001', revision: 2, status: 'DRAFT' });
  });

  test('전체 거절은 body 없이 Generation reject endpoint를 호출한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations/gen-001/reject', async ({ request }) => {
        expect(await request.text()).toBe('');
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { generationId: 'gen-001', status: 'REJECTED', revision: 1, drafts: [] },
          error: null,
          timestamp,
        });
      }),
    );

    const result = await rejectSeoGeneration('gen-001');

    expect(result.data.status).toBe('REJECTED');
  });

  test('승인 요청은 Body 없이 Idempotency-Key만 전송한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations/gen-001/approve', async ({ request }) => {
        expect(request.headers.get('Idempotency-Key')).toBe('seo-approval-key-001');
        expect(await request.text()).toBe('');
        return HttpResponse.json({
          success: true,
          status: 'PROCESSING',
          data: {
            generationId: 'gen-001',
            generationStatus: 'APPROVED',
            approvedPlatforms: ['google', 'naver', 'kakao'],
            syncJobId: 'job-001',
            status: 'PENDING',
            statusUrl: '/api/v1/sync-jobs/job-001',
          },
          error: null,
          timestamp,
        }, { headers: { 'X-Request-ID': 'req-seo-approve' } });
      }),
    );

    const result = await approveSeoGeneration('gen-001', 'seo-approval-key-001');
    expect(result).toMatchObject({ status: 'PROCESSING', requestId: 'req-seo-approve' });
    expect(result.data.approvedPlatforms).toEqual(['google', 'naver', 'kakao']);
  });
});
