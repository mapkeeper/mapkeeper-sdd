import { createSeoGeneration } from '@/services/seoApi';

describe('MSW browser transport boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('mock 모드는 외부 API base URL이 설정되어도 same-origin /api 요청만 사용한다', async () => {
    vi.stubEnv('VITE_API_MOCKING', 'true');
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await createSeoGeneration({
      storeProfileId: '11111111-1111-4111-8111-111111111111',
      briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
      seedKeywords: ['만두전골'],
    });

    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/seo/generations', expect.objectContaining({ method: 'POST' }));
    expect(result.data.status).toBe('DRAFT');
    expect(result.data.revision).toBe(1);
  });

  test('SEO 생성 handler는 201과 플랫폼별 결과를 반환한다', async () => {
    const response = await fetch('/api/v1/seo/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        storeProfileId: '11111111-1111-4111-8111-111111111111',
        briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
        seedKeywords: ['만두전골'],
      }),
    });
    const envelope = await response.json() as {
      data: { generationId: string; status: string; drafts: Array<{ platform: string }> };
    };

    expect(response.status).toBe(201);
    expect(envelope.data.status).toBe('DRAFT');
    expect(envelope.data.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'google' }),
      expect.objectContaining({ platform: 'naver' }),
      expect.objectContaining({ platform: 'kakao' }),
    ]));
  });
});
