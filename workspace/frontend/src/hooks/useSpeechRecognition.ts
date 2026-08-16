import { useCallback, useEffect, useRef, useState } from 'react';
import {
  configureSpeechRecognition,
  detachSpeechRecognition,
  getSpeechRecognitionConstructor,
  readTranscript,
} from '@/services/speechRecognition';
import type { VoiceUiState } from '@/types/domain';

export interface SpeechRecognitionState {
  state: VoiceUiState;
  recognizedText: string;
  error: string | null;
  isSupported: boolean;
  start(): void;
  stop(): string;
  reset(): void;
}

export function useSpeechRecognition(): SpeechRecognitionState {
  const constructor = getSpeechRecognitionConstructor();
  const [state, setState] = useState<VoiceUiState>('IDLE');
  const [recognizedText, setRecognizedText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const receivedResultRef = useRef(false);
  const latestTranscriptRef = useRef('');
  const manuallyStoppedRef = useRef(false);

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
    latestTranscriptRef.current = '';
    manuallyStoppedRef.current = false;
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
      const transcript = readTranscript(event);
      if (!transcript) {
        setError('no-speech');
        setState('FAILED');
        return;
      }
      latestTranscriptRef.current = transcript;
      if (manuallyStoppedRef.current) {
        setRecognizedText(transcript);
        return;
      }
      const result = event.results[event.resultIndex] ?? event.results[0];
      if (!result?.isFinal) return;
      receivedResultRef.current = true;
      setRecognizedText(transcript);
      setState('RECOGNIZED');
      recognition.stop();
    };
    recognition.onerror = (event) => {
      setError(event.error);
      setState('FAILED');
    };
    recognition.onend = () => {
      if (!receivedResultRef.current && !manuallyStoppedRef.current) {
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
  }, [release]);

  const stop = useCallback((): string => {
    manuallyStoppedRef.current = true;
    const transcript = latestTranscriptRef.current;
    if (transcript) {
      setRecognizedText(transcript);
      setError(null);
    }
    setState('IDLE');
    recognitionRef.current?.stop();
    return transcript;
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
