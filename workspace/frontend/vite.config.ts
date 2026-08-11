import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // `.env.example` is documentation and is not loaded by Vite. Make local
  // development backend-independent by default; a real backend is opt-in.
  const mockMode = env.VITE_API_MOCKING === 'true'
    || (env.VITE_API_MOCKING === undefined && mode === 'development');

  return {
    plugins: [react()],
    define: mode === 'test'
      ? undefined
      : { 'import.meta.env.VITE_API_MOCKING': JSON.stringify(mockMode ? 'true' : 'false') },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: mockMode
      ? {}
      : { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      restoreMocks: true,
      coverage: { provider: 'v8', reporter: ['text', 'html'], exclude: ['src/mocks/**'] },
    },
  };
});
