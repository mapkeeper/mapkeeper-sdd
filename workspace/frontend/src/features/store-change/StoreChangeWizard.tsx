import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ProposalEditor } from '@/components/ProposalEditor/ProposalEditor';
import { VoicePanel } from '@/components/VoicePanel/VoicePanel';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { ProposalChange, ProposalField } from '@/types/domain';
import { useStoreChangeFlow } from '@/features/store-change/useStoreChangeFlow';
import type { StoreChangeSyncHandoff } from '@/features/store-change/useStoreChangeFlow';
import './storeChange.css';

type WizardStep = 'INPUT' | 'MANUAL' | 'REVIEW' | 'EDIT' | 'CONFIRM' | 'REJECTED' | 'SYNC';

const fieldLabels: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
};

export interface StoreChangeWizardProps {
  storeProfileId: string;
  onSyncHandoff?: (handoff: StoreChangeSyncHandoff) => void;
}

export function StoreChangeWizard({ storeProfileId, onSyncHandoff }: StoreChangeWizardProps) {
  const speech = useSpeechRecognition();
  const [step, setStep] = useState<WizardStep>('INPUT');
  const [manualText, setManualText] = useState('');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [isDraftPreparing, setDraftPreparing] = useState(false);
  const [editedChanges, setEditedChanges] = useState<ProposalChange[]>([]);
  const [handoff, setHandoff] = useState<StoreChangeSyncHandoff | null>(null);
  const submittedTranscriptRef = useRef('');
  const flow = useStoreChangeFlow(storeProfileId, (nextHandoff) => {
    setHandoff(nextHandoff);
    setStep('SYNC');
    onSyncHandoff?.(nextHandoff);
  });

  const prepareDraft = useCallback(async (text: string) => {
    const normalizedText = text.trim();
    if (!normalizedText || isDraftPreparing) return;
    setDraftPreparing(true);
    setDraftNote(null);
    try {
      const [proposal] = await Promise.all([
        flow.create(normalizedText),
        new Promise<void>((resolve) => window.setTimeout(resolve, 500)),
      ]);
      if (!proposal) return;
      setDraftNote(proposal.changes.length === 0 ? normalizedText : null);
      setStep('REVIEW');
    } finally {
      setDraftPreparing(false);
    }
  }, [flow, isDraftPreparing]);

  useEffect(() => {
    if (speech.state !== 'RECOGNIZED' || !speech.recognizedText) return;
    if (submittedTranscriptRef.current === speech.recognizedText) return;
    submittedTranscriptRef.current = speech.recognizedText;
    void prepareDraft(speech.recognizedText);
  }, [prepareDraft, speech.recognizedText, speech.state]);

  const submitManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await prepareDraft(manualText);
  };

  const beginEdit = () => {
    setEditedChanges(flow.proposal?.changes ?? []);
    setStep('EDIT');
  };

  const saveEdit = async () => {
    const proposal = await flow.save(editedChanges);
    if (proposal) setStep('REVIEW');
  };

  const rejectLocally = () => {
    flow.clear();
    setDraftNote(null);
    setStep('REJECTED');
  };

  if (isDraftPreparing) {
    return (
      <main className="store-change-wizard">
        <p className="store-change-wizard__progress">매장정보 변경 · 변경안 생성</p>
        <section className="store-change-wizard__loading" role="status" aria-live="polite">
          <span className="store-change-wizard__spinner" aria-hidden="true" />
          <h1>AI가 변경안을 작성 중입니다...</h1>
          <p>입력하신 내용을 보기 쉽게 정리하고 있어요.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="store-change-wizard">
      <p className="store-change-wizard__progress">매장정보 변경 · 현재 단계</p>
      {flow.errorMessage ? <div className="store-change-wizard__alert" role="alert">{flow.errorMessage}</div> : null}

      {step === 'INPUT' ? (
        <section className="store-change-wizard__step">
          <div className="store-change-wizard__bot"><span aria-hidden="true">🤖</span><p>사장님,<br />영업시간이나 메뉴를 바꿀까요?</p></div>
          <VoicePanel
            state={speech.state}
            recognizedText={speech.recognizedText}
            error={speech.error}
            onStart={speech.start}
            onManualSubmit={(text) => {
              setManualText(text);
              setStep('MANUAL');
            }}
          />
          <button className="store-change-wizard__secondary" type="button" onClick={() => setStep('MANUAL')}>
            직접 입력하기
          </button>
          {flow.isCreating ? <p role="status">변경안을 만들고 있습니다.</p> : null}
        </section>
      ) : null}

      {step === 'MANUAL' ? (
        <section className="store-change-wizard__step">
          <h1>변경할 내용을 직접 입력해 주세요</h1>
          <form className="store-change-wizard__form" onSubmit={submitManual}>
            <label htmlFor="store-change-manual">변경할 매장 정보 직접 입력</label>
            <textarea
              id="store-change-manual"
              value={manualText}
              onChange={(event) => setManualText(event.target.value)}
              rows={5}
              required
            />
            <button type="submit" disabled={flow.isCreating || !manualText.trim()}>
              {flow.isCreating ? '만드는 중…' : '변경안 만들기'}
            </button>
          </form>
        </section>
      ) : null}

      {step === 'REVIEW' && flow.proposal ? (
        <section className="store-change-wizard__step">
          <h1 className="sr-only">변경안을 확인해 주세요</h1>
          <span className="sr-only">{flow.proposal.status}</span>
          <div className="store-change-wizard__bot"><span aria-hidden="true">🤖</span><p>아래 내용이 맞는지<br />확인해 주세요</p></div>
          <dl className="store-change-wizard__changes">
            {flow.proposal.changes.map((change) => (
              <div key={change.field}>
                <dt><span aria-hidden="true">◷</span><span>{fieldLabels[change.field]}</span><i>변경</i><button type="button" onClick={beginEdit}>✎ 직접 수정</button></dt>
                <dd><small>기존</small><s>{change.currentValue}</s><b aria-hidden="true">↓</b><small className="is-new">변경</small><strong>{change.proposedValue}</strong></dd>
              </div>
            ))}
            {draftNote ? (
              <div className="store-change-wizard__note">
                <dt>요청 메모</dt>
                <dd>{draftNote}</dd>
              </div>
            ) : null}
          </dl>
          <div className="store-change-wizard__actions">
            <button type="button" aria-label="승인 단계로 이동" onClick={() => setStep('CONFIRM')}>맞아요 <small>(3사에 반영)</small></button>
            <button type="button" className="store-change-wizard__secondary" onClick={beginEdit}>변경안 수정</button>
            <button type="button" className="store-change-wizard__danger" onClick={rejectLocally}>변경안 거절</button>
          </div>
        </section>
      ) : null}

      {step === 'EDIT' ? (
        <section className="store-change-wizard__step">
          <h1>변경 값을 수정해 주세요</h1>
          <ProposalEditor
            changes={editedChanges}
            onChange={setEditedChanges}
            onSave={() => void saveEdit()}
            disabled={flow.isSaving}
          />
        </section>
      ) : null}

      {step === 'CONFIRM' && flow.proposal ? (
        <section className="store-change-wizard__step">
          <div className="store-change-wizard__confirm-icon" aria-hidden="true">✓</div>
          <h1>이 내용으로 반영할까요?</h1>
          <p>승인 후 구글, 네이버, 카카오에 업데이트를 시작합니다.</p>
          <button
            className="store-change-wizard__approve"
            type="button"
            disabled={flow.isApproving}
            onClick={() => void flow.approveFromButton()}
          >
            {flow.isApproving ? '승인 처리 중…' : '승인'}
          </button>
        </section>
      ) : null}

      {step === 'REJECTED' ? (
        <section className="store-change-wizard__step">
          <h1>변경안을 적용하지 않았습니다</h1>
          <button type="button" onClick={() => setStep('INPUT')}>처음으로 돌아가기</button>
        </section>
      ) : null}

      {step === 'SYNC' && handoff ? (
        <section className="store-change-wizard__step">
          <h1>승인이 완료되었습니다</h1>
          <p>매장정보 반영을 시작했습니다.</p>
          <p role="status">작업 번호: {handoff.syncJobId}</p>
        </section>
      ) : null}
    </main>
  );
}
