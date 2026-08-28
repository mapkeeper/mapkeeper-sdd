import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { seoApprovalFixture, seoGenerationFixture, seoValidationErrorFixture } from '@/mocks/fixtures/seoFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import { DEMO_STORE } from '@/config/demoStore';
import type { CreateSeoGenerationRequest, CreateSeoGenerationResponse, SeoApprovalResponse } from '@/services/api.types';

const approvalReplay = new Map<string, SeoApprovalResponse>();
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

/**
 * Mirror the shape the real backend produces, not a label naming the platform.
 *
 * The mock used to open every draft with "Google 소식으로 안내해요." — a word nobody
 * said, which the server never writes. Demo mode is a screen the owner reads, so
 * it differentiates by the same contract rules the server follows: Google states
 * verifiable store facts, Naver carries the area and menu a customer searches
 * for, Kakao stays short.
 */
function createMockGeneration(purpose: CreateSeoGenerationRequest['purpose'], briefText: string): CreateSeoGenerationResponse {
  const normalizedBrief = briefText.trim();
  const brief = /[.!?。]$/.test(normalizedBrief) ? normalizedBrief : `${normalizedBrief}.`;
  const region = DEMO_STORE.publicAddress.split(' ').find((part) => /[시군구]$/.test(part) && part !== DEMO_STORE.publicAddress.split(' ')[0]) ?? '';
  const headline = purpose === 'NEWS' ? `${DEMO_STORE.name} 소식` : DEMO_STORE.name;
  const menuLine = purpose === 'NEWS' ? '' : ` 대표 메뉴는 ${DEMO_STORE.representativeMenuName}입니다.`;
  const openings: Record<CreateSeoGenerationResponse['drafts'][number]['platform'], string> = {
    google: `${headline} (${DEMO_STORE.publicAddress})`,
    naver: region ? `${region} ${headline}` : headline,
    kakao: headline,
  };
  const closings: Record<CreateSeoGenerationResponse['drafts'][number]['platform'], string> = {
    google: menuLine,
    naver: menuLine && region ? ` ${region}에서 찾는 대표 메뉴는 ${DEMO_STORE.representativeMenuName}입니다.` : menuLine,
    kakao: '',
  };
  return {
    ...seoGenerationFixture,
    drafts: seoGenerationFixture.drafts.map((draft) => ({
      ...draft,
      draftText: `${openings[draft.platform]}. ${brief}${closings[draft.platform]}`,
    })),
  };
}

export const seoHandlers = [
  http.post('*/api/v1/seo/generations', async ({ request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<CreateSeoGenerationRequest>;
    if (typeof body.storeProfileId !== 'string' || typeof body.briefText !== 'string' || !Array.isArray(body.seedKeywords) || !Array.isArray(body.sourceReviewIds)) return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    return HttpResponse.json(successEnvelope(createMockGeneration(body.purpose ?? 'INTRODUCTION', body.briefText)), {
      status: 201,
      ...responseOptions(),
    });
  }),
  http.post('*/api/v1/seo/generations/:generationId/approve', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const key = request.headers.get('Idempotency-Key');
    if (!key || params.generationId !== 'gen-001') return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    const data = approvalReplay.get(key) ?? seoApprovalFixture;
    approvalReplay.set(key, data);
    return HttpResponse.json(successEnvelope(data, 'PROCESSING'), responseOptions());
  }),
  http.post('*/api/v1/seo/generations/:generationId/regenerate', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<CreateSeoGenerationRequest>;
    if (params.generationId !== 'gen-001' || typeof body.briefText !== 'string' || !Array.isArray(body.seedKeywords)) {
      return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    }
    return HttpResponse.json(successEnvelope({
      ...createMockGeneration(body.purpose ?? 'INTRODUCTION', body.briefText),
      revision: 2,
    }), responseOptions());
  }),
  http.patch('*/api/v1/seo/generations/:generationId/drafts', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const body = await request.json() as { drafts?: { platform?: string; draftText?: string; keywords?: string[] }[] };
    const edits = body.drafts;
    if (params.generationId !== 'gen-001' || !Array.isArray(edits) || edits.length !== 3) {
      return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    }
    return HttpResponse.json(successEnvelope({
      ...seoGenerationFixture,
      revision: 2,
      drafts: seoGenerationFixture.drafts.map((draft) => {
        const edit = edits.find((item) => item.platform === draft.platform);
        return edit?.draftText
          ? { ...draft, draftText: edit.draftText, keywords: edit.keywords ?? draft.keywords }
          : draft;
      }),
    }), responseOptions());
  }),
  http.post('*/api/v1/seo/generations/:generationId/reject', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    if (params.generationId !== 'gen-001' || await request.text() !== '') {
      return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    }
    return HttpResponse.json(successEnvelope({ ...seoGenerationFixture, status: 'REJECTED' as const }), responseOptions());
  }),
];

export function resetSeoHandlerState(): void { approvalReplay.clear(); }
