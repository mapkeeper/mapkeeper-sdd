import type { ProposalChange } from '@/services/contracts/storeChange';
import { fieldLabels, formatChangeValue } from '@/features/store-change/proposalFormat';
import './ProposalEditor.css';

export interface ProposalEditorProps {
  changes: ProposalChange[];
  onChange(changes: ProposalChange[]): void;
  onSave(): void;
  disabled?: boolean;
}

function replaceAt(changes: ProposalChange[], index: number, next: ProposalChange): ProposalChange[] {
  return changes.map((change, changeIndex) => (changeIndex === index ? next : change));
}

interface FieldEditorProps {
  change: ProposalChange;
  onUpdate(next: ProposalChange): void;
  disabled: boolean;
}

function BusinessHoursEditor({ change, onUpdate, disabled }: FieldEditorProps) {
  if (change.field !== 'businessHours') return null;
  const { proposedValue } = change;
  return (
    <>
      <label htmlFor="proposal-businessHours-open">영업시간 시작 변경 값</label>
      <input
        id="proposal-businessHours-open"
        type="time"
        value={proposedValue.open}
        onChange={(event) => onUpdate({ ...change, proposedValue: { ...proposedValue, open: event.target.value } })}
        disabled={disabled}
      />
      <label htmlFor="proposal-businessHours-close">영업시간 종료 변경 값</label>
      <input
        id="proposal-businessHours-close"
        type="time"
        value={proposedValue.close}
        onChange={(event) => onUpdate({ ...change, proposedValue: { ...proposedValue, close: event.target.value } })}
        disabled={disabled}
      />
    </>
  );
}

function TemporaryClosureEditor({ change, onUpdate, disabled }: FieldEditorProps) {
  if (change.field !== 'temporaryClosure') return null;
  const { proposedValue } = change;
  return (
    <>
      <label htmlFor="proposal-temporaryClosure-start">임시 휴무 시작일 변경 값</label>
      <input
        id="proposal-temporaryClosure-start"
        type="date"
        value={proposedValue.startDate}
        onChange={(event) => onUpdate({ ...change, proposedValue: { ...proposedValue, startDate: event.target.value } })}
        disabled={disabled}
      />
      <label htmlFor="proposal-temporaryClosure-end">임시 휴무 종료일 변경 값</label>
      <input
        id="proposal-temporaryClosure-end"
        type="date"
        value={proposedValue.endDate}
        onChange={(event) => onUpdate({ ...change, proposedValue: { ...proposedValue, endDate: event.target.value } })}
        disabled={disabled}
      />
    </>
  );
}

function RepresentativeMenuNameEditor({ change, onUpdate, disabled }: FieldEditorProps) {
  if (change.field !== 'representativeMenuName') return null;
  return (
    <>
      <label htmlFor="proposal-representativeMenuName">대표 메뉴 변경 값</label>
      <input
        id="proposal-representativeMenuName"
        type="text"
        maxLength={50}
        value={change.proposedValue}
        onChange={(event) => onUpdate({ ...change, proposedValue: event.target.value })}
        disabled={disabled}
      />
    </>
  );
}

export function ProposalEditor({ changes, onChange, onSave, disabled = false }: ProposalEditorProps) {
  const updateAt = (index: number, next: ProposalChange) => onChange(replaceAt(changes, index, next));

  return (
    <section className="proposal-editor" aria-label="변경안 수정">
      {changes.map((change, index) => (
        <div className="proposal-editor__row" key={`${change.field}-${index}`}>
          <p className="proposal-editor__field-label">{fieldLabels[change.field]}</p>
          <p>현재 값: {formatChangeValue(change, 'currentValue')}</p>
          {change.field === 'businessHours' ? (
            <BusinessHoursEditor change={change} onUpdate={(next) => updateAt(index, next)} disabled={disabled} />
          ) : null}
          {change.field === 'temporaryClosure' ? (
            <TemporaryClosureEditor change={change} onUpdate={(next) => updateAt(index, next)} disabled={disabled} />
          ) : null}
          {change.field === 'representativeMenuName' ? (
            <RepresentativeMenuNameEditor change={change} onUpdate={(next) => updateAt(index, next)} disabled={disabled} />
          ) : null}
        </div>
      ))}
      <button type="button" onClick={onSave} disabled={disabled || changes.length === 0}>
        수정 내용 저장
      </button>
    </section>
  );
}
