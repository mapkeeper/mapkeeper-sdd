import { generateSeoDrafts } from '@/services/seoApi';

describe('MSW browser transport boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  test('mock 모드는 외부 API base URL이 설정되어도 same-origin /api 요청만 사용한다', async () => {
    vi.stubEnv('VITE_API_MOCKING', 'true');
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const result = await generateSeoDrafts({
      storeProfileId: 'store-123',
      purpose: 'INTRODUCTION',
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
      body: JSON.stringify({ storeProfileId: 'store-123', purpose: 'INTRODUCTION', briefText: '따뜻한 동네 맛집', seedKeywords: ['친절함'], sourceReviewIds: ['review-001'] }),
    });
    const envelope = await response.json() as {
      data: { generationId: string; status: string; drafts: Array<{ platform: string; draftText: string }> };
    };

    expect(response.status).toBe(201);
    expect(envelope.data.generationId).toBe('gen-001');
    expect(envelope.data.status).toBe('DRAFT');
    expect(envelope.data.drafts).toEqual(expect.arrayContaining([
      expect.objectContaining({ platform: 'google' }),
      expect.objectContaining({ platform: 'naver' }),
      expect.objectContaining({ platform: 'kakao' }),
    ]));
    expect(envelope.data.drafts.find((draft) => draft.platform === 'google')?.draftText).toContain('따뜻한 동네 맛집');
  });

  test('목적에 따라 문구가 달라지되 어떤 문구도 플랫폼 이름을 쓰지 않는다', async () => {
    const response = await fetch('/api/v1/seo/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeProfileId: 'store-123', purpose: 'NEWS', briefText: '이번 주말 할인 행사', seedKeywords: ['할인'], sourceReviewIds: [] }),
    });
    const envelope = await response.json() as {
      data: { drafts: Array<{ platform: string; draftText: string }> };
    };

    // The demo copy is a screen the owner reads. Naming the platform inside it is
    // a word nobody said, and the real backend never writes one.
    for (const draft of envelope.data.drafts) {
      expect(draft.draftText).toContain('소식');
      expect(draft.draftText.toLowerCase()).not.toMatch(/google|naver|kakao/);
      expect(draft.draftText).not.toMatch(/구글|네이버|카카오/);
    }
    expect(new Set(envelope.data.drafts.map((draft) => draft.draftText)).size).toBe(3);
  });
});
