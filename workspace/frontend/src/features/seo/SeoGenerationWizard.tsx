import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import { useSeoGenerationFlow } from '@/features/seo/useSeoGenerationFlow';
import type { SeoSyncHandoff } from '@/features/seo/useSeoGenerationFlow';
import type { PlatformResult } from '@/components/SyncStatus/SyncStatus';
import type { ReviewSummary, SourceReview } from '@/types/domain';
import './seoGeneration.css';

type SeoWizardStep = 'SUMMARY' | 'PURPOSE' | 'INTERVIEW' | 'RECOMMEND' | 'RESULT';
type SeoPurpose = 'INTRODUCTION' | 'NEWS';

const stepOrder: SeoWizardStep[] = ['SUMMARY', 'PURPOSE', 'INTERVIEW', 'RECOMMEND', 'RESULT'];
const questions = [
  '사장님의 가게를 한 줄로 표현해주세요.',
  '가장 내세우고 싶은 특징이 있나요?',
  '대표 메뉴가 무엇인가요?',
] as const;
const fallbackKeywords = ['맛있는메뉴', '친절함', '다시찾는집'];

export interface SeoGenerationWizardProps {
  storeProfileId: string;
  sourceReviews: readonly SourceReview[];
  reviewSummary?: ReviewSummary;
  onSyncHandoff?: (handoff: SeoSyncHandoff) => void;
  onExit?: () => void;
  syncResultOverride?: PlatformResult[] | null;
}

interface StepHeaderProps {
  step: SeoWizardStep;
  onBack(): void;
  onClose(): void;
}

function StepHeader({ step, onBack, onClose }: StepHeaderProps) {
  const index = stepOrder.indexOf(step) + 1;
  const edgeStep = step === 'SUMMARY' || step === 'RESULT';
  return (
    <header className="mobile-step-header">
      <div className="mobile-step-header__nav">
        {!edgeStep ? <button type="button" aria-label="이전 단계로" onClick={onBack}>←</button> : <span />}
        <strong>{index} / {stepOrder.length}</strong>
        {edgeStep ? <button type="button" aria-label="홈으로 나가기" onClick={onClose}>✕</button> : <span />}
      </div>
      <progress aria-label="SEO 작성 진행률" max={stepOrder.length} value={index} />
    </header>
  );
}

