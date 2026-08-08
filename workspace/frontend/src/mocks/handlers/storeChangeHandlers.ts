import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import {
  STORE_CHANGE_PROPOSAL_ID,
  buildApproval,
  storeChangeIdempotencyConflictFixture,
  storeChangeInvalidStateErrorFixture,
  storeChangeNotFoundErrorFixture,
  storeChangeStaleProposalErrorFixture,
  storeChangeValidationErrorFixture,
} from '@/mocks/fixtures/storeChangeFixtures';
import { storeProfileFixture } from '@/mocks/fixtures/storeFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import { createStoreChangeRequestSchema, patchStoreChangeRequestSchema } from '@/services/contracts/storeChange';
import type { ProposalChange, StoreChangeApprovalResponse, StoreChangeProposalData } from '@/services/contracts/storeChange';

const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

// This mock generates a structured proposal from free-form Korean text the same way the
// real speech-recognition backend would (API Contract §4). The request is parsed through
// the same strict schema the client and real v0.2 contract share, so a non-UUID
// storeProfileId, an unsupported locale, or an unknown field is rejected exactly like the
// real backend would reject it.

function parseCurrentBusinessHours(): { open: string; close: string } {
  const [open, close] = storeProfileFixture.businessHours.split('-');
  return { open: open ?? '09:00', close: close ?? '22:00' };
}

// The mock only ever changes the closing time from spoken text (the API Contract example
// "영업시간을 오후 8시까지로 바꿔줘" only changes `close`); `open` carries over unchanged.
// 오전/오후/밤 + optional minutes cover the documented 12-hour edge cases: 오전 12시 is
// midnight, 오후 12시 is noon, and 밤 12시 (colloquial "밤" = late night) is also treated as
// midnight even though 밤 hours otherwise add 12 like 오후.
function parseBusinessHoursChange(text: string, currentValue: { open: string; close: string }): ProposalChange {
  const match = text.match(/(오전|오후|밤)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?/);
  if (!match) return { field: 'businessHours', currentValue, proposedValue: { ...currentValue } };
  const [, prefix, hourText, minuteText] = match;
  const hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  let hour24: number;
  if (prefix === '오전') hour24 = hour === 12 ? 0 : hour;
  else if (prefix === '오후') hour24 = hour === 12 ? 12 : hour + 12;
  else if (prefix === '밤') hour24 = hour === 12 ? 0 : hour + 12;
  else hour24 = hour >= 12 ? hour : hour + 12; // bare "N시" in a closing-time sentence defaults to PM
  const close = `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  return { field: 'businessHours', currentValue, proposedValue: { open: currentValue.open, close } };
}

const CLOSURE_YEAR = 2026; // matches the mocked development MOCK_TIMESTAMP year

function toIsoDate(month: string, day: string): string {
  return `${CLOSURE_YEAR}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function parseClosureChange(text: string): ProposalChange | null {
  const range = text.match(/(\d{1,2})월\s*(\d{1,2})일\s*부터\s*(?:(\d{1,2})월\s*)?(\d{1,2})일/);
  if (range) {
    const [, startMonth, startDay, endMonth, endDay] = range;
    if (startMonth && startDay && endDay) {
      return {
        field: 'temporaryClosure',
        currentValue: null,
        proposedValue: { startDate: toIsoDate(startMonth, startDay), endDate: toIsoDate(endMonth ?? startMonth, endDay) },
      };
    }
  }
  const single = text.match(/(\d{1,2})월\s*(\d{1,2})일/);
  if (single) {
    const [, month, day] = single;
    if (!month || !day) return null;
    const date = toIsoDate(month, day);
    return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: date, endDate: date } };
  }
  const nextWeekday = text.match(/다음\s*주\s*([월화수목금토일])요일?/);
  if (nextWeekday?.[1]) {
    const weekdayOffset = '월화수목금토일'.indexOf(nextWeekday[1]);
    const day = String(10 + weekdayOffset).padStart(2, '0');
    return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: `2026-08-${day}`, endDate: `2026-08-${day}` } };
  }
  const relativeDate = text.match(/오늘|내일|모레|다음\s*주/)?.[0];
  if (!relativeDate) return null;
  if (relativeDate === '오늘') {
    return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-03', endDate: '2026-08-03' } };
  }
  if (relativeDate === '내일') {
    return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-04', endDate: '2026-08-04' } };
  }
  if (relativeDate === '모레') {
    return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-05', endDate: '2026-08-05' } };
  }
  return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-10', endDate: '2026-08-16' } };
}

function parseMenuChange(text: string, currentValue: string): ProposalChange | null {
  const match = text.match(/(?:대표\s*)?메뉴(?:를|는|명)?\s*([가-힣A-Za-z0-9 ]+?)(?:으로|로)\s*(?:바꿔|변경|해\s*줘)/);
  const menu = match?.[1]?.trim();
  if (!menu) return null;
  return { field: 'representativeMenuName', currentValue, proposedValue: menu };
}

