import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import { SeoDraftCard } from '@/components/SeoDraftCard/SeoDraftCard';
import { useSeoGenerationFlow } from '@/features/seo/useSeoGenerationFlow';
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition';
import type { SeoSyncHandoff } from '@/features/seo/useSeoGenerationFlow';
import { NewsDateRangePicker } from '@/features/seo/NewsDateRangePicker';
import type { NewsDateRange } from '@/features/seo/newsDate';
import { parseNewsSchedule } from '@/features/seo/newsDate';
import type { PlatformResult } from '@/components/SyncStatus/SyncStatus';
import type { ReviewSummary, SourceReview } from '@/types/domain';
import './seoGeneration.css';

type SeoWizardStep = 'SUMMARY' | 'PURPOSE' | 'INTERVIEW' | 'RECOMMEND' | 'RESULT';
type SeoPurpose = 'INTRODUCTION' | 'NEWS';

const stepOrder: SeoWizardStep[] = ['SUMMARY', 'PURPOSE', 'INTERVIEW', 'RECOMMEND', 'RESULT'];
const interviewQuestions: Record<SeoPurpose, readonly string[]> = {
  INTRODUCTION: [
    '사장님의 가게를 한 줄로 표현해주세요.',
    '가장 내세우고 싶은 특징이 있나요?',
    '대표 메뉴가 무엇인가요?',
  ],
  NEWS: [
    '어떤 가게 소식을 알려드릴까요? 예를 들면 신메뉴, 할인, 이벤트, 임시휴무 등이 있어요.',
    '손님에게 어떤 내용을 알려드리고 싶나요? 무엇을 하는지, 어떤 혜택이 있는지 편하게 말씀해 주세요.',
    '이 소식은 언제까지 진행되나요? 날짜나 기간, 이용 조건이 없다면 “없어요”라고 말씀해 주세요.',
  ],
};
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
  const [extraQuestion, setExtraQuestion] = useState<string | null>(null);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [visibleQuestionCount, setVisibleQuestionCount] = useState(1);
  const [isAiTyping, setAiTyping] = useState(false);
  const [body, setBody] = useState('');
  const [newsDateRange, setNewsDateRange] = useState<NewsDateRange | null>(null);
  const [newsDateConfirmed, setNewsDateConfirmed] = useState(false);
  const [newsHasNoDate, setNewsHasNoDate] = useState(false);
  const [tags] = useState(() => summaryState.keywords);
  const [handoff, setHandoff] = useState<SeoSyncHandoff | null>(null);
  const [uploading, setUploading] = useState(false);
  const speech = useSpeechRecognition();
  const submittedSpeechRef = useRef('');
  const conversationEndRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<number | null>(null);
  const flow = useSeoGenerationFlow(storeProfileId, (nextHandoff) => {
    setHandoff(nextHandoff);
    setStep('RESULT');
    onSyncHandoff?.(nextHandoff);
  });
  const baseQuestions = purpose === null ? interviewQuestions.INTRODUCTION : interviewQuestions[purpose];
  const questions = extraQuestion === null ? baseQuestions : [...baseQuestions, extraQuestion];
  const interviewComplete = questions.every((_, index) => Boolean(answers[index]?.trim()));

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

  const submitInterviewAnswer = useCallback((value: string) => {
    const answer = value.trim();
    if (!answer || isAiTyping || interviewComplete) return;
    const questionIndex = visibleQuestionCount - 1;
    setAnswers((current) => current.length > questionIndex
      ? current.map((savedAnswer, index) => index === questionIndex ? answer : savedAnswer)
      : [...current, answer]);
    if (purpose === 'NEWS' && questionIndex >= baseQuestions.length - 1) {
      const parsedSchedule = parseNewsSchedule(answer);
      if (parsedSchedule.range || parsedSchedule.hasNoDate) {
        setNewsDateRange(parsedSchedule.range);
        setNewsHasNoDate(parsedSchedule.hasNoDate);
      }
    }
    setCurrentAnswer('');

    const isLastBaseQuestion = questionIndex === baseQuestions.length - 1 && extraQuestion === null;
    const needsNewsFollowUp = purpose === 'NEWS'
      && isLastBaseQuestion
      && /^(네|예|있어요|있습니다|모르겠어요|잘 모르겠어요|있는데요)[.!?]?$/i.test(answer);
    if (needsNewsFollowUp) {
      setExtraQuestion('구체적인 날짜, 기간 또는 할인 혜택을 알려주실 수 있을까요?');
    }
    if (questionIndex >= questions.length - 1 && !needsNewsFollowUp) return;
    const nextQuestionCount = needsNewsFollowUp ? baseQuestions.length + 1 : questions.length;
    setAiTyping(true);
    typingTimerRef.current = window.setTimeout(() => {
      setVisibleQuestionCount((count) => Math.min(count + 1, nextQuestionCount));
      setAiTyping(false);
      typingTimerRef.current = null;
    }, 500);
  }, [baseQuestions.length, extraQuestion, interviewComplete, isAiTyping, purpose, questions.length, visibleQuestionCount]);

  const sendInterviewAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitInterviewAnswer(currentAnswer);
  };

  useEffect(() => {
    if (step !== 'INTERVIEW' || speech.state !== 'RECOGNIZED' || !speech.recognizedText) return;
    if (submittedSpeechRef.current === speech.recognizedText) return;
    submittedSpeechRef.current = speech.recognizedText;
    setCurrentAnswer(speech.recognizedText);
    submitInterviewAnswer(speech.recognizedText);
  }, [speech.recognizedText, speech.state, step, submitInterviewAnswer]);

  const generateRecommendation = async () => {
    if (answers.some((answer) => answer.trim() === '')) {
      flow.setValidationError('세 가지 질문에 모두 답해 주세요.');
      return;
    }
    const answerText = answers.map((answer) => answer.trim()).join(' ');
    const newsScheduleText = purpose !== 'NEWS'
      ? ''
      : newsHasNoDate
        ? ' 행사 기간은 없습니다.'
        : newsDateRange
          ? ` 행사 기간은 ${newsDateRange.start}부터 ${newsDateRange.end}까지입니다.`
          : '';
    const generated = await flow.generate({
      briefText: `${answerText}${newsScheduleText}`,
      seedKeywords: tags,
      sourceReviewIds: sourceReviews.map(({ id }) => id),
    });
    if (!generated) return;
    const context = answers.map((answer) => answer.trim()).join(' ');
    const generatedBody = generated[0]?.draftText;
    setBody(generatedBody ?? `${context} 정성을 담아 손님을 맞이하는 매장입니다.`);
    setStep('RECOMMEND');
  };

  const upload = async () => {
    if (uploading || !body.trim()) return;
    setUploading(true);
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
            <aside className="purpose-preview" aria-live="polite">
              <header><span aria-hidden="true">{purpose === 'NEWS' ? '📣' : purpose === 'INTRODUCTION' ? '✨' : '💡'}</span><div><strong>{purpose === 'NEWS' ? '가게 소식은 이렇게 만들어져요' : purpose === 'INTRODUCTION' ? '소개글은 이렇게 만들어져요' : '하나를 선택해 보세요'}</strong><small>질문 3개 · 약 1분 소요</small></div></header>
              {purpose === 'INTRODUCTION' ? <div className="purpose-preview__example">
                <span>미리보기</span><p>“정성껏 빚은 만두와 깊은 국물로 따뜻한 한 끼를 준비합니다.”</p>
                <div><i>구글</i><i>네이버</i><i>카카오</i></div>
              </div> : purpose === 'NEWS' ? <div className="purpose-preview__example">
                <span>활용 예시</span><div className="purpose-preview__chips"><i>신메뉴 출시</i><i>임시 휴무</i><i>할인 이벤트</i></div>
                <p>소식에 꼭 필요한 날짜와 혜택을 맵지기가 보기 쉽게 정리해 드려요.</p>
              </div> : <p className="purpose-preview__empty">선택한 목적에 맞춰 맵지기가 짧고 쉬운 질문을 드린 뒤, 3사에 어울리는 문구를 추천해 드릴게요.</p>}
            </aside>
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
            <div className="interview-steps" aria-hidden="true">{questions.map((_, index) => { const item = index + 1; return <span key={item} className={item <= visibleQuestionCount ? 'is-active' : ''}>{item}</span>; })}</div>
            <div className="chat-thread" aria-label="AI 인터뷰 대화" aria-live="polite">
              {questions.slice(0, visibleQuestionCount).map((question, index) => (
                <div className="chat-exchange" key={question}>
                  <div className="chat-message chat-message--ai">
                    <span className="chat-avatar" aria-hidden="true">🤖</span>
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
                  <span className="chat-avatar" aria-hidden="true">🤖</span>
                  <div className="chat-bubble chat-bubble--ai chat-typing" role="status">
                    <span className="sr-only">AI가 답변을 작성하고 있습니다.</span>
                    <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
                  </div>
                </div>
              ) : null}
              {!isAiTyping && !interviewComplete ? <p className="chat-guidance">💡 맵지기가 사장님의 답변을 듣고<br />멋진 홍보 문구를 고민할게요!</p> : null}
              <div ref={conversationEndRef} aria-hidden="true" />
            </div>
          </div>
          {!interviewComplete ? (
            <form className="chat-input-bar" onSubmit={sendInterviewAnswer}>
              {speech.state === 'LISTENING' ? <div className="chat-voice-listening" role="status"><span className="chat-wave" aria-hidden="true"><i /><i /><i /><i /></span><span>맵지기가 듣고 있어요... 편하게 말씀해 주세요</span></div> : null}
              {speech.state === 'FAILED' ? <p className="chat-voice-error" role="alert">음성을 인식하지 못했어요. 다시 시도하거나 직접 입력해 주세요.</p> : null}
              <div className="chat-input-row">
                <label className="sr-only" htmlFor="interview-answer">사장님 답변 입력</label>
                <input id="interview-answer" value={currentAnswer} onChange={(event) => setCurrentAnswer(event.target.value)} placeholder={isAiTyping ? 'AI가 다음 질문을 준비하고 있어요' : '답변을 입력해 주세요'} disabled={isAiTyping || speech.state === 'LISTENING'} autoComplete="off" />
                <button className={speech.state === 'LISTENING' ? 'chat-voice-button is-listening' : 'chat-voice-button'} type="button" onClick={speech.state === 'LISTENING' ? speech.stop : speech.start} disabled={isAiTyping} aria-label={speech.state === 'LISTENING' ? '음성 입력 중지' : '음성으로 말하기'}><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4M9 21h6"/></svg></button>
                <button className="chat-send-button" type="submit" disabled={isAiTyping || speech.state === 'LISTENING' || !currentAnswer.trim()}>전송</button>
              </div>
            </form>
          ) : purpose === 'NEWS' && !newsDateConfirmed ? (
            <NewsDateRangePicker
              initialRange={newsDateRange}
              initialNoDate={newsHasNoDate}
              onConfirm={(range) => {
                setNewsDateRange(range);
                setNewsHasNoDate(range === null);
                setNewsDateConfirmed(true);
              }}
            />
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
            <h1 id="recommend-title">3사 전체 추천 문구를 확인해 주세요</h1>
            <p className="recommend-help">세 문구를 확인한 뒤 한 번에 승인합니다.</p>
            <div className="seo-draft-list" aria-label="3사 추천 문구">
              {flow.drafts.map((draft) => <SeoDraftCard key={draft.draftId} draft={draft} />)}
            </div>
            <div className="hashtag-editor">
              <strong>3사 공통 추천 해시태그</strong>
              <div className="tag-list">
                {tags.map((tag) => <span className="tag-chip" key={tag}>#{tag}</span>)}
              </div>
            </div>
          </div>
          <div className="bottom-split-actions">
            <button className="bottom-secondary" type="button" onClick={onExit}>취소</button>
            <button className="bottom-primary" type="button" disabled={uploading || flow.isApproving} onClick={() => void upload()}>{uploading ? '전체 승인 처리 중…' : '3사 전체 승인'}</button>
          </div>
        </section>
      ) : null}

      {step === 'RESULT' && handoff ? (
        <section className="mobile-step-screen" aria-labelledby="result-title">
          <div className="mobile-step-screen__content result-content">
            <h1 id="result-title" className="sr-only">3사에 반영되었습니다!</h1>
            <SyncStatusDashboard syncJobId={handoff.syncJobId} pollIntervalMs={100} resultOverride={syncResultOverride} viewMode="seo" seoContent={body} seoTags={tags} />
          </div>
          <button className="bottom-primary" type="button" onClick={onExit}>확인 (홈으로 이동)</button>
        </section>
      ) : null}
    </main>
  );
}
