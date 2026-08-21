import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Robot } from '@phosphor-icons/react';
import { ProposalEditor } from '@/components/ProposalEditor/ProposalEditor';
import { VoicePanel } from '@/components/VoicePanel/VoicePanel';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import { useTextToSpeech } from '@/hooks/useTextToSpeech';
import { useUnsavedChangesWarning } from '@/hooks/useUnsavedChangesWarning';
import type { ProposalChange, ProposalField } from '@/types/domain';
import { useStoreChangeFlow } from '@/features/store-change/useStoreChangeFlow';
import type { StoreChangeSyncHandoff } from '@/features/store-change/useStoreChangeFlow';
import { safeDiagnostic } from '@/services/safeDiagnostics';
import './storeChange.css';

type WizardStep = 'INPUT' | 'MANUAL' | 'REVIEW' | 'EDIT' | 'CONFIRM' | 'REJECTED';

const fieldLabels: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
  parkingInfo: '주차 정보',
};

function finalConsonantIndex(text: string): number {
  const lastChar = text.trim().at(-1);
  const code = lastChar?.charCodeAt(0) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) return -1;
  return (code - 0xac00) % 28;
}

function withSubjectParticle(text: string): string {
  const finalIndex = finalConsonantIndex(text);
  return `${text}${finalIndex > 0 ? '이' : '가'}`;
}

function withDirectionParticle(text: string): string {
  const finalIndex = finalConsonantIndex(text);
  return `${text}${finalIndex > 0 && finalIndex !== 8 ? '으로' : '로'}`;
}

const storeChangeQuickPrompts = [
  { label: '대표 메뉴', answer: '대표 메뉴를 김치찌개로 바꿔줘' },
  { label: '영업시간', answer: '영업시간을 오후 10시까지로 바꿔줘' },
  { label: '임시 휴무', answer: '내일 문 닫아' },
  { label: '주차 정보', answer: '주차 정보를 건물 뒤 3대 가능으로 바꿔줘' },
] as const;

const stepBackTargets: Partial<Record<WizardStep, WizardStep>> = {
  MANUAL: 'INPUT',
  REVIEW: 'INPUT',
  EDIT: 'REVIEW',
  CONFIRM: 'REVIEW',
};

interface WizardHeaderProps {
  step: WizardStep;
  onBack(): void;
  onClose(): void;
}

function WizardHeader({ step, onBack, onClose }: WizardHeaderProps) {
  const backTarget = stepBackTargets[step];
  return (
    <div className="store-change-wizard__nav">
      {backTarget ? <button type="button" aria-label="이전 단계로" onClick={onBack}>←</button> : <span />}
      {backTarget ? <span /> : <button type="button" aria-label="홈으로 나가기" onClick={onClose}>✕</button>}
    </div>
  );
}

export interface StoreChangeWizardProps {
  storeProfileId: string;
  onSyncHandoff?: (handoff: StoreChangeSyncHandoff) => void;
  onExit?: () => void;
  autoApprove?: boolean;
  voiceGuidance?: boolean;
}

