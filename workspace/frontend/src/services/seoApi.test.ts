import { HttpResponse, http } from 'msw';
import { server } from '@/mocks/server';
import { approveSeoGeneration, createSeoGeneration, regenerateSeoGeneration, rejectSeoGeneration } from '@/services/seoApi';
import { ApiClientError } from '@/services/api';

const timestamp = '2026-08-05T00:00:00Z';
const generationId = '33333333-3333-4333-8333-333333333333';

function draftsFixture(revision: number) {
  return [
    { draftId: `44444444-4444-4444-8444-44444444444${revision}`, platform: 'google', draftText: 'Google용 매장 소개글', keywords: ['만두전골'], contentRules: ['google-rule'] },
    { draftId: `55555555-5555-4555-8555-55555555555${revision}`, platform: 'naver', draftText: 'Naver용 매장 소개글', keywords: ['만두전골'], contentRules: ['naver-rule'] },
    { draftId: `66666666-6666-4666-8666-66666666666${revision}`, platform: 'kakao', draftText: 'Kakao용 매장 소개글', keywords: ['만두전골'], contentRules: ['kakao-rule'] },
  ];
}

describe('seoApi', () => {
  test('공통 입력으로 Generation을 생성하고 request ID를 보존한다', async () => {
    server.use(
      http.post('/api/v1/seo/generations', async ({ request }) => {
        expect(await request.json()).toEqual({
          storeProfileId: '11111111-1111-4111-8111-111111111111',
          briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
          seedKeywords: ['만두전골', '가족외식'],
        });
        return HttpResponse.json(
          {
            success: true,
            status: 'SUCCESS',
            data: { generationId, status: 'DRAFT', revision: 1, drafts: draftsFixture(1) },
            error: null,
            timestamp,
          },
          { status: 201, headers: { 'X-Request-ID': 'req-seo-create' } },
        );
      }),
    );

    const result = await createSeoGeneration({
      storeProfileId: '11111111-1111-4111-8111-111111111111',
      briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
      seedKeywords: ['만두전골', '가족외식'],
    });

    expect(result.requestId).toBe('req-seo-create');
    expect(result.data.drafts.map((draft) => draft.platform)).toEqual(['google', 'naver', 'kakao']);
    expect(result.data.revision).toBe(1);
  });

  test('재생성 요청은 storeProfileId 없이 브리핑과 키워드만 보내고 갱신된 revision을 반환한다', async () => {
    server.use(
      http.post(`/api/v1/seo/generations/${generationId}/regenerate`, async ({ request }) => {
        expect(await request.json()).toEqual({ briefText: '더 강조하고 싶어요.', seedKeywords: ['만두전골'] });
        return HttpResponse.json({
          success: true, status: 'SUCCESS',
          data: { generationId, status: 'DRAFT', revision: 2, drafts: draftsFixture(2) },
          error: null, timestamp,
        });
      }),
    );

    const result = await regenerateSeoGeneration(generationId, { briefText: '더 강조하고 싶어요.', seedKeywords: ['만두전골'] });
    expect(result.data.revision).toBe(2);
  });

  test('거절 요청은 Body 없이 보내고 REJECTED Generation을 반환한다', async () => {
    let sawBody: string | null = null;
    server.use(
      http.post(`/api/v1/seo/generations/${generationId}/reject`, async ({ request }) => {
        sawBody = await request.text();
        return HttpResponse.json({
          success: true, status: 'SUCCESS',
          data: { generationId, status: 'REJECTED', revision: 1, drafts: draftsFixture(1) },
          error: null, timestamp,
        });
      }),
    );

    const result = await rejectSeoGeneration(generationId);
    expect(sawBody).toBe('');
    expect(result.data.status).toBe('REJECTED');
  });

  test('승인 요청은 Body 없이 Idempotency-Key만 보내고 draftIds/approvedPlatforms를 요청에 포함하지 않는다', async () => {
    let sawBody: string | null = null;
    server.use(
      http.post(`/api/v1/seo/generations/${generationId}/approve`, async ({ request }) => {
        expect(request.headers.get('Idempotency-Key')).toBe('seo-approval-key-001');
        sawBody = await request.text();
        return HttpResponse.json(
          {
            success: true,
            status: 'PROCESSING',
            data: {
              generationId,
              generationStatus: 'APPROVED',
              approvedPlatforms: ['google', 'naver', 'kakao'],
              syncJobId: '66666666-6666-4666-8666-666666666666',
              status: 'PENDING',
              statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-seo-approve' } },
        );
      }),
    );

    const result = await approveSeoGeneration(generationId, 'seo-approval-key-001');
    expect(sawBody).toBe('');
    expect(result).toMatchObject({ status: 'PROCESSING', requestId: 'req-seo-approve' });
    expect(result.data.approvedPlatforms).toEqual(['google', 'naver', 'kakao']);
  });

  test('서버가 계약을 어긴 응답(최상위 PARTIAL_SUCCESS)을 보내면 안전한 ApiClientError를 던진다', async () => {
    server.use(
      http.post('/api/v1/seo/generations', () => HttpResponse.json({
        success: true,
        status: 'PARTIAL_SUCCESS',
        data: { generationId, status: 'DRAFT', revision: 1, drafts: draftsFixture(1) },
        error: null,
        timestamp,
      }, { status: 201 })),
    );

    await expect(createSeoGeneration({
      storeProfileId: '11111111-1111-4111-8111-111111111111',
      briefText: '설명',
      seedKeywords: ['키워드'],
    })).rejects.toBeInstanceOf(ApiClientError);
  });
});
