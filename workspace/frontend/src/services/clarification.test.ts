import { clarificationFor } from '@/services/clarification';

describe('clarificationFor', () => {
  test('날짜가 없는 휴무 요청에는 날짜 재질문을 만든다', () => {
    // Given: 휴무 의도는 있지만 날짜가 없는 요청이 있다
    // When: 재질문 필요 여부를 판별한다
    // Then: 날짜를 요청하는 안내를 반환한다
    expect(clarificationFor('내일 문 닫아')).toEqual({
      originalText: '내일 문 닫아',
      prompt: '휴무 날짜가 필요해요. “8월 15일 하루 종일 임시 휴무”처럼 정확한 날짜를 말씀해 주세요.',
    });
  });

  test.each(['8월 15일은 임시 휴무로 해줘', '2026-08-15 임시 휴무'])('날짜가 있는 휴무 요청은 재질문하지 않는다', (text) => {
    // Given: 휴무 요청에 확정 날짜가 포함되어 있다
    // When: 재질문 필요 여부를 판별한다
    // Then: 바로 변경안 생성을 진행한다
    expect(clarificationFor(text)).toBeNull();
  });

  test('휴무가 아닌 요청은 재질문하지 않는다', () => {
    // Given: 대표 메뉴 변경 요청이 있다
    // When: 재질문 필요 여부를 판별한다
    // Then: 재질문하지 않는다
    expect(clarificationFor('대표 메뉴를 만두로 바꿔줘')).toBeNull();
  });
});
