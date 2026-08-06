import type { SourceReview } from '@/types/domain';
import { sourceReviewFixtures, storeProfileFixture } from '@/mocks/fixtures/storeFixtures';

export interface SeoSourceSelectorProps {
  sourceReviews: readonly SourceReview[];
  selectedReviewIds: readonly string[];
  onSelectionChange(reviewIds: string[]): void;
}

export function SeoSourceSelector({
  sourceReviews,
  selectedReviewIds,
  onSelectionChange,
}: SeoSourceSelectorProps) {
  const toggle = (reviewId: string, checked: boolean) => {
    if (checked) onSelectionChange([...selectedReviewIds, reviewId]);
    else onSelectionChange(selectedReviewIds.filter((id) => id !== reviewId));
  };

  return (
    <fieldset className="seo-source-selector">
      <legend>문구 작성에 참고할 리뷰를 선택해 주세요</legend>
      <p>고객 개인정보가 가려진 리뷰만 사용합니다.</p>
      {sourceReviews.map((review, index) => (
        <label className="seo-source-selector__review" key={review.id}>
          <input
            type="checkbox"
            checked={selectedReviewIds.includes(review.id)}
            onChange={(event) => toggle(review.id, event.target.checked)}
            aria-label={`마스킹된 리뷰 ${index + 1} 선택`}
          />
          <span>{review.bodyMasked}</span>
        </label>
      ))}
    </fieldset>
  );
}

export interface DevelopmentSeoSourceSelectorProps {
  selectedReviewIds: readonly string[];
  onSelectionChange(reviewIds: string[]): void;
}

export function DevelopmentSeoSourceSelector(props: DevelopmentSeoSourceSelectorProps) {
  if (import.meta.env.VITE_API_MOCKING !== 'true') return null;
  return (
    <section aria-label="개발용 매장 및 리뷰 선택">
      <p>선택 매장: {storeProfileFixture.storeName}</p>
      <SeoSourceSelector sourceReviews={sourceReviewFixtures} {...props} />
    </section>
  );
}
