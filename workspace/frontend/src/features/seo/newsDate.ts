export interface NewsDateRange {
  start: string;
  end: string;
}

export interface ParsedNewsSchedule {
  range: NewsDateRange | null;
  hasNoDate: boolean;
}

function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function shiftDate(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + days);
  return shifted;
}

function createDate(year: number, month: number, day: number): Date | null {
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

function rangeFromDates(start: Date, end: Date): NewsDateRange {
  return { start: toDateString(start), end: toDateString(end) };
}

function parseExplicitRange(text: string, referenceDate: Date): NewsDateRange | null {
  const fullDates = [...text.matchAll(/(20\d{2})\s*[./-년]\s*(\d{1,2})\s*[./-월]\s*(\d{1,2})\s*일?/g)];
  if (fullDates.length >= 2) {
    const start = createDate(Number(fullDates[0]?.[1]), Number(fullDates[0]?.[2]), Number(fullDates[0]?.[3]));
    const end = createDate(Number(fullDates[1]?.[1]), Number(fullDates[1]?.[2]), Number(fullDates[1]?.[3]));
    if (start && end && start <= end) return rangeFromDates(start, end);
  }

  const koreanRange = text.match(/(\d{1,2})월\s*(\d{1,2})일?\s*(?:부터|~|[-–])\s*(?:(\d{1,2})월\s*)?(\d{1,2})일?/);
  if (koreanRange) {
    const year = referenceDate.getFullYear();
    const start = createDate(year, Number(koreanRange[1]), Number(koreanRange[2]));
    const end = createDate(year, Number(koreanRange[3] ?? koreanRange[1]), Number(koreanRange[4]));
    if (start && end && start <= end) return rangeFromDates(start, end);
  }

  const numericRange = text.match(/(\d{1,2})[./](\d{1,2})\s*(?:부터|~|[-–])\s*(?:(\d{1,2})[./])?(\d{1,2})/);
  if (numericRange) {
    const year = referenceDate.getFullYear();
    const start = createDate(year, Number(numericRange[1]), Number(numericRange[2]));
    const end = createDate(year, Number(numericRange[3] ?? numericRange[1]), Number(numericRange[4]));
    if (start && end && start <= end) return rangeFromDates(start, end);
  }

  return null;
}

function parseRelativeRange(text: string, referenceDate: Date): NewsDateRange | null {
  const normalized = text.replaceAll(' ', '');
  if (normalized.includes('오늘')) return rangeFromDates(referenceDate, referenceDate);
  if (normalized.includes('모레')) {
    const date = shiftDate(referenceDate, 2);
    return rangeFromDates(date, date);
  }
  if (normalized.includes('내일')) {
    const date = shiftDate(referenceDate, 1);
    return rangeFromDates(date, date);
  }

  const day = referenceDate.getDay();
  if (normalized.includes('이번주말')) {
    const saturday = shiftDate(referenceDate, (6 - day + 7) % 7);
    return rangeFromDates(saturday, shiftDate(saturday, 1));
  }
  if (normalized.includes('다음주')) {
    const monday = shiftDate(referenceDate, (8 - day) % 7 || 7);
    return rangeFromDates(monday, shiftDate(monday, 6));
  }
  if (normalized.includes('이번주')) {
    const monday = shiftDate(referenceDate, day === 0 ? -6 : 1 - day);
    return rangeFromDates(monday, shiftDate(monday, 6));
  }
  if (normalized.includes('다음달') || normalized.includes('이번달')) {
    const monthOffset = normalized.includes('다음달') ? 1 : 0;
    const first = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffset, 1);
    const last = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + monthOffset + 1, 0);
    return rangeFromDates(first, last);
  }
  return null;
}

function parseSingleDate(text: string, referenceDate: Date): NewsDateRange | null {
  const fullDate = text.match(/(20\d{2})\s*[./-년]\s*(\d{1,2})\s*[./-월]\s*(\d{1,2})\s*일?/);
  if (fullDate) {
    const date = createDate(Number(fullDate[1]), Number(fullDate[2]), Number(fullDate[3]));
    return date ? rangeFromDates(date, date) : null;
  }

  const koreanDate = text.match(/(\d{1,2})월\s*(\d{1,2})일?/);
  if (koreanDate) {
    const date = createDate(referenceDate.getFullYear(), Number(koreanDate[1]), Number(koreanDate[2]));
    return date ? rangeFromDates(date, date) : null;
  }

  const numericDate = text.match(/(\d{1,2})[./](\d{1,2})/);
  if (numericDate) {
    const date = createDate(referenceDate.getFullYear(), Number(numericDate[1]), Number(numericDate[2]));
    return date ? rangeFromDates(date, date) : null;
  }

  return null;
}

export function parseNewsSchedule(text: string, referenceDate = new Date()): ParsedNewsSchedule {
  const normalized = text.trim();
  const hasNoDate = /(?:없어요|없습니다|없음|기간\s*없|날짜\s*없|미정|정하지\s*않)/.test(normalized);
  if (hasNoDate) return { range: null, hasNoDate: true };
  return {
    range: parseExplicitRange(normalized, referenceDate) ?? parseSingleDate(normalized, referenceDate) ?? parseRelativeRange(normalized, referenceDate),
    hasNoDate: false,
  };
}
