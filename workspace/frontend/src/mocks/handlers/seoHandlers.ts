import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import {
  buildApproval,
  buildDrafts,
  buildGeneration,
  seoIdempotencyConflictFixture,
  seoInvalidStateErrorFixture,
  seoNotFoundErrorFixture,
  seoValidationErrorFixture,
} from '@/mocks/fixtures/seoFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import { seoCommonInputSchema } from '@/services/contracts/seo';
import type { ApproveSeoGenerationResponse, ContentGenerationData } from '@/services/contracts/seo';

const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

// `storeProfileId` / `sourceReviewIds` are accepted as opaque strings here (not
// UUID-validated) because the running app still passes placeholder, non-UUID fixture
// IDs everywhere - migrating every shared fixture to real UUIDs is Todo 5's job. The
// part of the request this slice owns, `briefText` / `seedKeywords`, is validated
// strictly against the same schema the client and the real v0.2 contract share.
function parseCommonInput(body: unknown): { briefText: string; seedKeywords: string[] } | null {
  if (typeof body !== 'object' || body === null) return null;
  const record = body as Record<string, unknown>;
  const parsed = seoCommonInputSchema.safeParse({ briefText: record.briefText, seedKeywords: record.seedKeywords });
  return parsed.success ? parsed.data : null;
}

let currentGeneration: ContentGenerationData | null = null;
interface ApprovalReplayEntry {
  generationId: string;
  revision: number;
  response: ApproveSeoGenerationResponse;
}
const approvalReplay = new Map<string, ApprovalReplayEntry>();

export const seoHandlers = [
  http.post('*/api/v1/seo/generations', async ({ request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const body = await request.json();
    const input = parseCommonInput(body);
    const storeProfileId = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).storeProfileId : undefined;
    if (!input || typeof storeProfileId !== 'string' || storeProfileId.length === 0) {
      return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    }
    currentGeneration = buildGeneration(input.seedKeywords);
    return HttpResponse.json(successEnvelope(currentGeneration), { status: 201, ...responseOptions() });
  }),

  http.post('*/api/v1/seo/generations/:generationId/regenerate', async ({ params, request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    if (!currentGeneration || params.generationId !== currentGeneration.generationId) {
      return HttpResponse.json(errorEnvelope(seoNotFoundErrorFixture), { status: 404, ...responseOptions() });
    }
    if (currentGeneration.status !== 'DRAFT') {
      return HttpResponse.json(errorEnvelope(seoInvalidStateErrorFixture), { status: 409, ...responseOptions() });
    }
    const body = await request.json();
    const input = parseCommonInput(body);
    if (!input) return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    currentGeneration = {
      ...currentGeneration,
      revision: currentGeneration.revision + 1,
      drafts: buildDrafts(input.seedKeywords),
    };
    return HttpResponse.json(successEnvelope(currentGeneration), responseOptions());
  }),

  http.post('*/api/v1/seo/generations/:generationId/reject', async ({ params }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    if (!currentGeneration || params.generationId !== currentGeneration.generationId) {
      return HttpResponse.json(errorEnvelope(seoNotFoundErrorFixture), { status: 404, ...responseOptions() });
    }
    if (currentGeneration.status !== 'DRAFT') {
      return HttpResponse.json(errorEnvelope(seoInvalidStateErrorFixture), { status: 409, ...responseOptions() });
    }
    currentGeneration = { ...currentGeneration, status: 'REJECTED' };
    return HttpResponse.json(successEnvelope(currentGeneration), responseOptions());
  }),

  http.post('*/api/v1/seo/generations/:generationId/approve', async ({ params, request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const key = request.headers.get('Idempotency-Key');
    if (!key) return HttpResponse.json(errorEnvelope(seoValidationErrorFixture), { status: 422, ...responseOptions() });
    if (!currentGeneration || params.generationId !== currentGeneration.generationId) {
      return HttpResponse.json(errorEnvelope(seoNotFoundErrorFixture), { status: 404, ...responseOptions() });
    }
    const replayed = approvalReplay.get(key);
    if (replayed) {
      const sameTarget = replayed.generationId === currentGeneration.generationId && replayed.revision === currentGeneration.revision;
      if (!sameTarget) return HttpResponse.json(errorEnvelope(seoIdempotencyConflictFixture), { status: 409, ...responseOptions() });
      return HttpResponse.json(successEnvelope(replayed.response, 'PROCESSING'), responseOptions());
    }
    if (currentGeneration.status !== 'DRAFT') {
      return HttpResponse.json(errorEnvelope(seoInvalidStateErrorFixture), { status: 409, ...responseOptions() });
    }
    const response = buildApproval(currentGeneration);
    approvalReplay.set(key, { generationId: currentGeneration.generationId, revision: currentGeneration.revision, response });
    currentGeneration = { ...currentGeneration, status: 'APPROVED' };
    return HttpResponse.json(successEnvelope(response, 'PROCESSING'), responseOptions());
  }),
];

export function resetSeoHandlerState(): void {
  currentGeneration = null;
  approvalReplay.clear();
}
