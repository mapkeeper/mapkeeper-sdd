import type { ProposalChange } from '@/services/contracts/storeChange';

type ProposalField = ProposalChange['field'];

export const fieldLabels: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
};

// Renders a structured change value (API Contract §4 "허용 변경 값") as the display string
// used by both the review screen and the editor's "현재 값" hint.
export function formatChangeValue(change: ProposalChange, key: 'currentValue' | 'proposedValue'): string {
  switch (change.field) {
    case 'businessHours': {
      const value = change[key];
      return `${value.open}-${value.close}`;
    }
    case 'temporaryClosure': {
      const value = change[key];
      return value === null ? '휴무 없음' : `${value.startDate} ~ ${value.endDate}`;
    }
    case 'representativeMenuName':
      return change[key];
  }
}
