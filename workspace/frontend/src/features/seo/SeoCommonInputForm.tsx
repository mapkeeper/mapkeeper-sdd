import { useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { seoCommonInputSchema } from '@/services/contracts/seo';
import type { SeoCommonInputValue } from '@/features/seo/useSeoGenerationFlow';

export interface SeoCommonInputFormProps {
  initialValue?: SeoCommonInputValue;
  submitLabel: string;
  busy: boolean;
  onSubmit(value: SeoCommonInputValue): void | Promise<void>;
}

const MAX_BRIEF_LENGTH = 500;
const MAX_KEYWORDS = 5;
const MAX_KEYWORD_LENGTH = 30;

export function SeoCommonInputForm({ initialValue, submitLabel, busy, onSubmit }: SeoCommonInputFormProps) {
  const [briefText, setBriefText] = useState(initialValue?.briefText ?? '');
  const [keywords, setKeywords] = useState<string[]>(initialValue?.seedKeywords ?? []);
  const [keywordInput, setKeywordInput] = useState('');
  const [keywordNotice, setKeywordNotice] = useState<string | null>(null);

  const addKeyword = () => {
    const next = keywordInput.trim().replace(/^#/, '');
    if (!next) return;
    if (keywords.includes(next)) {
      setKeywordNotice('이미 추가한 키워드예요.');
      setKeywordInput('');
      return;
    }
    if (keywords.length >= MAX_KEYWORDS) {
      setKeywordNotice(`키워드는 최대 ${MAX_KEYWORDS}개까지 추가할 수 있어요.`);
      return;
    }
    if (next.length > MAX_KEYWORD_LENGTH) {
      setKeywordNotice(`키워드는 ${MAX_KEYWORD_LENGTH}자 이하로 입력해 주세요.`);
      return;
    }
    setKeywords((current) => [...current, next]);
    setKeywordInput('');
    setKeywordNotice(null);
  };

  const removeKeyword = (keyword: string) => setKeywords((current) => current.filter((item) => item !== keyword));

  const keywordKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addKeyword();
  };

  const parseResult = seoCommonInputSchema.safeParse({ briefText: briefText.trim(), seedKeywords: keywords });
  const canSubmit = parseResult.success && !busy;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) {
      setKeywordNotice('공통 설명(1~500자)과 키워드(1~5개)를 확인해 주세요.');
      return;
    }
    await onSubmit({ briefText: briefText.trim(), seedKeywords: keywords });
  };

  return (
    <form className="seo-common-input" onSubmit={(event) => void submit(event)}>
      <label className="seo-common-input__field">
        <span>어떤 매장인지 자유롭게 설명해 주세요 <small>{briefText.length}/{MAX_BRIEF_LENGTH}자</small></span>
        <textarea
          aria-label="공통 홍보 설명"
          value={briefText}
          maxLength={MAX_BRIEF_LENGTH}
          onChange={(event) => setBriefText(event.target.value)}
          rows={6}
          placeholder="예) 만두전골의 깊은 국물 맛과 신선한 재료를 강조하고 싶어요."
        />
      </label>

      <div className="seo-common-input__field">
        <span>꼭 들어갔으면 하는 키워드 <small>{keywords.length}/{MAX_KEYWORDS}개</small></span>
        <div className="tag-list" aria-label="선택한 키워드">
          {keywords.map((keyword) => (
            <button type="button" className="tag-chip tag-chip--editable" key={keyword} onClick={() => removeKeyword(keyword)}>
              #{keyword} <span aria-hidden="true">×</span>
            </button>
          ))}
        </div>
        <div className="tag-add">
          <input
            aria-label="새 키워드"
            value={keywordInput}
            onChange={(event) => setKeywordInput(event.target.value)}
            onKeyDown={keywordKeyDown}
            placeholder="#키워드 추가"
            disabled={keywords.length >= MAX_KEYWORDS}
          />
          <button type="button" onClick={addKeyword} disabled={keywords.length >= MAX_KEYWORDS}>추가</button>
        </div>
        {keywordNotice ? <p className="seo-common-input__notice" role="status">{keywordNotice}</p> : null}
      </div>

      <button className="bottom-primary" type="submit" disabled={!canSubmit}>
        {busy ? '문구 만드는 중…' : submitLabel}
      </button>
    </form>
  );
}
