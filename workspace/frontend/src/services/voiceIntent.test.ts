import { isVoiceCancellation } from '@/services/voiceIntent';

describe('isVoiceCancellation', () => {
  test.each(['취소', ' 취소해줘 ', '아니야.', '아니 요'])('명시적인 취소 발화 %s를 취소로 판별한다', (text) => {
    // Given: 사용자가 짧은 취소 발화를 했다
    // When: 음성 의도를 판별한다
    // Then: 취소 의도로 분류한다
    expect(isVoiceCancellation(text)).toBe(true);
  });

  test.each(['영업시간을 취소해줘', '아니야 오늘은 열어줘', '메뉴를 바꿔줘'])('업무 요청에 포함된 단어는 취소로 오인하지 않는다', (text) => {
    // Given: 취소 단어가 포함되거나 일반 업무 요청인 문장이 있다
    // When: 음성 의도를 판별한다
    // Then: 전체 문장이 명시적 취소 발화가 아니면 false다
    expect(isVoiceCancellation(text)).toBe(false);
  });
});