export function parseStoreChangeText(recognizedText: string): ProposalChange[] {
  const text = recognizedText.trim();
  if (/영업\s*시간|시까지|시부터/.test(text)) {
    return [parseBusinessHoursChange(text, parseCurrentBusinessHours())];
  }
  if (/휴무|쉬(?:어요|겠습니다|는\s*날)|문\s*닫|마감/.test(text)) {
    const change = parseClosureChange(text);
    return change ? [change] : [];
  }
  if (/대표\s*메뉴|메뉴를|메뉴는/.test(text)) {
    const change = parseMenuChange(text, storeProfileFixture.representativeMenuName);
    return change ? [change] : [];
  }
  return [];
}

function maskRecognizedText(text: string): string {
  return text.replace(/\d+\s*시/g, '***').replace(/\d/g, '*');
}

let currentProposal: StoreChangeProposalData | null = null;
interface ApprovalReplayEntry {
  proposalId: string;
  contentSignature: string;
  response: StoreChangeApprovalResponse;
}
const approvalReplay = new Map<string, ApprovalReplayEntry>();

function signature(changes: readonly ProposalChange[]): string {
  return [...changes]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((change) => `${change.field}:${JSON.stringify(change.proposedValue)}`)
    .join('|');
}

export const storeChangeHandlers = [
  http.post('/api/v1/store-change-proposals', async ({ request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const parsed = createStoreChangeRequestSchema.safeParse(await request.json());
    if (!parsed.success) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    currentProposal = {
      proposalId: STORE_CHANGE_PROPOSAL_ID,
      recognizedTextMasked: maskRecognizedText(parsed.data.recognizedText),
      changes: parseStoreChangeText(parsed.data.recognizedText),
      status: 'DRAFT',
    };
    return HttpResponse.json(successEnvelope(currentProposal), { status: 201, ...responseOptions() });
  }),

  http.patch('/api/v1/store-change-proposals/:proposalId', async ({ params, request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    if (!currentProposal || params.proposalId !== currentProposal.proposalId) {
      return HttpResponse.json(errorEnvelope(storeChangeNotFoundErrorFixture), { status: 404, ...responseOptions() });
    }
    if (currentProposal.status !== 'DRAFT') {
      return HttpResponse.json(errorEnvelope(storeChangeInvalidStateErrorFixture), { status: 409, ...responseOptions() });
    }
    const parsed = patchStoreChangeRequestSchema.safeParse(await request.json());
    if (!parsed.success) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    const stale = parsed.data.changes.some((change) => {
      const existing = currentProposal?.changes.find((current) => current.field === change.field);
      return existing !== undefined && JSON.stringify(existing.currentValue) !== JSON.stringify(change.currentValue);
    });
    if (stale) return HttpResponse.json(errorEnvelope(storeChangeStaleProposalErrorFixture), { status: 409, ...responseOptions() });
    currentProposal = { ...currentProposal, changes: parsed.data.changes };
    return HttpResponse.json(successEnvelope(currentProposal), responseOptions());
  }),

  http.post('/api/v1/store-change-proposals/:proposalId/reject', async ({ params }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    if (!currentProposal || params.proposalId !== currentProposal.proposalId) {
      return HttpResponse.json(errorEnvelope(storeChangeNotFoundErrorFixture), { status: 404, ...responseOptions() });
    }
    if (currentProposal.status !== 'DRAFT') {
      return HttpResponse.json(errorEnvelope(storeChangeInvalidStateErrorFixture), { status: 409, ...responseOptions() });
    }
    currentProposal = { ...currentProposal, status: 'REJECTED' };
    return HttpResponse.json(successEnvelope(currentProposal), responseOptions());
  }),

  http.post('/api/v1/store-change-proposals/:proposalId/approve', async ({ params, request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const key = request.headers.get('Idempotency-Key');
    if (!key) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    if (!currentProposal || params.proposalId !== currentProposal.proposalId) {
      return HttpResponse.json(errorEnvelope(storeChangeNotFoundErrorFixture), { status: 404, ...responseOptions() });
    }
    const replayed = approvalReplay.get(key);
    if (replayed) {
      const sameTarget = replayed.proposalId === currentProposal.proposalId && replayed.contentSignature === signature(currentProposal.changes);
      if (!sameTarget) return HttpResponse.json(errorEnvelope(storeChangeIdempotencyConflictFixture), { status: 409, ...responseOptions() });
      return HttpResponse.json(successEnvelope(replayed.response, 'PROCESSING'), responseOptions());
    }
    if (currentProposal.status !== 'DRAFT') {
      return HttpResponse.json(errorEnvelope(storeChangeInvalidStateErrorFixture), { status: 409, ...responseOptions() });
    }
    const response = buildApproval(currentProposal);
    approvalReplay.set(key, { proposalId: currentProposal.proposalId, contentSignature: signature(currentProposal.changes), response });
    currentProposal = { ...currentProposal, status: 'APPROVED' };
    return HttpResponse.json(successEnvelope(response, 'PROCESSING'), responseOptions());
  }),
];

export function resetStoreChangeHandlerState(): void {
  currentProposal = null;
  approvalReplay.clear();
}
