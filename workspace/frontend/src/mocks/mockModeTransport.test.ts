import { generateSeoDrafts } from '@/services/seoApi';

describe('MSW browser transport boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('mock 모드는 외부 API base URL이 설정되어도 same-origin /api 요청만 사용한다', async () => {
    vi.stubEnv('VITE_API_MOCKING', 'true');
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await generateSeoDrafts({
      storeProfileId: 'store-123',
      briefText: '따뜻한 동네 맛집',
      seedKeywords: ['친절함'],
      sourceReviewIds: ['review-001'],
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/seo/generations', expect.objectContaining({ method: 'POST' }));
    expect(result.data.generationId).toBe('gen-001');
  });

  test('SEO 생성 handler는 201과 세 플랫폼 DRAFT 배열을 반환한다', async () => {
    const response = await fetch('/api/v1/seo/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeProfileId: 'store-123', briefText: '따뜻한 동네 맛집', seedKeywords: ['친절함'], sourceReviewIds: ['review-001'] }),
    });
    const envelope = await response.json() as {
      data: { generationId: string; drafts: Array<{ platform: string; status: string; draftText: string }> };
    };

    expect(response.status).toBe(201);
    expect(envelope.data.generationId).toBe('gen-001');
    expect(envelope.data.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'google', status: 'DRAFT' }),
      expect.objectContaining({ platform: 'naver', status: 'DRAFT' }),
      expect.objectContaining({ platform: 'kakao', status: 'DRAFT' }),
    ]));
    expect(envelope.data.drafts.find((draft) => draft.platform === 'google')?.draftText).toContain('따뜻한 동네 맛집');
  });
});
