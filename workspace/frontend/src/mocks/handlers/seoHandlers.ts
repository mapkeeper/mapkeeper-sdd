import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { seoApprovalFixture, seoGenerationFixture, seoValidationErrorFixture } from '@/mocks/fixtures/seoFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { CreateSeoGenerationRequest, CreateSeoGenerationResponse, SeoApprovalResponse } from '@/services/api.types';

const approvalReplay = new Map<string, SeoApprovalResponse>();
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

function createMockGeneration(purpose: CreateSeoGenerationRequest['purpose'], briefText: string): CreateSeoGenerationResponse {
  const normalizedBrief = briefText.trim();
  const sentenceEnd = /[.!?。]$/.test(normalizedBrief) ? '' : '.';
  const isNews = purpose === 'NEWS';
  const endings = isNews
    ? { google: ' Google 소식으로 안내해요.', naver: ' 네이버 소식으로 알려드려요.', kakao: ' 카카오 소식으로 전해요.' }
    : { google: ' Google 소개글로 정리했어요.', naver: ' 네이버 소개글로 정리했어요.', kakao: ' 카카오 소개글로 정리했어요.' };
  return {
    ...seoGenerationFixture,
    drafts: seoGenerationFixture.drafts.map((draft) => ({
      ...draft,
      draftText: `${normalizedBrief}${sentenceEnd}${endings[draft.platform]}`,
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
  http.post('*/api/v1/seo/generations/:generationId/reject', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    if (params.generationId !== 'gen-001' || await request.text() !== '') {
      return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    }
    return HttpResponse.json(successEnvelope({ ...seoGenerationFixture, status: 'REJECTED' as const }), responseOptions());
  }),
];

export function resetSeoHandlerState(): void { approvalReplay.clear(); }
