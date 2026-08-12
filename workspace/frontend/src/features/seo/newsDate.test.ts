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

  test.each([
    ['내일 하루 쉬어요', '2026-08-14', '2026-08-14'],
    ['모레까지 할인해요', '2026-08-15', '2026-08-15'],
    ['이번 주에 진행해요', '2026-08-10', '2026-08-16'],
    ['이번 주말 행사예요', '2026-08-15', '2026-08-16'],
    ['다음 주에 이벤트를 열어요', '2026-08-17', '2026-08-23'],
    ['이번 달 내내 운영해요', '2026-08-01', '2026-08-31'],
    ['다음 달 할인 행사예요', '2026-09-01', '2026-09-30'],
    ['8/15~8/16 행사예요', '2026-08-15', '2026-08-16'],
    ['2026년 8월 15일부터 2026년 8월 16일까지', '2026-08-15', '2026-08-16'],
  ])('%s 문장을 날짜 범위로 변환한다', (text, start, end) => {
    expect(parseNewsSchedule(text, referenceDate).range).toEqual({ start, end });
  });

  test.each(['곧 진행할 예정이에요', '아직 날짜를 정하지 않았어요', '기간은 미정이에요'])('%s 문장은 자동 확정하지 않는다', (text) => {
    expect(parseNewsSchedule(text, referenceDate)).toEqual({ range: null, hasNoDate: text !== '곧 진행할 예정이에요' });
  });
});
