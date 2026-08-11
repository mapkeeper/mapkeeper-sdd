import type { SeoDraft } from '@/types/domain';
import './SeoDraftCard.css';

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

export interface SeoDraftCardProps {
  draft: SeoDraft;
}

export function SeoDraftCard({ draft }: SeoDraftCardProps) {
  const label = platformNames[draft.platform];

  return (
    <article className={`seo-draft-card seo-draft-card--${draft.platform}`}>
      <header className="seo-draft-card__header">
        <span className="seo-draft-card__icon" aria-hidden="true">{platformIcons[draft.platform]}</span>
        <h2>{label}</h2>
        <span className="seo-draft-card__status">{draft.status ?? 'DRAFT'}</span>
      </header>

      <p className="seo-draft-card__preview">{draft.draftText}</p>

      <div className="seo-draft-card__rules">
        <strong>플랫폼 작성 기준</strong>
        <ul>{draft.contentRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </div>

    </article>
  );
}
