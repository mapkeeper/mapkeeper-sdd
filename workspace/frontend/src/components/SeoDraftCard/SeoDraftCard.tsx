import { useState } from 'react';
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
  selected: boolean;
  onSelectionChange(selected: boolean): void;
  onSave(draftId: string, draftText: string): void | Promise<void>;
  onReject(draftId: string): void;
  disabled?: boolean;
}

export function SeoDraftCard({
  draft,
  selected,
  onSelectionChange,
  onSave,
  onReject,
  disabled = false,
}: SeoDraftCardProps) {
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(draft.draftText);
  const label = platformNames[draft.platform];
  const rejected = draft.status === 'REJECTED';

  const save = async () => {
    const value = draftText.trim();
    if (!value) return;
    await onSave(draft.draftId, value);
    setEditing(false);
  };

  return (
    <article className={`seo-draft-card seo-draft-card--${draft.platform}`}>
      <header className="seo-draft-card__header">
        <span className="seo-draft-card__icon" aria-hidden="true">{platformIcons[draft.platform]}</span>
        <h2>{label}</h2>
        <span className="seo-draft-card__status">{draft.status ?? 'DRAFT'}</span>
      </header>

      {editing ? (
        <div className="seo-draft-card__editor">
          <label htmlFor={`seo-draft-${draft.draftId}`}>{label} SEO 문구</label>
          <textarea
            id={`seo-draft-${draft.draftId}`}
            value={draftText}
            onChange={(event) => setDraftText(event.target.value)}
            rows={5}
            disabled={disabled}
          />
          <button type="button" onClick={() => void save()} disabled={disabled || !draftText.trim()} style={{ minHeight: 56 }}>
            {label} 수정 저장
          </button>
        </div>
      ) : (
        <p className="seo-draft-card__preview">{draft.draftText}</p>
      )}

      <div className="seo-draft-card__rules">
        <strong>플랫폼 작성 기준</strong>
        <ul>{draft.contentRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </div>

      {!rejected ? (
        <div className="seo-draft-card__controls">
          <label className="seo-draft-card__select">
            <input
              type="checkbox"
              checked={selected}
              onChange={(event) => onSelectionChange(event.target.checked)}
              disabled={disabled}
            />
            {label} 문구 선택
          </label>
          <button type="button" onClick={() => setEditing(true)} disabled={disabled} style={{ minHeight: 56 }}>
            {label} 문구 수정
          </button>
          <button
            className="seo-draft-card__reject"
            type="button"
            onClick={() => onReject(draft.draftId)}
            disabled={disabled}
            style={{ minHeight: 56 }}
          >
            {label} 문구 거절
          </button>
        </div>
      ) : null}
    </article>
  );
}
