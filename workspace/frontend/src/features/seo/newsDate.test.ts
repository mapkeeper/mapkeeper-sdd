import { describe, expect, test } from 'vitest';
import { parseNewsSchedule } from '@/features/seo/newsDate';

const referenceDate = new Date(2026, 7, 13, 12);

describe('parseNewsSchedule', () => {
  test('명시한 한국어 날짜 범위를 ISO 날짜로 변환한다', () => {
    expect(parseNewsSchedule('8월 15일부터 16일까지예요', referenceDate)).toEqual({
      range: { start: '2026-08-15', end: '2026-08-16' },
      hasNoDate: false,
    });
  });

  test('상대 날짜 이번 주말을 현재 기준 토요일과 일요일로 변환한다', () => {
    expect(parseNewsSchedule('이번 주말까지 진행해요', referenceDate)).toEqual({
      range: { start: '2026-08-15', end: '2026-08-16' },
      hasNoDate: false,
    });
  });

  test('날짜가 없다는 답변은 기간 없음으로 표시한다', () => {
    expect(parseNewsSchedule('날짜는 없어요', referenceDate)).toEqual({ range: null, hasNoDate: true });
  });

  test('잘못된 날짜는 자동 확정하지 않는다', () => {
    expect(parseNewsSchedule('8월 40일부터 41일까지예요', referenceDate)).toEqual({ range: null, hasNoDate: false });
  });
});
