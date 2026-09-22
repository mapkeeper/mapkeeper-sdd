import { FAILURE_COPY } from '@/mocks/fixtures/storeChangeFixtures';
import type { ProposalFailure } from '@/types/domain';

/**
 * One published occurrence of an official Korean holiday.
 *
 * The same shape `adapters/holiday_calendar.py` publishes: the observed period
 * including any 대체공휴일, plus the holiday itself, which is a different closure
 * from the period around it.
 */
export interface KoreanHoliday {
  title: string;
  startDate: string;
  endDate: string;
  observanceDate: string;
}

/**
 * The bundled table the backend reads, copied rather than recomputed.
 *
 * 설날 and 추석 are lunar, so no rule derives them and mock mode has no more
 * right to invent one than the service does. Every row here is transcribed from
 * `workspace/backend/src/mapkeeper/adapters/korean_holidays.json` (KASI 공표 역서,
 * 2024-2027) and ordered by the day each period opens on. A demo sentence naming
 * a year outside that range gets the same date clarification the real API gives
 * rather than an extrapolated date.
 */
export const KOREAN_HOLIDAYS: readonly KoreanHoliday[] = [
  { title: '설날', startDate: '2024-02-09', endDate: '2024-02-12', observanceDate: '2024-02-10' },
  { title: '추석', startDate: '2024-09-16', endDate: '2024-09-18', observanceDate: '2024-09-17' },
  { title: '설날', startDate: '2025-01-28', endDate: '2025-01-30', observanceDate: '2025-01-29' },
  { title: '추석', startDate: '2025-10-05', endDate: '2025-10-08', observanceDate: '2025-10-06' },
  { title: '설날', startDate: '2026-02-16', endDate: '2026-02-18', observanceDate: '2026-02-17' },
  { title: '추석', startDate: '2026-09-24', endDate: '2026-09-26', observanceDate: '2026-09-25' },
  { title: '설날', startDate: '2027-02-06', endDate: '2027-02-09', observanceDate: '2027-02-07' },
  { title: '추석', startDate: '2027-09-14', endDate: '2027-09-16', observanceDate: '2027-09-15' },
];

/**
 * The next occurrence of one holiday, or null when the table does not cover it.
 *
 * A period already under way still counts: an owner inside it says "이번 추석"
 * about the one they are in. ISO dates compare correctly as strings, so no clock
 * or timezone enters the lookup.
 */
export function holidayOccurrence(title: string, onOrAfterIso: string): KoreanHoliday | null {
  return KOREAN_HOLIDAYS.find((event) => event.title === title && event.endDate >= onOrAfterIso) ?? null;
}

function dayInKorean(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

/**
 * The AMBIGUOUS_DATE copy `services/proposal_failure.py` builds for an unpinned holiday.
 *
 * "이번 추석" is either the whole 연휴 or the day itself. Asking without saying what
 * the calendar holds makes the owner look up a lunar date to answer a question the
 * demo can already answer, so the question names the real dates and offers the two
 * sentences they can say straight back.
 */
export function holidayClarificationCopy(event: KoreanHoliday): Omit<ProposalFailure, 'reason' | 'recognizedTextMasked'> {
  const period = `${dayInKorean(event.startDate)}부터 ${dayInKorean(event.endDate)}까지`;
  return {
    message: FAILURE_COPY.AMBIGUOUS_DATE.message,
    guidance: `${event.startDate.slice(0, 4)}년 ${event.title} 연휴는 ${period}이고 ${event.title} 당일은 ${dayInKorean(event.observanceDate)}이에요. 연휴 전체를 쉬시는지 당일만 쉬시는지 정하지 못했어요.`,
    retry: `“${event.title} 연휴 전체”처럼 연휴 전체인지, “${event.title} 당일”처럼 하루인지 함께 말씀해 주세요.`,
    examples: [`${event.title} 연휴 전체 쉽니다`, `${event.title} 당일 하루 쉽니다`],
  };
}
