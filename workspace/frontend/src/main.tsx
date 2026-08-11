import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/App';

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_API_MOCKING !== 'true') return;
  const { worker } = await import('@/mocks/browser');
  await worker.start({
    serviceWorker: { url: '/mockServiceWorker.js' },
    onUnhandledRequest(request, print) {
      const { pathname } = new URL(request.url);

      // MSW owns only the application API. Vite's document, module, asset,
      // HMR, and service-worker requests must continue to the dev server.
      if (!pathname.startsWith('/api/')) return;

      // Keep missing API mocks loud without turning ordinary page resources
      // into synthetic 500 responses.
      print.error();
    },
  });
}

async function bootstrap(): Promise<void> {
  // Do not render components that can make API requests until the worker is
  // active. This prevents an initial request racing into Vite's proxy.
  await enableMocking();
  const root = document.getElementById('root');
  if (!root) throw new Error('애플리케이션 루트가 없습니다.');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap().catch((error: unknown) => {
  console.error('[Mapkeeper] 애플리케이션 시작 실패', error);
  const root = document.getElementById('root');
  if (root) root.textContent = '모의 API를 시작하지 못했습니다. 페이지를 새로고침해 주세요.';
});
