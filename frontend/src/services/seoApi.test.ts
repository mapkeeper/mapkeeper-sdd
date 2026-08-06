import { HttpResponse, http } from 'msw';
import { server } from '@/mocks/server';
import { approveSeoGeneration, generateSeoDrafts, patchSeoDraft } from '@/services/seoApi';

const timestamp = '2026-08-03T00:00:00Z';

describe('seoApi', () => {
  test('선택한 마스킹 리뷰 ID로 3개 플랫폼 초안을 생성하고 request ID를 보존한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations', async ({ request }) => {
        expect(await request.json()).toEqual({
          storeProfileId: 'store-123',
          sourceReviewIds: ['review-001'],
        });
        return HttpResponse.json(
          {
            success: true,
            status: 'SUCCESS',
            data: {
              generationId: 'gen-001',
              drafts: [
                { draftId: 'draft-001', platform: 'google', draftText: '구글 문구', contentRules: ['google-rule'], status: 'DRAFT' },
                { draftId: 'draft-002', platform: 'naver', draftText: '네이버 문구', contentRules: ['naver-rule'], status: 'DRAFT' },
                { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 문구', contentRules: ['kakao-rule'], status: 'DRAFT' },
              ],
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-seo-create' } },
        );
      }),
    );

    const result = await generateSeoDrafts({
      storeProfileId: 'store-123',
      sourceReviewIds: ['review-001'],
    });

    expect(result.requestId).toBe('req-seo-create');
    expect(result.data.drafts.map((draft: { platform: string }) => draft.platform)).toEqual([
      'google',
      'naver',
      'kakao',
    ]);
  });

  test('플랫폼 초안 수정은 draftText만 보내고 상태를 DRAFT로 유지한다', async () => {
    server.use(
      http.patch('/api/v1/seo/drafts/draft-001', async ({ request }) => {
        expect(await request.json()).toEqual({ draftText: '수정된 구글 소개글' });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { draftId: 'draft-001', status: 'DRAFT', draftText: '수정된 구글 소개글' },
          error: null,
          timestamp,
        });
      }),
    );

    const result = await patchSeoDraft('draft-001', { draftText: '수정된 구글 소개글' });
    expect(result.data).toEqual({ draftId: 'draft-001', status: 'DRAFT', draftText: '수정된 구글 소개글' });
  });

  test('승인 요청은 선택한 draftIds와 필수 Idempotency-Key를 계약 endpoint로 전송한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations/gen-001/approve', async ({ request }) => {
        expect(request.headers.get('Idempotency-Key')).toBe('seo-approval-key-001');
        expect(await request.json()).toEqual({ draftIds: ['draft-001', 'draft-003'] });
        return HttpResponse.json(
          {
            success: true,
            status: 'PROCESSING',
            data: {
              generationId: 'gen-001',
              syncJobId: 'job-001',
              statusUrl: '/api/v1/sync-jobs/job-001',
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-seo-approve' } },
        );
      }),
    );

    const result = await approveSeoGeneration(
      'gen-001',
      { draftIds: ['draft-001', 'draft-003'] },
      'seo-approval-key-001',
    );
    expect(result).toMatchObject({ status: 'PROCESSING', requestId: 'req-seo-approve' });
  });
});