export function StoreChangeWizard({ storeProfileId, onSyncHandoff, onExit = () => undefined, autoApprove = false, voiceGuidance = false }: StoreChangeWizardProps) {
  const speech = useSpeechRecognition();
  const tts = useTextToSpeech(voiceGuidance);
  const [step, setStep] = useState<WizardStep>('INPUT');
  const [manualText, setManualText] = useState('');
  const [draftNote, setDraftNote] = useState<string | null>(null);
  const [isDraftPreparing, setDraftPreparing] = useState(false);
  const [editedChanges, setEditedChanges] = useState<ProposalChange[]>([]);
  const [autoApproveCancelled, setAutoApproveCancelled] = useState(false);
  const submittedTranscriptRef = useRef('');
  const autoApprovedProposalIdRef = useRef<string | null>(null);
  const spokenStepRef = useRef<WizardStep | null>(null);
  const flow = useStoreChangeFlow(storeProfileId, (nextHandoff) => {
    safeDiagnostic('store-change:proposal-approved', { syncJobId: nextHandoff.syncJobId });
    // App swaps this wizard out for SyncResult in the same state batch this
    // callback triggers, so any local step here would never get to render.
    onSyncHandoff?.(nextHandoff);
  });
  const autoApproveActive = autoApprove && !autoApproveCancelled;
  const hasUnsavedManualInput = step === 'MANUAL' && manualText.trim() !== '';
  const hasUnapprovedProposal = (step === 'REVIEW' || step === 'EDIT' || step === 'CONFIRM') && flow.proposal?.status === 'DRAFT';
  useUnsavedChangesWarning(hasUnsavedManualInput || hasUnapprovedProposal);

  // Read off the flow before the effect so its dependencies are plain values the
  // exhaustive-deps rule can verify, rather than members of an object it cannot.
  const { proposal: pendingProposal, isApproving, approveFromButton } = flow;

  useEffect(() => {
    if (!autoApproveActive) return;
    if (step !== 'REVIEW' || !pendingProposal || pendingProposal.changes.length === 0) return;
    if (isApproving) return;
    if (autoApprovedProposalIdRef.current === pendingProposal.proposalId) return;
    autoApprovedProposalIdRef.current = pendingProposal.proposalId;
    void approveFromButton();
  }, [autoApproveActive, step, pendingProposal, isApproving, approveFromButton]);

  useEffect(() => {
    if (!voiceGuidance || spokenStepRef.current === step) return;
    spokenStepRef.current = step;
    if (step === 'INPUT') {
      tts.speak('사장님, 영업시간이나 메뉴를 바꿀까요? 마이크를 눌러 말씀해 주세요.');
    } else if (step === 'REVIEW' && flow.proposal && flow.proposal.changes.length > 0) {
      const summary = flow.proposal.changes.map((change) => `${withSubjectParticle(fieldLabels[change.field])} ${withDirectionParticle(change.proposedValue)} 변경돼요`).join('. ');
      tts.speak(`다음과 같이 변경돼요. ${summary}`);
    }
    // 승인 즉시 App이 STORE_SYNC 화면으로 전환하며 이 위저드를 언마운트하므로 'SYNC' 단계는 렌더링되지 않는다 — 반영 시작 안내는 SyncResult에서 담당한다.
  }, [voiceGuidance, step, flow.proposal, tts]);

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
      safeDiagnostic('store-change:proposal-created', {
        proposalId: proposal.proposalId,
        changedFields: proposal.changes.map((change) => change.field),
      });
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

  const rejectProposal = async () => {
    const proposalId = flow.proposal?.proposalId;
    const rejected = await flow.rejectFromButton();
    if (rejected) {
      safeDiagnostic('store-change:proposal-rejected', { proposalId });
      setDraftNote(null);
      setStep('REJECTED');
    }
  };

  const goBack = () => {
    const target = stepBackTargets[step];
    if (!target) return;
    if (target === 'INPUT') {
      flow.clear();
      setDraftNote(null);
    }
    setStep(target);
  };

  if (isDraftPreparing) {
    return (
      <main className="store-change-wizard">
        <p className="store-change-wizard__progress">매장정보 변경 · 변경안 생성</p>
        <section className="store-change-wizard__loading" role="status" aria-live="polite">
          <span className="store-change-wizard__spinner" aria-hidden="true" />
          <h1>AI가 변경안을 작성 중입니다...</h1>
          <p>입력하신 내용을 보기 쉽게 정리하고 있어요.</p>
          <p>네트워크 상황에 따라 최대 1분 정도 걸릴 수 있어요.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="store-change-wizard">
      <WizardHeader step={step} onBack={goBack} onClose={onExit} />
      <p className="store-change-wizard__progress">매장정보 변경 · 현재 단계</p>
      {flow.errorMessage ? <div className="store-change-wizard__alert" role="alert">{flow.errorMessage}</div> : null}

      {step === 'INPUT' ? (
        <section className="store-change-wizard__step">
          <div className="store-change-wizard__bot"><span aria-hidden="true"><Robot weight="regular" /></span><p>사장님,<br />영업시간이나 메뉴를 바꿀까요?</p></div>
          <VoicePanel
            state={speech.state}
            recognizedText={speech.recognizedText}
            error={speech.error}
            onStart={speech.start}
            onManualSubmit={(text) => {
              setManualText(text);
              setStep('MANUAL');
            }}
            onCancel={speech.reset}
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
            <div className="store-change-quick-prompts" aria-label="매장 정보 변경 빠른 시작">
              <span>빠르게 시작하기</span>
              <div>
                {storeChangeQuickPrompts.map(({ label, answer }) => (
                  <button key={label} type="button" className="store-change-quick-prompt" onClick={() => setManualText(answer)}>{label}</button>
                ))}
              </div>
            </div>
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
          <div className="store-change-wizard__bot"><span aria-hidden="true"><Robot weight="regular" /></span><p>아래 내용이 맞는지<br />확인해 주세요</p></div>
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
          {flow.proposal.changes.length > 0 ? (
            autoApproveActive ? <div className="store-change-wizard__auto-approve">
              <p role="status"><span className="store-change-wizard__spinner store-change-wizard__spinner--sm" aria-hidden="true" />자동 승인 설정으로 3사에 바로 반영하고 있어요…</p>
              <button type="button" className="store-change-wizard__secondary" onClick={() => setAutoApproveCancelled(true)}>잠깐, 제가 직접 확인할게요</button>
            </div> : <div className="store-change-wizard__actions">
              <button type="button" aria-label="승인 단계로 이동" onClick={() => setStep('CONFIRM')}>맞아요 <small>(3사에 반영)</small></button>
              <button type="button" className="store-change-wizard__secondary" onClick={beginEdit}>변경안 수정</button>
              <button type="button" className="store-change-wizard__danger" onClick={() => void rejectProposal()} disabled={flow.isRejecting}>{flow.isRejecting ? '처리 중…' : '이번에는 변경하지 않기'}</button>
            </div>
          ) : <div className="store-change-wizard__actions">
            <p className="store-change-wizard__alert" role="alert">변경할 매장 정보를 인식하지 못했어요. 다시 입력해 주세요.</p>
            <button type="button" className="store-change-wizard__secondary" onClick={() => { flow.clear(); setDraftNote(null); setStep('INPUT'); }}>다시 입력하기</button>
          </div>}
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
          <p>서버에도 반영하지 않는 것으로 기록했습니다.</p>
          <button type="button" onClick={() => { flow.clear(); setStep('INPUT'); }}>처음으로 돌아가기</button>
        </section>
      ) : null}
    </main>
  );
}
