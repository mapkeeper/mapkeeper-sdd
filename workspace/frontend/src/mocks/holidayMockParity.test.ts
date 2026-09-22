import { ApiClientError, apiRequest } from '@/services/api';
import type { CreateStoreChangeResponse } from '@/services/api.types';
import { FAILURE_COPY } from '@/mocks/fixtures/storeChangeFixtures';
import { holidayClarificationCopy, holidayOccurrence } from '@/mocks/fixtures/holidayFixtures';
import { parseStoreChangeText, storeChangeFailureBody } from '@/mocks/handlers/storeChangeHandlers';

/** A local-time date, the way the handlers read "today" in Asia/Seoul terms. */
const on = (year: number, month: number, day: number): Date => new Date(year, month - 1, day);

const closureDates = (text: string, today: Date): [string, string] | null => {
  const [change] = parseStoreChangeText(text, today);
  if (change?.field !== 'temporaryClosure') return null;
  return [change.proposedValue.startDate, change.proposedValue.endDate];
};

describe('mock mode reads the bundled holiday table the way the API does', () => {
  test.each<[string, Date, string, string]>([
    // 사장님이 실제로 말한 문장. 데모에서도 실제 API와 같은 연휴 전체가 나와야 한다.
    ['이번 추석 연휴에 문닫을 예정이야', on(2026, 9, 22), '2026-09-24', '2026-09-26'],
    ['추석 연휴 전체 쉽니다', on(2026, 9, 22), '2026-09-24', '2026-09-26'],
    ['추석 연휴 동안 휴무입니다', on(2026, 9, 22), '2026-09-24', '2026-09-26'],
    // 당일은 연휴와 다른 휴무다.
    ['추석 당일만 쉽니다', on(2026, 9, 22), '2026-09-25', '2026-09-25'],
    ['추석 당일 하루 문 닫습니다', on(2026, 9, 22), '2026-09-25', '2026-09-25'],
    // 다른 해·다른 명절이라 한 날짜를 박아 둔 것으로는 맞출 수 없다.
    // 2025년 추석과 2024년 설날은 대체공휴일이 연휴에 포함된다.
    ['추석 연휴 전체 쉽니다', on(2025, 9, 1), '2025-10-05', '2025-10-08'],
    ['설 연휴에 문 닫습니다', on(2025, 1, 2), '2025-01-28', '2025-01-30'],
    ['설날 당일 쉽니다', on(2026, 1, 5), '2026-02-17', '2026-02-17'],
    ['구정 연휴 전체 쉽니다', on(2024, 1, 2), '2024-02-09', '2024-02-12'],
    // 올해 연휴가 이미 끝났으면 "추석 연휴"는 내년 것이다.
    ['추석 연휴 전체 쉽니다', on(2026, 10, 1), '2027-09-14', '2027-09-16'],
  ])('%s 는 공표된 연휴 날짜로 구조화된다', (sentence, today, start, end) => {
    expect(closureDates(sentence, today)).toEqual([start, end]);
  });

  test('말한 일수가 공표된 연휴 길이보다 우선한다', () => {
    expect(closureDates('추석 연휴 이틀 쉽니다', on(2026, 9, 22))).toEqual(['2026-09-24', '2026-09-25']);
  });

  test('명절 이름이 나와도 바꿀 항목이 다르면 휴무로 읽지 않는다', () => {
    const [change] = parseStoreChangeText('대표 메뉴를 추석 한정 갈비찜으로 바꿔줘', on(2026, 9, 22));

    expect(change).toMatchObject({ field: 'representativeMenuName', proposedValue: '추석 한정 갈비찜' });
  });

  test.each<[string, Date]>([
    // 연휴인지 당일인지 말하지 않은 문장. 잘못 고르면 지도 세 곳에 그대로 올라간다.
    ['이번 추석 문닫을 예정이야', on(2026, 9, 22)],
    ['추석에 쉽니다', on(2026, 9, 22)],
    ['설날에 휴무입니다', on(2026, 1, 5)],
    // 표가 다루지 않는 해와 이미 지나간 명절은 추정하지 않는다.
    ['추석 연휴 전체 쉽니다', on(2032, 1, 1)],
    ['지난 추석 연휴에 쉬었습니다', on(2026, 9, 22)],
  ])('%s 는 변경안을 만들지 않는다', (sentence, today) => {
    expect(parseStoreChangeText(sentence, today)).toEqual([]);
  });

  test('연휴인지 당일인지 묻는 거절은 그 명절의 실제 날짜를 담는다', () => {
    const body = storeChangeFailureBody('이번 추석 문닫을 예정이야', on(2026, 9, 22));

    // 계약은 그대로여야 화면이 이미 다루는 날짜 재확인으로 들어간다.
    expect(body.failure?.reason).toBe('AMBIGUOUS_DATE');
    expect(body.message).toBe(FAILURE_COPY.AMBIGUOUS_DATE.message);
    expect(body.failure?.guidance).toContain('9월 24일');
    expect(body.failure?.guidance).toContain('9월 26일');
    expect(body.failure?.guidance).toContain('9월 25일');
    expect(body.failure?.recognizedTextMasked).toBe('이번 추석 문닫을 예정이야');
  });

  test('거절이 제안하는 문장은 그대로 다시 말하면 읽힌다', () => {
    const today = on(2026, 9, 22);
    const examples = storeChangeFailureBody('이번 추석 문닫을 예정이야', today).failure?.examples ?? [];

    expect(examples).not.toHaveLength(0);
    for (const example of examples) {
      expect(closureDates(example, today), example).not.toBeNull();
    }
  });

  test('표 밖의 명절은 날짜 없이 원래 재확인 문구를 유지한다', () => {
    const body = storeChangeFailureBody('이번 추석 문닫을 예정이야', on(2032, 1, 1));

    expect(body.failure?.reason).toBe('AMBIGUOUS_DATE');
    expect(body.failure?.guidance).toBe(FAILURE_COPY.AMBIGUOUS_DATE.guidance);
    expect(body.failure?.guidance).not.toContain('연휴');
  });
});

