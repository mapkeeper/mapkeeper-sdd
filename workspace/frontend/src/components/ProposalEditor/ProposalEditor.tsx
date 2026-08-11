import type { ProposalChange, ProposalField } from '@/types/domain';
import { PROPOSAL_FIELDS } from '@/types/domain';
import './ProposalEditor.css';

const fieldLabels: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
};

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
          <label htmlFor={`proposal-${change.field}`}>{fieldLabels[change.field]} 변경 값</label>
          <p>현재 값: {change.currentValue}</p>
          <input
            id={`proposal-${change.field}`}
            value={change.proposedValue}
            onChange={(event) => updateValue(index, event.target.value)}
            disabled={disabled}
          />
        </div>
      ))}
      <button type="button" onClick={onSave} disabled={disabled || allowedChanges.length === 0}>
        수정 내용 저장
      </button>
    </section>
  );
}
