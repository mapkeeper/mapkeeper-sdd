/**
 * Korean public holidays and the runs of days people actually take off.
 *
 * An owner who says "추석 연휴 정상 영업합니다" has already said which days they
 * mean. Asking them to look up 9월 24일~26일 and type it back is work the app
 * should be doing, and it was the single most repeated step in the QA pass.
 *
 * This is a checked-in table, not a lookup: the demo has to work offline and a
 * calendar API call in the middle of an interview is another thing that can
 * fail. It covers the milestone's window; renewing it, or replacing it with
 * 공공데이터포털 특일 정보, is tracked in the QA backlog. The lunar holidays and
 * their runs are the ones owners actually name; the 대체공휴일 tails on the fixed
 * dates are the part to re-check against the official calendar before launch.
 * Nothing here is applied silently — every match is read back for confirmation.
 */
export interface KoreanHoliday {
  /** How the owner is most likely to name it. */
  name: string;
  /** First day of the run people treat as the holiday. */
  start: string;
  /** Last day of that run. */
  end: string;
  /** Spoken forms that identify this holiday, space-insensitive. */
  aliases: readonly string[];
}

export const KOREAN_HOLIDAYS: readonly KoreanHoliday[] = [
  { name: '2026년 설 연휴', start: '2026-02-16', end: '2026-02-18', aliases: ['설연휴', '설날', '구정'] },
  { name: '2026년 삼일절', start: '2026-03-01', end: '2026-03-02', aliases: ['삼일절', '3.1절'] },
  { name: '2026년 어린이날', start: '2026-05-05', end: '2026-05-05', aliases: ['어린이날'] },
  { name: '2026년 부처님오신날', start: '2026-05-24', end: '2026-05-25', aliases: ['부처님오신날', '석가탄신일'] },
  { name: '2026년 현충일', start: '2026-06-06', end: '2026-06-06', aliases: ['현충일'] },
  { name: '2026년 광복절', start: '2026-08-15', end: '2026-08-15', aliases: ['광복절'] },
  { name: '2026년 추석 연휴', start: '2026-09-24', end: '2026-09-26', aliases: ['추석연휴', '추석', '한가위'] },
  { name: '2026년 개천절', start: '2026-10-03', end: '2026-10-05', aliases: ['개천절'] },
  { name: '2026년 한글날', start: '2026-10-09', end: '2026-10-09', aliases: ['한글날'] },
  { name: '2026년 성탄절', start: '2026-12-25', end: '2026-12-25', aliases: ['성탄절', '크리스마스'] },
  { name: '2027년 설 연휴', start: '2027-02-06', end: '2027-02-09', aliases: ['설연휴', '설날', '구정'] },
  { name: '2027년 삼일절', start: '2027-03-01', end: '2027-03-01', aliases: ['삼일절', '3.1절'] },
  { name: '2027년 어린이날', start: '2027-05-05', end: '2027-05-05', aliases: ['어린이날'] },
  { name: '2027년 부처님오신날', start: '2027-05-13', end: '2027-05-13', aliases: ['부처님오신날', '석가탄신일'] },
  { name: '2027년 현충일', start: '2027-06-06', end: '2027-06-07', aliases: ['현충일'] },
  { name: '2027년 광복절', start: '2027-08-15', end: '2027-08-16', aliases: ['광복절'] },
  { name: '2027년 추석 연휴', start: '2027-09-14', end: '2027-09-16', aliases: ['추석연휴', '추석', '한가위'] },
  { name: '2027년 개천절', start: '2027-10-03', end: '2027-10-04', aliases: ['개천절'] },
  { name: '2027년 한글날', start: '2027-10-09', end: '2027-10-11', aliases: ['한글날'] },
  { name: '2027년 성탄절', start: '2027-12-25', end: '2027-12-27', aliases: ['성탄절', '크리스마스'] },
];

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Find the holiday an answer names, preferring the next one still ahead.
 *
 * A holiday that has already passed is still returned when nothing is upcoming,
 * so a late post about last week's 추석 still resolves instead of asking again.
 */
export function matchKoreanHoliday(text: string, referenceDate = new Date()): KoreanHoliday | null {
  const normalized = text.replaceAll(' ', '');
  const today = toDateString(referenceDate);
  const named = KOREAN_HOLIDAYS.filter((holiday) =>
    holiday.aliases.some((alias) => normalized.includes(alias)));
  if (named.length === 0) return null;
  return named.find((holiday) => holiday.end >= today) ?? named[named.length - 1] ?? null;
}

/** Render a holiday range the way it is read aloud: "9월 24일부터 9월 26일까지". */
export function describeHolidayRange(holiday: KoreanHoliday): string {
  const spoken = (value: string): string => {
    const [, month, day] = value.split('-');
    return `${Number(month)}월 ${Number(day)}일`;
  };
  return holiday.start === holiday.end
    ? spoken(holiday.start)
    : `${spoken(holiday.start)}부터 ${spoken(holiday.end)}까지`;
}
