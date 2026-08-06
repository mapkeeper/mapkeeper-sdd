import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockScenarioPanel } from '@/mocks/MockScenarioPanel';
import { getMockScenario } from '@/mocks/scenarios';

test('개발자가 모의 응답 시나리오를 선택할 수 있다', async () => {
  const user = userEvent.setup();
  render(<MockScenarioPanel />);
  await user.selectOptions(screen.getByLabelText('모의 응답 시나리오'), 'partial-success');
  expect(getMockScenario()).toBe('partial-success');
});