export function SeoGenerationWizard({
  storeProfileId,
  sourceReviews,
  reviewSummary,
  onSyncHandoff,
  onExit = () => undefined,
  syncResultOverride = null,
}: SeoGenerationWizardProps) {
  const receivedSummary: ReviewSummary = reviewSummary ?? {
    summary: sourceReviews.length > 0
      ? `개인정보를 가린 리뷰 ${sourceReviews.length}건에서 음식과 서비스에 대한 좋은 평가를 확인했어요.`
      : '아직 분석할 리뷰가 없어요. 인터뷰 답변을 바탕으로 매장 문구를 만들어 드릴게요.',
    keywords: fallbackKeywords,
    reviewCount: sourceReviews.length,
  };
  const summaryState: ReviewSummary = {
    ...receivedSummary,
    keywords: receivedSummary.keywords.length > 0 ? receivedSummary.keywords : fallbackKeywords,
  };
  const [step, setStep] = useState<SeoWizardStep>('SUMMARY');
  const [purpose, setPurpose] = useState<SeoPurpose | null>(null);
  const [answers, setAnswers] = useState<string[]>(['', '', '']);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [visibleQuestionCount, setVisibleQuestionCount] = useState(1);
  const [isAiTyping, setAiTyping] = useState(false);
  const [body, setBody] = useState('');
  const [tags, setTags] = useState(() => summaryState.keywords);
  const [tagInput, setTagInput] = useState('');
  const [handoff, setHandoff] = useState<SeoSyncHandoff | null>(null);
  const [uploading, setUploading] = useState(false);
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const flow = useSeoGenerationFlow(storeProfileId, (nextHandoff) => {
    setHandoff(nextHandoff);
    setStep('RESULT');
    onSyncHandoff?.(nextHandoff);
  });
  const interviewComplete = answers.every((answer) => answer.trim() !== '');

  useEffect(() => () => {
    if (typingTimerRef.current !== null) window.clearTimeout(typingTimerRef.current);
  }, []);

  useEffect(() => {
    if (step !== 'INTERVIEW') return;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    conversationEndRef.current?.scrollIntoView?.({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'end' });
  }, [answers, isAiTyping, step, visibleQuestionCount]);

  const goBack = () => {
    const index = stepOrder.indexOf(step);
    if (index > 0) setStep(stepOrder[index - 1] ?? 'SUMMARY');
  };

  const sendInterviewAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const answer = currentAnswer.trim();
    if (!answer || isAiTyping || interviewComplete) return;
    const questionIndex = visibleQuestionCount - 1;
    setAnswers((current) => current.map((savedAnswer, index) => index === questionIndex ? answer : savedAnswer));
    setCurrentAnswer('');

    if (questionIndex >= questions.length - 1) return;
    setAiTyping(true);
    typingTimerRef.current = window.setTimeout(() => {
      setVisibleQuestionCount((count) => Math.min(count + 1, questions.length));
      setAiTyping(false);
      typingTimerRef.current = null;
    }, 500);
  };

  const generateRecommendation = async () => {
    if (answers.some((answer) => answer.trim() === '')) {
      flow.setValidationError('세 가지 질문에 모두 답해 주세요.');
      return;
    }
    const generated = await flow.generate(sourceReviews.map(({ id }) => id));
    if (!generated) return;
    const context = answers.map((answer) => answer.trim()).join(' ');
    const generatedBody = generated[0]?.draftText;
    setBody(generatedBody ?? `${context} 정성을 담아 손님을 맞이하는 매장입니다.`);
    setStep('RECOMMEND');
  };

  const addTag = () => {
    const next = tagInput.trim().replace(/^#/, '');
    if (!next || tags.includes(next)) return;
    setTags((current) => [...current, next]);
    setTagInput('');
  };

  const tagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTag();
  };

  const upload = async () => {
    if (uploading || !body.trim()) return;
    setUploading(true);
    const draftText = `${body.trim()}\n\n${tags.map((tag) => `#${tag}`).join(' ')}`.trim();
    for (const draft of flow.drafts) {
      const saved = await flow.saveDraft(draft.draftId, draftText);
      if (!saved) {
        setUploading(false);
        return;
      }
    }
    await flow.approveFromButton();
    setUploading(false);
  };

  return (
    <main className="seo-mobile-flow">
      <StepHeader step={step} onBack={goBack} onClose={onExit} />
      {flow.errorMessage ? <div className="seo-mobile-flow__alert" role="alert">{flow.errorMessage}</div> : null}

      {step === 'SUMMARY' ? (
        <section className="mobile-step-screen" aria-labelledby="summary-title">
          <div className="mobile-step-screen__content">
            <div className="seo-greeting"><span aria-hidden="true">🤖</span><div><h1 id="summary-title" aria-label="사장님! 손님들 리뷰를 분석해 보았어요">사장님!<br />손님들 리뷰를 분석해 보았어요</h1><p>우리 가게에 대해 이렇게 말하고 있어요 😊</p></div></div>
            <article className="review-summary-card">
              <span className="ai-badge">✦ AI 요약</span>
              <p>{summaryState.summary}</p>
              <strong className="keyword-title">주요 키워드</strong>
              <div className="tag-list" aria-label="주요 리뷰 키워드">
                {summaryState.keywords.map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}
              </div>
            </article>
            <div className="review-count-card"><span aria-hidden="true">👥</span><div><small>분석한 리뷰 수</small><strong aria-hidden="true">총 {summaryState.reviewCount}건 <em>(최근 3개월)</em></strong><span className="sr-only">총 {summaryState.reviewCount}건 분석</span></div></div>
          </div>
          <button className="bottom-primary" type="button" onClick={() => setStep('PURPOSE')}>다음 (문구 만들기)</button>
        </section>
      ) : null}

      {step === 'PURPOSE' ? (
        <section className="mobile-step-screen" aria-labelledby="purpose-title">
          <div className="mobile-step-screen__content">
            <p className="eyebrow">작성 목적</p>
            <h1 id="purpose-title">어떤 문구를 작성할까요?</h1>
            <fieldset className="purpose-options">
              <legend className="sr-only">작성 목적 선택</legend>
              <label className={purpose === 'INTRODUCTION' ? 'purpose-card purpose-card--selected' : 'purpose-card'}>
                <span className="purpose-icon" aria-hidden="true">🏪</span>
                <input type="radio" name="purpose" checked={purpose === 'INTRODUCTION'} onChange={() => setPurpose('INTRODUCTION')} />
                <span><strong>1. 매장 대표 소개글<br />&amp; 해시태그 만들기</strong><small>가게 전체를 소개할 때 사용해요.</small><em>예) 우리 가게를 처음 찾는 손님에게<br />알리고 싶을 때</em></span>
              </label>
              <label className={purpose === 'NEWS' ? 'purpose-card purpose-card--selected' : 'purpose-card'}>
                <span className="purpose-icon" aria-hidden="true">📣</span>
                <input type="radio" name="purpose" checked={purpose === 'NEWS'} onChange={() => setPurpose('NEWS')} />
                <span><strong>2. 오늘의 가게 소식<br />&amp; 이벤트 작성하기</strong><small>신메뉴, 휴무, 할인 등 소식을 알릴 때 사용해요.</small></span>
              </label>
            </fieldset>
          </div>
          <button className="bottom-primary" type="button" disabled={!purpose} onClick={() => setStep('INTERVIEW')}>선택 완료</button>
        </section>
      ) : null}

      {step === 'INTERVIEW' ? (
        <section className="mobile-step-screen mobile-step-screen--interview" aria-labelledby="interview-title">
          <div className="mobile-step-screen__content interview-content">
            <div className="interview-heading">
              <h1 id="interview-title">AI 인터뷰</h1>
              <strong>질문 {Math.min(visibleQuestionCount, questions.length)} / {questions.length}</strong>
            </div>
            <div className="interview-steps" aria-hidden="true">{[1,2,3].map((item) => <span key={item} className={item <= visibleQuestionCount ? 'is-active' : ''}>{item}</span>)}</div>
            <div className="chat-thread" aria-label="AI 인터뷰 대화" aria-live="polite">
              {questions.slice(0, visibleQuestionCount).map((question, index) => (
                <div className="chat-exchange" key={question}>
                  <div className="chat-message chat-message--ai">
                    <span className="chat-avatar" aria-hidden="true">AI</span>
                    <p className="chat-bubble chat-bubble--ai">{question}</p>
                  </div>
                  {answers[index] ? (
                    <div className="chat-message chat-message--owner">
                      <p className="chat-bubble chat-bubble--owner">{answers[index]}</p>
                    </div>
                  ) : null}
                </div>
              ))}
              {isAiTyping ? (
                <div className="chat-message chat-message--ai">
                  <span className="chat-avatar" aria-hidden="true">AI</span>
                  <div className="chat-bubble chat-bubble--ai chat-typing" role="status">
                    <span className="sr-only">AI가 답변을 작성하고 있습니다.</span>
                    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
                  </div>
                </div>
              ) : null}
              <div ref={conversationEndRef} aria-hidden="true" />
            </div>
          </div>
          {!interviewComplete ? (
            <form className="chat-input-bar" onSubmit={sendInterviewAnswer}>
              <label className="sr-only" htmlFor="interview-answer">사장님 답변 입력</label>
              <input
                id="interview-answer"
                value={currentAnswer}
                onChange={(event) => setCurrentAnswer(event.target.value)}
                placeholder={isAiTyping ? 'AI가 다음 질문을 준비하고 있어요' : '답변을 입력해 주세요'}
                disabled={isAiTyping}
                autoComplete="off"
              />
              <button type="submit" disabled={isAiTyping || !currentAnswer.trim()}>전송</button>
            </form>
          ) : (
            <button className="bottom-primary interview-recommend-button" type="button" disabled={flow.isGenerating} onClick={() => void generateRecommendation()}>
              {flow.isGenerating ? '추천 문구 만드는 중…' : '문구 추천받기'}
            </button>
          )}
        </section>
      ) : null}

      {step === 'RECOMMEND' ? (
        <section className="mobile-step-screen" aria-labelledby="recommend-title">
          <div className="mobile-step-screen__content">
            <h1 id="recommend-title">추천 문구를 확인하고 필요시 수정해 주세요</h1>
            <p className="recommend-help">직접 수정하셔도 좋아요!</p>
            <label className="recommend-editor"><span>소개글 본문 <small>✎ 직접 수정 가능</small></span><textarea aria-label="소개글 본문" value={body} onChange={(event) => setBody(event.target.value)} rows={8} /></label>
            <div className="hashtag-editor">
              <strong>추천 해시태그 <small>✎ 직접 수정 가능</small></strong>
              <div className="tag-list">
                {tags.map((tag) => <button type="button" className="tag-chip tag-chip--editable" key={tag} onClick={() => setTags((current) => current.filter((item) => item !== tag))}>#{tag} <span aria-hidden="true">×</span></button>)}
              </div>
              <div className="tag-add"><input aria-label="새 해시태그" value={tagInput} onChange={(event) => setTagInput(event.target.value)} onKeyDown={tagKeyDown} placeholder="#태그 추가" /><button type="button" onClick={addTag}>추가</button></div>
            </div>
          </div>
          <div className="bottom-split-actions">
            <button className="bottom-secondary" type="button" onClick={onExit}>취소</button>
            <button className="bottom-primary" type="button" disabled={uploading || flow.isApproving} onClick={() => void upload()}>{uploading ? '업로드 중…' : '업로드 (3사에 반영)'}</button>
          </div>
        </section>
      ) : null}

      {step === 'RESULT' && handoff ? (
        <section className="mobile-step-screen" aria-labelledby="result-title">
          <div className="mobile-step-screen__content result-content">
            <div className="result-check" aria-hidden="true">✓</div>
            <h1 id="result-title">3사에 반영되었습니다!</h1>
            <SyncStatusDashboard syncJobId={handoff.syncJobId} pollIntervalMs={100} resultOverride={syncResultOverride} />
          </div>
          <button className="bottom-primary" type="button" onClick={onExit}>홈으로 돌아가기</button>
        </section>
      ) : null}
    </main>
  );
}
