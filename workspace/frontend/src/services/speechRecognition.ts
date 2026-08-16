export const SPEECH_LOCALE = 'ko-KR';

export function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

export function configureSpeechRecognition(recognition: SpeechRecognition): SpeechRecognition {
  recognition.lang = SPEECH_LOCALE;
  recognition.continuous = false;
  recognition.interimResults = true;
  return recognition;
}

export function readTranscript(event: SpeechRecognitionEvent): string {
  return Array.from({ length: event.results.length }, (_, index) => event.results[index]?.[0]?.transcript ?? '').join('').trim();
}

export function detachSpeechRecognition(recognition: SpeechRecognition): void {
  recognition.onstart = null;
  recognition.onresult = null;
  recognition.onerror = null;
  recognition.onend = null;
}
