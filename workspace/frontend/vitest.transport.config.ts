import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Separate config so this suite runs in a real Node environment with no MSW setup file
// (Todo 6) - `npm run test:run` explicitly excludes these files, and this config's
// `include` is the only place they run.
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    globals: true,
    environment: 'node',
    include: ['transport-tests/**/*.test.ts'],
    testTimeout: 15000,
  },
});
