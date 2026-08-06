import { useState } from 'react';
import { getMockScenario, isMockScenario, MOCK_SCENARIOS, setMockScenario, type MockScenario } from '@/mocks/scenarios';

const LABELS: Record<MockScenario, string> = {
  default: '기본',
  'all-success': '모두 성공',
  'partial-success': '일부 성공',
  'retryable-failure': '재시도 가능 실패',
  'non-retryable-failure': '재시도 불가 실패',
  slow: '느린 응답',
  'network-error': '네트워크 오류',
};

export function MockScenarioPanel() {
  const [scenario, updateScenario] = useState<MockScenario>(getMockScenario());
  return (
    <aside aria-label="개발용 모의 응답 설정" style={{ marginTop: 24, padding: 20, border: 0, borderRadius: 20, boxShadow: '0 4px 20px rgba(0,0,0,.04)' }}>
      <label htmlFor="mock-scenario">모의 응답 시나리오</label>
      <select
        id="mock-scenario"
        value={scenario}
        onChange={(event) => {
          if (!isMockScenario(event.target.value)) return;
          setMockScenario(event.target.value);
          updateScenario(event.target.value);
        }}
        style={{ display: 'block', minHeight: 56, width: '100%', marginTop: 8, padding: '0 16px', border: 0, borderRadius: 16, background: '#f2f4f6', fontSize: 18, fontWeight: 500 }}
      >
        {MOCK_SCENARIOS.map((item) => <option key={item} value={item}>{LABELS[item]}</option>)}
      </select>
    </aside>
  );
}
