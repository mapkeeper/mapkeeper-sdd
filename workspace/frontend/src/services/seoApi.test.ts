import { HttpResponse, http } from 'msw';
import { server } from '@/mocks/server';
import { approveSeoGeneration, generateSeoDrafts } from '@/services/seoApi';

const timestamp = '2026-08-03T00:00:00Z';

describe('seoApi', () => {
  test('공통 입력과 마스킹 리뷰 ID로 3개 플랫폼 초안을 생성한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations', async ({ request }) => {
        expect(await request.json()).toEqual({
          storeProfileId: 'store-123',
          briefText: '따뜻한 동네 맛집',
          seedKeywords: ['친절함', '만두전골'],
          sourceReviewIds: ['review-001'],
        });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { generationId: 'gen-001', drafts: [] },
          error: null,
          timestamp,
        }, { headers: { 'X-Request-ID': 'req-seo-create' } });
      }),
    );

    const result = await generateSeoDrafts({
      storeProfileId: 'store-123',
      briefText: '따뜻한 동네 맛집',
      seedKeywords: ['친절함', '만두전골'],
      sourceReviewIds: ['review-001'],
    });

    expect(result.requestId).toBe('req-seo-create');
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
