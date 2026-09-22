import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { storeChangeApprovalFixture, storeChangeValidationErrorFixture } from '@/mocks/fixtures/storeChangeFixtures';
import { holidayClarificationCopy, holidayOccurrence } from '@/mocks/fixtures/holidayFixtures';
import type { KoreanHoliday } from '@/mocks/fixtures/holidayFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { ApiErrorBody, CreateStoreChangeRequest, PatchStoreChangeRequest, ProposalChangeRequest, StoreChangeApprovalResponse } from '@/services/api.types';
import { PROPOSAL_FIELDS } from '@/types/domain';
import type { ProposalFailureReason } from '@/types/domain';
import { FAILURE_COPY } from '@/mocks/fixtures/storeChangeFixtures';
import { storeProfileFixture } from '@/mocks/fixtures/storeFixtures';
import { DEMO_STORE } from '@/config/demoStore';

const approvalReplay = new Map<string, StoreChangeApprovalResponse>();
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });
const multipleMenuRequest = /(?:와|과|및|그리고)/;
const validCreate = (body: Partial<CreateStoreChangeRequest>): body is CreateStoreChangeRequest =>
  typeof body.storeProfileId === 'string' && typeof body.recognizedText === 'string' && typeof body.locale === 'string';

const CLOSURE_WORDS = /휴무|휴업|휴일|쉬|쉽니|쉼|쉴|문\s*(?:을\s*)?닫|영업\s*(?:을\s*)?안\s*(?:해|합니|하)/;
const CLAUSE_SPLIT = /(?:\s*(?:그리고|이고|하고|되고|고|이며|하며)\s+|[,;\n]\s*)/;
const PARKING_SUBJECT = String.raw`주차\s*(?:정보|공간|장)?\s*(?:는|은|가|이|도)?\s*`;
const PARKING_UNAVAILABLE = new RegExp(`${PARKING_SUBJECT}(?:불가능|불가|안\\s*(?:됩니다|돼요|된다|돼|되고)|어렵습니다|없습니다|없어요)`);
const PARKING_AVAILABLE = new RegExp(`${PARKING_SUBJECT}(?:가능합니다|가능해요|가능|됩니다|돼요|된다)`);
const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const DURATION_WORDS: Record<string, number> = { 하루: 1, 이틀: 2, 사흘: 3, 나흘: 4, 닷새: 5, 엿새: 6, 일주일: 7 };
// "설" alone starts ordinary words ("설명", "설거지"), so it is only the holiday
// when a qualifier follows it - the same reading `adapters/intent.py` does.
const HOLIDAY_TITLES: Record<string, string> = { 추석: '추석', 한가위: '추석', 설날: '설날', 구정: '설날', 설: '설날' };
const HOLIDAY_PATTERN = /(추석|한가위|설날|구정|설(?=\s*(?:연휴|당일)))\s*(연휴\s*전체|연휴|당일|날(?!짜))?/;
// A holiday that already happened, or one a year away. Neither is the closure the
// next occurrence would propose.
const SHIFTED_YEAR_WORDS = /작년|재작년|지난해|지난|내년|내후년/;

function isoOf(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function dateOf(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year ?? 0, (month ?? 1) - 1, day ?? 1);
}

function addDays(from: Date, days: number): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + days);
  return next;
}

/** Monday-based weekday index, matching the backend's `date.weekday()`. */
function weekdayIndex(value: Date): number {
  return (value.getDay() + 6) % 7;
}

/** The holiday a sentence names, with how much of it was asked for. */
function namedHoliday(text: string, today: Date): { event: KoreanHoliday; qualifier: string | null } | null {
  const match = HOLIDAY_PATTERN.exec(text);
  const title = match?.[1] ? HOLIDAY_TITLES[match[1]] : undefined;
  if (!title || SHIFTED_YEAR_WORDS.test(text)) return null;
  const event = holidayOccurrence(title, isoOf(today));
  if (!event) return null;
  return { event, qualifier: match?.[2]?.replace(/\s/g, '') ?? null };
}

/**
 * The exact days a named holiday covers, or null when the sentence did not say.
 *
 * "추석 연휴" is the whole published period and "추석 당일" is the one day, so a bare
 * "이번 추석" is two different closures at once and is left for the owner to be
 * asked about rather than guessed at.
 */
function holidayDates(text: string, today: Date): [Date, Date] | null {
  const named = namedHoliday(text, today);
  if (!named) return null;
  const { event, qualifier } = named;
  if (qualifier?.startsWith('연휴')) return [dateOf(event.startDate), dateOf(event.endDate)];
  if (qualifier === '당일' || qualifier === '날') return [dateOf(event.observanceDate), dateOf(event.observanceDate)];
  // A holiday that lasts one day says the same thing either way.
  if (event.startDate === event.endDate) return [dateOf(event.startDate), dateOf(event.endDate)];
  return null;
}

