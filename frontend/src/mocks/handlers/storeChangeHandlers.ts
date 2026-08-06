import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { editedStoreChangeDraftFixture, storeChangeApprovalFixture, storeChangeValidationErrorFixture } from '@/mocks/fixtures/storeChangeFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { CreateStoreChangeRequest, PatchStoreChangeRequest, StoreChangeApprovalResponse } from '@/services/api.types';
import { PROPOSAL_FIELDS } from '@/types/domain';
import type { ProposalChange } from '@/types/domain';
import { storeProfileFixture } from '@/mocks/fixtures/storeFixtures';

const approvalReplay = new Map<string, StoreChangeApprovalResponse>();
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });
const validCreate = (body: Partial<CreateStoreChangeRequest>): body is CreateStoreChangeRequest =>
  typeof body.storeProfileId === 'string' && typeof body.recognizedText === 'string' && typeof body.locale === 'string';

export function parseStoreChangeText(recognizedText: string): ProposalChange[] {
  const text = recognizedText.trim();
  if (/영업\s*시간|시까지/.test(text)) {
    const time = text.match(/(오후\s*)?(\d{1,2})\s*시/);
    if (!time) {
      return [{
        field: 'businessHours',
        currentValue: storeProfileFixture.businessHours,
        proposedValue: '09:00-22:00',
      }];
    }
    const rawHour = Number(time[2]);
    const hour = time[1] && rawHour < 12 ? rawHour + 12 : rawHour;
    return [{
      field: 'businessHours',
      currentValue: storeProfileFixture.businessHours,
      proposedValue: `09:00-${String(hour).padStart(2, '0')}:00`,
    }];
  }
  if (/휴무|쉬(?:어요|겠습니다|는 날)/.test(text)) {
    const date = text.match(/\d{1,2}월\s*\d{1,2}일/)?.[0];
    return [{
      field: 'temporaryClosure',
      currentValue: '영업',
      proposedValue: date ? `${date} 임시 휴무` : '임시 휴무',
    }];
  }
  if (/대표\s*메뉴|메뉴를/.test(text)) {
    const menu = text.match(/(?:대표\s*)?메뉴(?:를|는)?\s*([가-힣A-Za-z0-9 ]+?)(?:으로|로)\s*(?:바꿔|변경)/)?.[1]?.trim();
    if (!menu) return [];
    return [{
      field: 'representativeMenuName',
      currentValue: storeProfileFixture.representativeMenuName,
      proposedValue: menu,
    }];
  }
  return [];
}

export const storeChangeHandlers = [
  http.post('/api/v1/store-change-proposals', async ({ request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<CreateStoreChangeRequest>;
    if (!validCreate(body)) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    const changes = parseStoreChangeText(body.recognizedText);
    return HttpResponse.json(successEnvelope({
      proposalId: 'prop-001',
      recognizedTextMasked: body.recognizedText.replace(/\d+\s*시/g, '***').replace(/\d/g, '*'),
      changes,
      status: 'DRAFT' as const,
    }), responseOptions());
  }),
  http.patch('/api/v1/store-change-proposals/:proposalId', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<PatchStoreChangeRequest>;
    const valid = params.proposalId === 'prop-001' && body.changes?.every((change) => PROPOSAL_FIELDS.includes(change.field));
    if (!valid) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    return HttpResponse.json(successEnvelope({ ...editedStoreChangeDraftFixture, changes: body.changes ?? [] }), responseOptions());
  }),
  http.post('/api/v1/store-change-proposals/:proposalId/approve', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const key = request.headers.get('Idempotency-Key');
    if (!key || params.proposalId !== 'prop-001') return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    const data = approvalReplay.get(key) ?? storeChangeApprovalFixture;
    approvalReplay.set(key, data);
    return HttpResponse.json(successEnvelope(data, 'PROCESSING'), responseOptions());
  }),
];

export function resetStoreChangeHandlerState(): void { approvalReplay.clear(); }
