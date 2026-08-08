import { useCallback, useEffect, useRef, useState } from 'react';
import {
  configureSpeechRecognition,
  detachSpeechRecognition,
  getSpeechRecognitionConstructor,
  readFinalTranscript,
} from '@/services/speechRecognition';
import type { VoiceUiState } from '@/types/domain';

export interface SpeechRecognitionState {
  state: VoiceUiState;
  recognizedText: string;
  error: string | null;
  isSupported: boolean;
  start(): void;
  stop(): void;
  reset(): void;
}

export function useSpeechRecognition(onRecognized?: (recognizedText: string) => boolean | void): SpeechRecognitionState {
  const constructor = getSpeechRecognitionConstructor();
  const [state, setState] = useState<VoiceUiState>('IDLE');
  const [recognizedText, setRecognizedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const receivedResultRef = useRef(false);

  const release = useCallback((abort: boolean) => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    detachSpeechRecognition(recognition);
    if (abort) recognition.abort();
    recognitionRef.current = null;
  }, []);

  const start = useCallback(() => {
    const Recognition = getSpeechRecognitionConstructor();
    setRecognizedText('');
    setError(null);
    receivedResultRef.current = false;
    if (!Recognition) {
      setError('unsupported');
      setState('FAILED');
      return;
    }

    release(true);
    const recognition = configureSpeechRecognition(new Recognition());
    recognitionRef.current = recognition;
    recognition.onstart = () => setState('LISTENING');
    recognition.onresult = (event) => {
      const transcript = readFinalTranscript(event);
      if (!transcript) {
        setError('no-speech');
        setState('FAILED');
        return;
      }
      receivedResultRef.current = true;
      setRecognizedText(transcript);
      setState('RECOGNIZED');
      const shouldReset = onRecognized?.(transcript) ?? false;
      if (shouldReset) {
        release(true);
        setRecognizedText('');
        setError(null);
        setState('IDLE');
        return;
      }
      recognition.stop();
    };
    recognition.onerror = (event) => {
      setError(event.error);
      setState('FAILED');
    };
    recognition.onend = () => {
      if (!receivedResultRef.current) {
        setError((current) => current ?? 'no-speech');
        setState('FAILED');
      }
    };
    try {
      recognition.start();
    } catch {
      setError('start-failed');
      setState('FAILED');
    }
  }, [onRecognized, release]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const reset = useCallback(() => {
    release(true);
    setRecognizedText('');
    setError(null);
    setState('IDLE');
  }, [release]);

  useEffect(() => () => release(true), [release]);

  return {
    state,
    recognizedText,
    error,
    isSupported: constructor !== null,
    start,
    stop,
    reset,
  };
}