/** The holiday a refusal can name dates for: named, but never pinned to days. */
function unresolvedHolidayEvent(text: string, today: Date): KoreanHoliday | null {
  const named = namedHoliday(text.trim(), today);
  if (!named || named.qualifier !== null) return null;
  return named.event.startDate === named.event.endDate ? null : named.event;
}

function relativeDates(text: string, today: Date): [Date, Date] | null {
  // A named holiday is the most specific reading: "이번 주 추석 연휴" names the
  // published period, not the seven days of this week.
  const holiday = holidayDates(text, today);
  if (holiday) return holiday;
  const nextWeekday = /(?<!다)다음\s*주\s*([월화수목금토일])요일?/.exec(text);
  const mondayThisWeek = addDays(today, -weekdayIndex(today));
  if (nextWeekday?.[1]) {
    const resolved = addDays(mondayThisWeek, 7 + WEEKDAYS.indexOf(nextWeekday[1]));
    return [resolved, resolved];
  }
  if (/(?<!다)다음\s*주/.test(text)) return [addDays(mondayThisWeek, 7), addDays(mondayThisWeek, 13)];
  const thisWeekday = /이번\s*주\s*([월화수목금토일])요일?/.exec(text);
  if (thisWeekday?.[1]) {
    const resolved = addDays(mondayThisWeek, WEEKDAYS.indexOf(thisWeekday[1]));
    return [resolved, resolved];
  }
  if (/이번\s*주/.test(text)) return [mondayThisWeek, addDays(mondayThisWeek, 6)];
  for (const [keyword, offset] of [['오늘', 0], ['내일', 1], ['모레', 2]] as const) {
    if (text.includes(keyword)) {
      const resolved = addDays(today, offset);
      return [resolved, resolved];
    }
  }
  return null;
}

function koreanDates(text: string, today: Date): Date[] {
  return [...text.matchAll(/(?:(\d{4})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)]
    .map((match) => new Date(Number(match[1] ?? today.getFullYear()), Number(match[2]) - 1, Number(match[3])));
}

function spanEnd(segment: string, start: Date, today: Date): Date | null {
  const explicit = koreanDates(segment, today);
  if (explicit.length > 0) return explicit[explicit.length - 1] ?? null;
  const bareDay = /^(\d{1,2})\s*일$/.exec(segment);
  if (bareDay?.[1]) return new Date(start.getFullYear(), start.getMonth(), Number(bareDay[1]));
  const bareWeekday = /^([월화수목금토일])\s*요일?$/.exec(segment);
  if (bareWeekday?.[1]) {
    return addDays(start, (WEEKDAYS.indexOf(bareWeekday[1]) - weekdayIndex(start) + 7) % 7);
  }
  return relativeDates(segment, today)?.[1] ?? null;
}

/** Both ends of a "…부터 …까지" range, or null when either cannot be read. */
function dateSpan(text: string, today: Date): [Date, Date] | null {
  const span = /(.+?)\s*부터\s*(.+?)\s*까지/.exec(text);
  if (!span?.[1] || !span[2]) return null;
  const startSegment = span[1].trim();
  const start = koreanDates(startSegment, today)[0] ?? relativeDates(startSegment, today)?.[0] ?? null;
  if (!start) return null;
  const end = spanEnd(span[2].trim(), start, today);
  return end ? [start, end] : null;
}

function closureDates(text: string, today: Date): [string, string] | null {
  const span = dateSpan(text, today);
  if (span) return [isoOf(span[0]), isoOf(span[1])];
  if (/부터[\s\S]*까지/.test(text)) return null;
  const explicit = koreanDates(text, today);
  if (explicit.length === 1 && explicit[0]) return [isoOf(explicit[0]), isoOf(explicit[0])];
  if (explicit.length >= 2 && explicit[0] && explicit[1]) return [isoOf(explicit[0]), isoOf(explicit[1])];
  const relative = relativeDates(text, today);
  if (!relative) return null;
  const duration = /(?:(\d{1,2})\s*일(?:간|동안)?|(하루|이틀|사흘|나흘|닷새|엿새|일주일))/.exec(text);
  const days = duration ? Number(duration[1] ?? DURATION_WORDS[duration[2] ?? ''] ?? 0) : 0;
  return days > 0 ? [isoOf(relative[0]), isoOf(addDays(relative[0], days - 1))] : [isoOf(relative[0]), isoOf(relative[1])];
}

function parseStatement(text: string, today: Date): ProposalChangeRequest | null {
  if (/대표\s*메뉴|주력\s*메뉴|메뉴를/.test(text)) {
    const menu = /(?:대표\s*|주력\s*)?메뉴(?:명)?(?:를|은|는)?\s*(.+?)\s*(?:으로|로)\s*(?:바꿔|바꾸|변경|수정|해)/.exec(text)?.[1]?.trim();
    if (menu && !(multipleMenuRequest.test(menu) && !/(세트|정식|모둠|모듬|플래터)$/.test(menu))) {
      return { field: 'representativeMenuName', currentValue: storeProfileFixture.representativeMenuName, proposedValue: menu };
    }
    return null;
  }
  if (/주차/.test(text)) {
    const stated = /주차\s*(?:정보|공간|장)?(?:를|을|은|는)?\s*(.+?)\s*(?:으로|로)\s*(?:바꿔|바꾸|변경|수정)/.exec(text)?.[1]?.trim();
    if (stated) return { field: 'parkingInfo', currentValue: DEMO_STORE.parkingInfo, proposedValue: stated };
    // "주차는 불가능합니다" names no value to copy but still states one.
    if (PARKING_UNAVAILABLE.test(text)) return { field: 'parkingInfo', currentValue: DEMO_STORE.parkingInfo, proposedValue: '주차 불가' };
    if (PARKING_AVAILABLE.test(text)) return { field: 'parkingInfo', currentValue: DEMO_STORE.parkingInfo, proposedValue: '주차 가능' };
    return null;
  }
  if (CLOSURE_WORDS.test(text)) {
    const dates = closureDates(text, today);
    if (dates) return { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: dates[0], endDate: dates[1] } };
  }
  if (/영업\s*시간|시까지|시부터|오픈|마감/.test(text)) {
    const times = [...text.matchAll(/(새벽|아침|오전|점심|오후|저녁|밤)?\s*(\d{1,2})\s*시/g)];
    const only = times.length === 1 ? times[0] : undefined;
    if (!only) return null;
    const spoken = hourMinute(only);
    if (!spoken) return null;
    const opens = /열|오픈|시작|개점/.test(text) && !/닫|마감|종료|폐점|까지/.test(text);
    return {
      field: 'businessHours',
      currentValue: { open: '09:00', close: '22:00' },
      proposedValue: opens ? { open: spoken, close: '22:00' } : { open: '09:00', close: spoken },
    };
  }
  return null;
}

