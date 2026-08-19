import type { ProposalChange, ProposalField } from '@/types/domain';
import { PROPOSAL_FIELDS } from '@/types/domain';
import './ProposalEditor.css';

const fieldLabels: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
  parkingInfo: '주차 정보',
};

function parseClosureRange(value: string): { start: string; end: string } {
  const dates = value.match(/\d{4}-\d{2}-\d{2}/g);
  return { start: dates?.[0] ?? '', end: dates?.[1] ?? dates?.[0] ?? '' };
}

interface TemporaryClosureFieldsProps {
  id: string;
  value: string;
  onChange(nextValue: string): void;
  disabled: boolean;
}

function TemporaryClosureFields({ id, value, onChange, disabled }: TemporaryClosureFieldsProps) {
  const { start, end } = parseClosureRange(value);

  const emit = (nextStart: string, nextEnd: string) => {
    if (!nextStart || !nextEnd) return;
    onChange(`${nextStart} ~ ${nextEnd}`);
  };

  return (
    <div className="proposal-editor__date-range">
      <label htmlFor={`${id}-start`}>
        시작일
        <input
          id={`${id}-start`}
          type="date"
          value={start}
          onChange={(event) => emit(event.target.value, end && end >= event.target.value ? end : event.target.value)}
          disabled={disabled}
        />
      </label>
      <span aria-hidden="true">~</span>
      <label htmlFor={`${id}-end`}>
        종료일
        <input
          id={`${id}-end`}
          type="date"
          min={start || undefined}
          value={end}
          onChange={(event) => emit(start, event.target.value)}
          disabled={disabled}
        />
      </label>
    </div>
  );
}

export interface ProposalEditorProps {
  changes: ProposalChange[];
  onChange(changes: ProposalChange[]): void;
  onSave(): void;
  disabled?: boolean;
}

export function ProposalEditor({ changes, onChange, onSave, disabled = false }: ProposalEditorProps) {
  const allowedChanges = changes.filter((change) => PROPOSAL_FIELDS.includes(change.field));

  const updateValue = (index: number, proposedValue: string) => {
    onChange(allowedChanges.map((change, changeIndex) => (
      changeIndex === index ? { ...change, proposedValue } : change
    )));
  };

  return (
    <section className="proposal-editor" aria-label="변경안 수정">
      {allowedChanges.map((change, index) => (
        <div className="proposal-editor__row" key={`${change.field}-${index}`}>
          {change.field === 'temporaryClosure' ? (
            <span className="proposal-editor__row-heading" id={`proposal-${change.field}-heading`}>{fieldLabels[change.field]} 변경 값</span>
          ) : (
            <label htmlFor={`proposal-${change.field}`}>{fieldLabels[change.field]} 변경 값</label>
          )}
          <p>현재 값: {change.currentValue}</p>
          {change.field === 'temporaryClosure' ? (
            <TemporaryClosureFields
              id={`proposal-${change.field}`}
              value={change.proposedValue}
              onChange={(nextValue) => updateValue(index, nextValue)}
              disabled={disabled}
            />
          ) : (
            <input
              id={`proposal-${change.field}`}
              value={change.proposedValue}
              onChange={(event) => updateValue(index, event.target.value)}
              disabled={disabled}
            />
          )}
        </div>
      ))}
      <button type="button" onClick={onSave} disabled={disabled || allowedChanges.length === 0}>
        수정 내용 저장
      </button>
    </section>
  );
}
