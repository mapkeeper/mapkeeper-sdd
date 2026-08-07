import { useState } from 'react';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import { SeoCommonInputForm } from '@/features/seo/SeoCommonInputForm';
import { SeoPlatformResultCard } from '@/components/SeoPlatformResultCard/SeoPlatformResultCard';
import { useSeoGenerationFlow } from '@/features/seo/useSeoGenerationFlow';
import type { SeoCommonInputValue, SeoSyncHandoff } from '@/features/seo/useSeoGenerationFlow';
import type { ReviewSummary, SourceReview } from '@/types/domain';
import './seoGeneration.css';

type SeoWizardStep = 'SUMMARY' | 'COMMON_INPUT' | 'RESULT' | 'SYNC';

const stepOrder: SeoWizardStep[] = ['SUMMARY', 'COMMON_INPUT', 'RESULT', 'SYNC'];
const fallbackKeywords = ['맛있는메뉴', '친절함', '다시찾는집'];
const emptyCommonInput: SeoCommonInputValue = { briefText: '', seedKeywords: [] };

export interface SeoGenerationWizardProps {
  storeProfileId: string;
  sourceReviews: readonly SourceReview[];
  reviewSummary?: ReviewSummary;
  onSyncHandoff?: (handoff: SeoSyncHandoff) => void;
  onExit?: () => void;
}

interface StepHeaderProps {
  step: SeoWizardStep;
  onBack(): void;
  onClose(): void;
}

function StepHeader({ step, onBack, onClose }: StepHeaderProps) {
  const index = stepOrder.indexOf(step) + 1;
  const edgeStep = step === 'SUMMARY' || step === 'SYNC';
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
}: SeoGenerationWizardProps) {
  const receivedSummary: ReviewSummary = reviewSummary ?? {
    summary: sourceReviews.length > 0
      ? `개인정보를 가린 리뷰 ${sourceReviews.length}건에서 음식과 서비스에 대한 좋은 평가를 확인했어요.`
      : '아직 분석할 리뷰가 없어요. 매장 설명을 바탕으로 문구를 만들어 드릴게요.',
    keywords: fallbackKeywords,
    reviewCount: sourceReviews.length,
  };
  const summaryState: ReviewSummary = {
    ...receivedSummary,
    keywords: receivedSummary.keywords.length > 0 ? receivedSummary.keywords : fallbackKeywords,
  };
  const [step, setStep] = useState<SeoWizardStep>('SUMMARY');
  const [commonInput, setCommonInput] = useState<SeoCommonInputValue>(emptyCommonInput);
  const [handoff, setHandoff] = useState<SeoSyncHandoff | null>(null);
  const flow = useSeoGenerationFlow(storeProfileId, (nextHandoff) => {
    setHandoff(nextHandoff);
    setStep('SYNC');
    onSyncHandoff?.(nextHandoff);
  });

  const goBack = () => {
    const index = stepOrder.indexOf(step);
    if (index > 0) setStep(stepOrder[index - 1] ?? 'SUMMARY');
  };

  const submitCommonInput = async (value: SeoCommonInputValue) => {
    const sourceReviewIds = sourceReviews.map(({ id }) => id);
    const isEditingDraft = flow.generation?.status === 'DRAFT';
    const ok = isEditingDraft
      ? await flow.regenerate(value, sourceReviewIds)
      : await flow.create(value, sourceReviewIds);
    if (ok) {
      setCommonInput(value);
      setStep('RESULT');
    }
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
          <button className="bottom-primary" type="button" onClick={() => setStep('COMMON_INPUT')}>다음 (문구 만들기)</button>
        </section>
      ) : null}

      {step === 'COMMON_INPUT' ? (
        <section className="mobile-step-screen" aria-labelledby="common-input-title">
          <div className="mobile-step-screen__content">
            <p className="eyebrow">홍보 문구 만들기</p>
            <h1 id="common-input-title">
              {flow.generation?.status === 'DRAFT' ? '설명을 수정하고 다시 만들어요' : '어떤 매장인지 알려주세요'}
            </h1>
            <SeoCommonInputForm
              initialValue={commonInput}
              submitLabel={flow.generation?.status === 'DRAFT' ? '다시 만들기' : '문구 만들기'}
              busy={flow.isGenerating}
              onSubmit={submitCommonInput}
            />
          </div>
        </section>
      ) : null}

      {step === 'RESULT' && flow.generation ? (
        <section className="mobile-step-screen" aria-labelledby="seo-result-title">
          <div className="mobile-step-screen__content seo-generation-result">
            <h1 id="seo-result-title">Google·Naver·Kakao 문구를 확인해 주세요</h1>
            {flow.generation.status === 'REJECTED' ? (
              <p className="seo-generation-result__status" role="status">이 문구는 반려되었어요. 새로 만들어 주세요.</p>
            ) : (
              <button
                type="button"
                className="seo-generation-result__reject-link"
                disabled={flow.isRejecting || flow.isApproving}
                onClick={() => void flow.reject()}
              >
                {flow.isRejecting ? '반려하는 중…' : '이 문구 반려하기'}
              </button>
            )}
            {flow.generation.drafts.map((draft) => <SeoPlatformResultCard key={draft.draftId} draft={draft} />)}
          </div>
          <div className="bottom-split-actions">
            {flow.generation.status === 'DRAFT' ? (
              <>
                <button className="bottom-secondary" type="button" disabled={flow.isGenerating || flow.isApproving} onClick={() => setStep('COMMON_INPUT')}>
                  다시 만들기
                </button>
                <button className="bottom-primary" type="button" disabled={flow.isApproving} onClick={() => void flow.approveFromButton()}>
                  {flow.isApproving ? '반영 중…' : '승인 (3사에 반영)'}
                </button>
              </>
            ) : (
              <>
                <button className="bottom-secondary" type="button" onClick={onExit}>홈으로</button>
                <button
                  className="bottom-primary"
                  type="button"
                  onClick={() => { flow.reset(); setStep('COMMON_INPUT'); }}
                >
                  새로 만들기
                </button>
              </>
            )}
          </div>
        </section>
      ) : null}

      {step === 'SYNC' && handoff ? (
        <section className="mobile-step-screen" aria-labelledby="result-title">
          <div className="mobile-step-screen__content result-content">
            <div className="result-check" aria-hidden="true">✓</div>
            <h1 id="result-title">3사에 반영되었습니다!</h1>
            <SyncStatusDashboard syncJobId={handoff.syncJobId} />
          </div>
          <button className="bottom-primary" type="button" onClick={onExit}>홈으로 돌아가기</button>
        </section>
      ) : null}
    </main>
  );
}