function hourMinute(match: RegExpMatchArray): string | null {
  const meridiem = match[1];
  const rawHour = Number(match[2]);
  if (meridiem ? rawHour > 12 : rawHour > 23) return null;
  const hour = meridiem === '밤' && rawHour === 12
    ? 0
    : (['오후', '저녁', '밤', '점심'].includes(meridiem ?? '') && rawHour < 12 ? rawHour + 12 : rawHour);
  return `${String(hour).padStart(2, '0')}:00`;
}

/**
 * The same reading the backend does, so mock mode and the real API agree.
 *
 * A compound sentence becomes one change per request rather than one change and
 * a dropped half, and a range carries both of its ends.
 */
export function parseStoreChangeText(recognizedText: string, today: Date = new Date()): ProposalChangeRequest[] {
  const text = recognizedText.trim();
  const whole = parseStatement(text, today);
  const clauses = text.split(CLAUSE_SPLIT).map((clause) => clause.trim()).filter(Boolean);
  if (clauses.length > 1) {
    const byField = new Map<string, ProposalChangeRequest>();
    let split = true;
    for (const clause of clauses) {
      const change = parseStatement(clause, today);
      if (!change) continue;
      // Two clauses about one field are two halves of one statement.
      if (byField.has(change.field)) { split = false; break; }
      byField.set(change.field, change);
    }
    if (split && byField.size > (whole ? 1 : 0)) return [...byField.values()];
  }
  return whole ? [whole] : [];
}

/**
 * The refusal the real API builds for a sentence it read nothing from.
 *
 * An unpinned holiday keeps the contract's AMBIGUOUS_DATE reason - no new enum
 * value for the screen to learn - and only swaps in the copy that names the
 * period's real dates.
 */
export function storeChangeFailureBody(text: string, today: Date = new Date()): ApiErrorBody {
  const reason = failureReason(text);
  const holiday = reason === 'AMBIGUOUS_DATE' ? unresolvedHolidayEvent(text, today) : null;
  const copy = holiday ? holidayClarificationCopy(holiday) : FAILURE_COPY[reason];
  return {
    code: 'VALIDATION_ERROR',
    message: copy.message,
    details: [],
    failure: { reason, ...copy, recognizedTextMasked: text },
  };
}

