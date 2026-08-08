const cancellationPhrases = new Set(['취소', '취소해', '취소해줘', '아니야', '아니요']);

function normalizeVoiceText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[.!?,，。！？]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

export function isVoiceCancellation(text: string): boolean {
  return cancellationPhrases.has(normalizeVoiceText(text));
}