describe('demo mock API answers a holiday sentence end to end', () => {
  // 핸들러는 실제 시각을 읽으므로 기준일을 고정한다. 핸들러의 지연이 끝나야 하므로
  // 타이머는 계속 흐르게 둔다.
  const freezeAt = (today: Date): void => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(today);
  };
  afterEach(() => { vi.useRealTimers(); });

  const createProposal = async (recognizedText: string): Promise<CreateStoreChangeResponse> => {
    const created = await apiRequest<CreateStoreChangeResponse>('/api/v1/store-change-proposals', {
      method: 'POST',
      body: { storeProfileId: 'store-123', recognizedText, locale: 'ko-KR' },
    });
    return created.data;
  };

  test('"이번 추석 연휴에 문닫을 예정이야" 는 연휴 전체 임시 휴무 변경안이 된다', async () => {
    freezeAt(on(2026, 9, 22));

    const data = await createProposal('이번 추석 연휴에 문닫을 예정이야');

    expect(data.changes).toEqual([{
      field: 'temporaryClosure',
      currentValue: null,
      proposedValue: { startDate: '2026-09-24', endDate: '2026-09-26' },
    }]);
  });

  test('연휴인지 당일인지 말하지 않으면 후보 날짜를 담은 422로 거절한다', async () => {
    freezeAt(on(2026, 9, 22));
    const event = holidayOccurrence('추석', '2026-09-22');
    if (!event) throw new Error('bundled table must cover the 2026 추석');

    await expect(createProposal('이번 추석 문닫을 예정이야')).rejects.toMatchObject({
      status: 422,
      causeBody: {
        code: 'VALIDATION_ERROR',
        message: FAILURE_COPY.AMBIGUOUS_DATE.message,
        failure: {
          reason: 'AMBIGUOUS_DATE',
          ...holidayClarificationCopy(event),
          recognizedTextMasked: '이번 추석 문닫을 예정이야',
        },
      },
    } satisfies Partial<ApiClientError>);
  });
});