function failureReason(text: string): ProposalFailureReason {
  if (/(?:대표\s*)?메뉴/.test(text) && multipleMenuRequest.test(text)) return 'MULTIPLE_MENU_CANDIDATES';
  const statesClosure = CLOSURE_WORDS.test(text);
  const statesHours = /영업\s*시간|오픈\s*시간|마감\s*시간|문\s*을?|마감|오픈|열|닫/.test(text);
  if (statesClosure || /휴무|휴업|휴일|쉬/.test(text)) {
    if (/부터[\s\S]*까지/.test(text)) return 'UNREADABLE_DATE_RANGE';
    if (statesHours && !/\d{1,2}\s*시/.test(text) && /오전|오후|저녁|아침|새벽|점심|밤|낮/.test(text)) return 'AMBIGUOUS_TIME';
    return 'AMBIGUOUS_DATE';
  }
  if (statesHours) return 'AMBIGUOUS_TIME';
  if (!/대표\s*메뉴|주력\s*메뉴|메뉴|주차/.test(text)) return 'UNSUPPORTED_FIELD';
  return 'NO_CHANGE_FOUND';
}

export const storeChangeHandlers = [
  http.post('*/api/v1/store-change-proposals', async ({ request }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<CreateStoreChangeRequest>;
    if (!validCreate(body)) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    // One reference date for both readings, so a request that crosses midnight
    // cannot be parsed against one day and refused against the next.
    const today = new Date();
    const changes = parseStoreChangeText(body.recognizedText, today);
    // The real API never returns a proposal with nothing in it: an unread
    // sentence is a refusal that names its cause and hands the words back.
    if (changes.length === 0) {
      return HttpResponse.json(errorEnvelope(storeChangeFailureBody(body.recognizedText.trim(), today)), { status: 422, ...responseOptions() });
    }
    if (changes.every((change) => JSON.stringify(change.currentValue) === JSON.stringify(change.proposedValue))) {
      const copy = FAILURE_COPY.NO_EFFECTIVE_CHANGE;
      return HttpResponse.json(errorEnvelope({
        code: 'INVALID_STATE',
        message: '현재 매장 정보와 달라진 내용이 없습니다.',
        details: [],
        failure: { reason: 'NO_EFFECTIVE_CHANGE', ...copy, recognizedTextMasked: body.recognizedText.trim() },
      }), { status: 409, ...responseOptions() });
    }
    return HttpResponse.json(successEnvelope({
      proposalId: 'prop-001',
      recognizedTextMasked: body.recognizedText.replace(/\d+\s*시/g, '***').replace(/\d/g, '*'),
      changes,
      status: 'DRAFT' as const,
    }), responseOptions());
  }),
  http.patch('*/api/v1/store-change-proposals/:proposalId', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const body = await request.json() as Partial<PatchStoreChangeRequest>;
    const valid = params.proposalId === 'prop-001' && body.changes?.every((change) => PROPOSAL_FIELDS.includes(change.field));
    if (!valid) return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    return HttpResponse.json(successEnvelope({
      proposalId: 'prop-001',
      recognizedTextMasked: '수정된 변경안',
      changes: body.changes ?? [],
      status: 'DRAFT' as const,
    }), responseOptions());
  }),
  http.post('*/api/v1/store-change-proposals/:proposalId/approve', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    const key = request.headers.get('Idempotency-Key');
    if (!key || params.proposalId !== 'prop-001') return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    const data = approvalReplay.get(key) ?? storeChangeApprovalFixture;
    approvalReplay.set(key, data);
    return HttpResponse.json(successEnvelope(data, 'PROCESSING'), responseOptions());
  }),
  http.post('*/api/v1/store-change-proposals/:proposalId/reject', async ({ params, request }) => {
    await mockDelay(scenarioLatency());
    if (params.proposalId !== 'prop-001' || await request.text() !== '') {
      return HttpResponse.json(errorEnvelope(storeChangeValidationErrorFixture), { status: 422, ...responseOptions() });
    }
    return HttpResponse.json(successEnvelope({
      proposalId: 'prop-001',
      recognizedTextMasked: '반영하지 않은 변경안',
      changes: [{
        field: 'businessHours' as const,
        currentValue: { open: '09:00', close: '22:00' },
        proposedValue: { open: '09:00', close: '20:00' },
      }],
      status: 'REJECTED' as const,
    }), responseOptions());
  }),
];

export function resetStoreChangeHandlerState(): void { approvalReplay.clear(); }
