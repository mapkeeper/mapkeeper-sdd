import { useCallback, useEffect, useMemo } from 'react';

export interface TextToSpeech {
  isSupported: boolean;
  speak(text: string): void;
  cancel(): void;
}

function getSynthesis(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

export function useTextToSpeech(enabled: boolean): TextToSpeech {
  const synthesis = useMemo(() => getSynthesis(), []);

  const cancel = useCallback(() => {
    synthesis?.cancel();
  }, [synthesis]);

  const speak = useCallback((text: string) => {
    if (!enabled || !synthesis) return;
    const normalized = text.trim();
    if (!normalized) return;
    synthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(normalized);
    utterance.lang = 'ko-KR';
    synthesis.speak(utterance);
  }, [enabled, synthesis]);

  useEffect(() => () => { synthesis?.cancel(); }, [synthesis]);

  return { isSupported: synthesis !== null, speak, cancel };
}
