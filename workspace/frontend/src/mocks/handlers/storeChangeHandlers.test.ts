import { parseStoreChangeText } from '@/mocks/handlers/storeChangeHandlers';

describe('parseStoreChangeText', () => {
  test('접두어 없는 "N시"는 마감 시간 문맥에서 오후로 해석한다', () => {
    expect(parseStoreChangeText('영업시간을 10시까지로 바꿔줘')).toEqual([
      { field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '22:00' } },
    ]);
  });

  test('오전 10시는 10:00으로 해석한다', () => {
    expect(parseStoreChangeText('영업시간을 오전 10시까지로 바꿔줘')).toEqual([
      { field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '10:00' } },
    ]);
  });

  test('오후 10시는 22:00으로 해석한다', () => {
    expect(parseStoreChangeText('영업시간을 오후 10시까지로 바꿔줘')).toEqual([
      { field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '22:00' } },
    ]);
  });

  test('밤 10시는 22:00으로 해석한다', () => {
    expect(parseStoreChangeText('영업시간을 밤 10시까지로 바꿔줘')).toEqual([
      { field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '22:00' } },
    ]);
  });

  test('오후 12시는 정오(12:00), 밤 12시는 자정(00:00)으로 해석한다', () => {
    expect(parseStoreChangeText('영업시간을 오후 12시까지로 바꿔줘')[0]).toMatchObject({ proposedValue: { close: '12:00' } });
    expect(parseStoreChangeText('영업시간을 밤 12시까지로 바꿔줘')[0]).toMatchObject({ proposedValue: { close: '00:00' } });
  });

  test('분 단위 값을 포함해 해석한다', () => {
    expect(parseStoreChangeText('영업시간을 오후 9시 30분까지로 바꿔줘')[0]).toMatchObject({ proposedValue: { close: '21:30' } });
  });

  test('임시 휴무 기간을 ISO 날짜 범위로 해석한다', () => {
    expect(parseStoreChangeText('8월 15일부터 8월 17일까지 임시 휴무로 해줘')).toEqual([
      { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-15', endDate: '2026-08-17' } },
    ]);
  });

  test('단일 날짜 임시 휴무는 시작일과 종료일을 동일하게 해석한다', () => {
    expect(parseStoreChangeText('8월 10일은 임시 휴무로 해줘')).toEqual([
      { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-10', endDate: '2026-08-10' } },
    ]);
  });

  test.each([
    ['오늘 문 닫아', '2026-08-03'],
    ['내일 문 닫아', '2026-08-04'],
    ['모레 문 닫아', '2026-08-05'],
    ['다음 주 화요일 문 닫아', '2026-08-11'],
  ])('%s를 고정된 목업 기준일의 날짜로 해석한다', (text, expectedDate) => {
    expect(parseStoreChangeText(text)).toEqual([
      { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: expectedDate, endDate: expectedDate } },
    ]);
  });

  test('다음 주는 월요일부터 일요일까지로 해석한다', () => {
    expect(parseStoreChangeText('다음 주 문 닫아')).toEqual([
      { field: 'temporaryClosure', currentValue: null, proposedValue: { startDate: '2026-08-10', endDate: '2026-08-16' } },
    ]);
  });

  test('대표 메뉴 변경을 해석한다', () => {
    expect(parseStoreChangeText('대표 메뉴를 만두전골로 바꿔줘')).toEqual([
      { field: 'representativeMenuName', currentValue: '비빔밥', proposedValue: '만두전골' },
    ]);
  });

  test('인식할 수 없는 문장은 빈 변경 목록을 반환한다', () => {
    expect(parseStoreChangeText('오늘 날씨가 좋네요')).toEqual([]);
  });
});
