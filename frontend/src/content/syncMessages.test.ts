import { retryStartedMessage, SYNC_COPY, SYNC_STATUS_TITLES } from '@/content/syncMessages';

describe('syncMessages', () => {
  test('모든 SyncJob 상태에 확정된 사용자 문구가 있다', () => {
    expect(Object.keys(SYNC_STATUS_TITLES)).toEqual([
      'PENDING', 'PROCESSING', 'RETRYING', 'PARTIAL_SUCCESS', 'SUCCESS', 'FAILED',
    ]);
    expect(Object.values(SYNC_STATUS_TITLES).every((message) => message.length > 0)).toBe(true);
  });

  test('부분 성공은 성공 결과 보존과 실패 플랫폼만 재시도함을 설명한다', () => {
    expect(SYNC_COPY.partialSuccess).toContain('성공한 플랫폼은 그대로 유지');
    expect(SYNC_COPY.partialSuccess).toContain('실패한 플랫폼만 다시 시도');
  });

  test('재시도 시작 플랫폼을 쉬운 문장으로 조합한다', () => {
    expect(retryStartedMessage(['Naver', 'Kakao'])).toBe('Naver, Kakao 재시도를 시작했습니다.');
  });
});
