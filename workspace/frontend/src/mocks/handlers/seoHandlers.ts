import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { seoApprovalFixture, seoGenerationFixture, seoValidationErrorFixture } from '@/mocks/fixtures/seoFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { CreateSeoGenerationRequest, SeoApprovalResponse } from '@/services/api.types';

const approvalReplay = new Map<string, SeoApprovalResponse>();
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

export const seoHandlers = [
  http.post('*/api/v1/seo/generations', async ({ request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<CreateSeoGenerationRequest>;
    if (typeof body.storeProfileId !== 'string' || typeof body.briefText !== 'string' || !Array.isArray(body.seedKeywords) || !Array.isArray(body.sourceReviewIds)) return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    return HttpResponse.json(successEnvelope(seoGenerationFixture), {
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
];

export function resetSeoHandlerState(): void { approvalReplay.clear(); }
