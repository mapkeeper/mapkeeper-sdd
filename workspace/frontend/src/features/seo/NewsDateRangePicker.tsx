import { useState } from 'react';
import type { FormEvent } from 'react';
import type { NewsDateRange } from './newsDate';

interface NewsDateRangePickerProps {
  initialRange?: NewsDateRange | null;
  initialNoDate?: boolean;
  onConfirm(range: NewsDateRange | null): void;
}

export function NewsDateRangePicker({ initialRange = null, initialNoDate = false, onConfirm }: NewsDateRangePickerProps) {
  const [range, setRange] = useState<NewsDateRange>(initialRange ?? { start: '', end: '' });
  const [noDate, setNoDate] = useState(initialNoDate);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const updateRange = (field: keyof NewsDateRange, value: string) => {
    setRange((current) => ({ ...current, [field]: value }));
    setErrorMessage(null);
    setNoDate(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (noDate) {
      onConfirm(null);
      return;
    }
    if (!range.start || !range.end) {
      setErrorMessage('시작일과 종료일을 모두 선택해 주세요.');
      return;
    }
    if (range.start > range.end) {
      setErrorMessage('종료일은 시작일보다 빠를 수 없어요.');
      return;
    }
    onConfirm(range);
  };

  return (
    <form className="news-date-picker" onSubmit={submit} aria-labelledby="news-date-title">
      <div className="news-date-picker__heading">
        <span className="news-date-picker__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" focusable="false">
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M16 3v4M8 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
          </svg>
        </span>
        <div>
          <h2 id="news-date-title">소식 기간을 확인해 주세요</h2>
          <p>날짜를 정하면 손님에게 더 정확하게 안내할 수 있어요.</p>
        </div>
      </div>
      <div className="news-date-picker__fields">
        <label>
          시작일
          <input
            type="date"
            value={range.start}
            onChange={(event) => updateRange('start', event.target.value)}
            disabled={noDate}
          />
        </label>
        <span className="news-date-picker__separator" aria-hidden="true">→</span>
        <label>
          종료일
          <input
            type="date"
            min={range.start || undefined}
            value={range.end}
            onChange={(event) => updateRange('end', event.target.value)}
            disabled={noDate}
          />
        </label>
      </div>
      {errorMessage ? <p className="news-date-picker__error" role="alert">{errorMessage}</p> : null}
      <button className="news-date-picker__no-date" type="button" onClick={() => { setNoDate((current) => !current); setErrorMessage(null); }}>
        {noDate ? '날짜를 입력할게요' : '기간 없이 게시할게요'}
      </button>
      <button className="bottom-primary news-date-picker__submit" type="submit">
        {noDate ? '기간 없이 문구 만들기' : '이 기간으로 문구 만들기'}
      </button>
    </form>
  );
}
