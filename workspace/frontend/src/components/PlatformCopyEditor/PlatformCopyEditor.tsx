import { useState } from 'react';
import type { FormEvent } from 'react';
import { COPY_TONES, DRAFT_TEXT_MAX_LENGTH } from '@/components/PlatformCopyEditor/copyTones';
import type { CopyToneKey, PlatformCopy } from '@/components/PlatformCopyEditor/copyTones';
import type { Platform } from '@/types/domain';
import './PlatformCopyEditor.css';

const PLATFORM_LABELS: Record<Platform, string> = {
  google: '구글',
  naver: '네이버',
  kakao: '카카오',
};

export interface PlatformCopyEditorProps {
  drafts: readonly PlatformCopy[];
  activePlatform: Platform;
  onActivePlatformChange(platform: Platform): void;
  onTextChange(platform: Platform, text: string): void;
  onKeywordsChange(platform: Platform, keywords: string[]): void;
  onToneChange(tone: CopyToneKey): void;
  onRestore(): void;
  isModified: boolean;
  isRegenerating: boolean;
  /** Named when an edit dropped information the platforms rank on. */
  accuracyWarning?: string | null;
}

/**
 * The three platform texts, each editable where the owner reads it.
 *
 * The screen used to promise "Google·Naver·Kakao에 맞게 게시" and then show one
 * merged paragraph, and "내용 수정" threw the owner back to question one of the
 * interview. Both are fixed here: one tab per platform, edited in place.
 */
export function PlatformCopyEditor({
  drafts,
  activePlatform,
  onActivePlatformChange,
  onTextChange,
  onKeywordsChange,
  onToneChange,
  onRestore,
  isModified,
  isRegenerating,
  accuracyWarning = null,
}: PlatformCopyEditorProps) {
  const [newKeyword, setNewKeyword] = useState('');
  const active = drafts.find((draft) => draft.platform === activePlatform) ?? drafts[0];
  if (!active) return null;

  const addKeyword = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keyword = newKeyword.trim().replace(/^#/, '').trim();
    if (!keyword || active.keywords.includes(keyword) || active.keywords.length >= 10) return;
    onKeywordsChange(active.platform, [...active.keywords, keyword]);
    setNewKeyword('');
  };

  return (
    <div className="platform-copy-editor">
      <div className="platform-copy-editor__tabs" role="tablist" aria-label="플랫폼별 문구">
        {drafts.map((draft) => (
          <button
            key={draft.platform}
            type="button"
            role="tab"
            id={`platform-tab-${draft.platform}`}
            aria-selected={draft.platform === active.platform}
            aria-controls={`platform-panel-${draft.platform}`}
            className={draft.platform === active.platform ? 'is-selected' : ''}
            onClick={() => onActivePlatformChange(draft.platform)}
          >
            {PLATFORM_LABELS[draft.platform]}
          </button>
        ))}
      </div>

      <div
        className="platform-copy-editor__panel"
        role="tabpanel"
        id={`platform-panel-${active.platform}`}
        aria-labelledby={`platform-tab-${active.platform}`}
      >
        <label className="platform-copy-editor__label" htmlFor="platform-copy-text">
          {PLATFORM_LABELS[active.platform]}에 올릴 문구
        </label>
        <textarea
          id="platform-copy-text"
          className="platform-copy-editor__text"
          value={active.text}
          maxLength={DRAFT_TEXT_MAX_LENGTH}
          rows={8}
          disabled={isRegenerating}
          onChange={(event) => onTextChange(active.platform, event.target.value)}
        />
        <p className="platform-copy-editor__count">
          {active.text.length} / {DRAFT_TEXT_MAX_LENGTH}자
        </p>

        {accuracyWarning ? (
          <p className="platform-copy-editor__accuracy" role="status">{accuracyWarning}</p>
        ) : null}

        <div className="platform-copy-editor__keywords">
          <strong>해시태그</strong>
          <div className="tag-list">
            {active.keywords.map((keyword) => (
              <span className="tag-chip" key={keyword}>
                #{keyword}
                <button
                  type="button"
                  aria-label={`${keyword} 해시태그 삭제`}
                  disabled={active.keywords.length <= 1}
                  onClick={() => onKeywordsChange(active.platform, active.keywords.filter((item) => item !== keyword))}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
          <form className="platform-copy-editor__add-keyword" onSubmit={addKeyword}>
            <label className="sr-only" htmlFor="platform-copy-new-keyword">해시태그 추가</label>
            <input
              id="platform-copy-new-keyword"
              value={newKeyword}
              placeholder="예: 만두전골"
              autoComplete="off"
              onChange={(event) => setNewKeyword(event.target.value)}
            />
            <button type="submit" disabled={!newKeyword.trim() || active.keywords.length >= 10}>추가</button>
          </form>
        </div>

        <div className="platform-copy-editor__tools">
          <strong>문체 바꾸기</strong>
          <div className="platform-copy-editor__tones">
            {COPY_TONES.map((tone) => (
              <button
                key={tone.key}
                type="button"
                disabled={isRegenerating}
                onClick={() => onToneChange(tone.key)}
              >
                {tone.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="platform-copy-editor__restore"
            disabled={!isModified || isRegenerating}
            onClick={onRestore}
          >
            원본으로 되돌리기
          </button>
        </div>

        {active.contentRules.length > 0 ? (
          <details className="platform-copy-editor__rules">
            <summary>{PLATFORM_LABELS[active.platform]} 작성 기준</summary>
            <ul>{active.contentRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
          </details>
        ) : null}
      </div>
    </div>
  );
}
