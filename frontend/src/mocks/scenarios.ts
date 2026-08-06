export type MockScenario = 'default' | 'all-success' | 'partial-success' | 'retryable-failure' | 'non-retryable-failure' | 'slow' | 'network-error';

const scenarios: readonly MockScenario[] = ['default', 'all-success', 'partial-success', 'retryable-failure', 'non-retryable-failure', 'slow', 'network-error'];
let activeScenario: MockScenario = scenarios.includes(import.meta.env.VITE_MOCK_SCENARIO as MockScenario)
  ? (import.meta.env.VITE_MOCK_SCENARIO as MockScenario)
  : 'default';

export const MOCK_SCENARIOS = scenarios;
export const getMockScenario = (): MockScenario => activeScenario;
export function setMockScenario(scenario: MockScenario): void { activeScenario = scenario; }
export function isMockScenario(value: string): value is MockScenario { return scenarios.some((item) => item === value); }
export const scenarioLatency = (): number => activeScenario === 'slow' ? 2_000 : 20;
