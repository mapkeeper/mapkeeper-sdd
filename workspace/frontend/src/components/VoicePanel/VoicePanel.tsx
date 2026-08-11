import { useState } from 'react';
import type { FormEvent } from 'react';
import type { VoiceUiState } from '@/types/domain';
import './VoicePanel.css';

const announcements: Record<VoiceUiState, string> = {
  IDLE: '음성으로 변경 내용을 말씀해 주세요',
  LISTENING: '듣고 있습니다',
  RECOGNIZED: '음성을 인식했습니다',
  FAILED: '음성을 인식하지 못했습니다',
};

export interface VoicePanelProps {
  state: VoiceUiState;
  recognizedText: string;
  error?: string | null;
  onStart(): void;
  onRecognized?(recognizedText: string): void;
  onManualSubmit(recognizedText: string): void;
}

function errorMessage(error: string | null | undefined): string {
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    return '마이크 권한이 없습니다. 브라우저 설정을 확인하거나 아래에서 직접 입력해 주세요.';
  }
  if (error === 'unsupported') return '이 브라우저는 음성 인식을 지원하지 않습니다. 직접 입력해 주세요.';
  return '음성을 알아듣지 못했습니다. 아래에서 직접 입력해 주세요.';
}

export function VoicePanel({ state, recognizedText, error, onStart, onManualSubmit }: VoicePanelProps) {
  const [manualText, setManualText] = useState('');

  const submitManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = manualText.trim();
    if (value) onManualSubmit(value);
  };

  return (
    <section className="voice-panel" aria-label="음성 입력">
      <p className={`voice-panel__state voice-panel__state--${state.toLowerCase()}`} role="status" aria-live="polite">
        {announcements[state]}
      </p>

      {state === 'IDLE' ? (
        <button className="voice-panel__primary" type="button" onClick={onStart} aria-label="음성 인식 시작" style={{ minHeight: 56 }}>
          <span className="voice-panel__waves" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M9 21h6"/></svg></span>
          <span>마이크를 눌러<br />말씀해 주세요</span>
        </button>
      ) : null}

      {state === 'LISTENING' ? <div className="voice-panel__listening"><span className="voice-panel__pulse" aria-hidden="true"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M9 21h6"/></svg></span><p className="voice-panel__hint">말을 마치면 자동으로 정리해 드려요.</p></div> : null}
      {state === 'RECOGNIZED' ? <p className="voice-panel__transcript">“{recognizedText}”</p> : null}

      {state === 'FAILED' ? (
        <div className="voice-panel__fallback">
          <p>{errorMessage(error)}</p>
          <form onSubmit={submitManual}>
            <label htmlFor="voice-manual-input">변경할 매장 정보 직접 입력</label>
            <textarea
              id="voice-manual-input"
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              rows={4}
              style={{ minHeight: 96 }}
            />
            <button type="submit" style={{ minHeight: 56 }}>직접 입력 내용 확인</button>
          </form>
        </div>
      ) : null}
    </section>
  );
}
