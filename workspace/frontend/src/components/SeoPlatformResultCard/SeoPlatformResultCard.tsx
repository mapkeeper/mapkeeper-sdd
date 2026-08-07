import type { LocalSeoContent } from '@/services/contracts/seo';
import './SeoPlatformResultCard.css';

const platformNames = {
  google: 'Google',
  naver: 'Naver',
  kakao: 'Kakao',
} as const;

const platformIcons = {
  google: 'G',
  naver: 'N',
  kakao: 'K',
} as const;

export interface SeoPlatformResultCardProps {
  draft: LocalSeoContent;
}

/**
 * Read-only: no selection, edit, or per-platform reject controls. UC2 approves,
 * regenerates, and rejects the whole Generation, never an individual platform result
 * (API Contract §5).
 */
export function SeoPlatformResultCard({ draft }: SeoPlatformResultCardProps) {
  const label = platformNames[draft.platform];

  return (
    <article className={`seo-platform-result-card seo-platform-result-card--${draft.platform}`}>
      <header className="seo-platform-result-card__header">
        <span className="seo-platform-result-card__icon" aria-hidden="true">{platformIcons[draft.platform]}</span>
        <h2>{label}</h2>
      </header>

      <p className="seo-platform-result-card__preview">{draft.draftText}</p>

      <div className="seo-platform-result-card__keywords">
        <strong>키워드</strong>
        <div className="tag-list" aria-label={`${label} 키워드`}>
          {draft.keywords.map((keyword) => <span className="tag-chip" key={keyword}>#{keyword}</span>)}
        </div>
      </div>

      <div className="seo-platform-result-card__rules">
        <strong>플랫폼 작성 기준</strong>
        <ul>{draft.contentRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </div>
    </article>
  );
}
