import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetMockState } from '@/mocks/handlers';
import { server } from '@/mocks/server';
import { setMockScenario } from '@/mocks/scenarios';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  server.resetHandlers();
  resetMockState();
  setMockScenario('default');
});
afterAll(() => server.close());
