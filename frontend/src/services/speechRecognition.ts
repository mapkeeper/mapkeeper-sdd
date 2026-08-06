export const SPEECH_LOCALE = 'ko-KR';

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function configureSpeechRecognition(recognition: SpeechRecognition): SpeechRecognition {
  recognition.lang = SPEECH_LOCALE;
  recognition.continuous = false;
  recognition.interimResults = false;
  return recognition;
}

export function readFinalTranscript(event: SpeechRecognitionEvent): string {
  const result = event.results[event.resultIndex] ?? event.results[0];
  return result?.[0]?.transcript.trim() ?? '';
}

export function detachSpeechRecognition(recognition: SpeechRecognition): void {
  recognition.onstart = null;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
}
