const closureIntent = /임시\s*휴무|휴무|휴일|쉬|문\s*닫|마감/;
const explicitDate = /(?:\d{4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}\s*월\s*\d{1,2}\s*일)/;

export interface ClarificationRequest {
  readonly originalText: string;
  readonly prompt: string;
}

export function clarificationFor(text: string): ClarificationRequest | null {
  const originalText = text.trim();
  if (!originalText || !closureIntent.test(originalText) || explicitDate.test(originalText)) return null;
  return {
    originalText,
    prompt: '휴무 날짜가 필요해요. “8월 15일 하루 종일 임시 휴무”처럼 정확한 날짜를 말씀해 주세요.',
  };
}
