// Standalone runner for the local mock-off contract transport mode (Todo 6): starts the
// same `node:http` stub the automated transport suite uses, but on a fixed port so it can
// sit behind Vite's `/api` proxy (`vite.config.ts` proxies to `http://localhost:8000`) for
// a manual `VITE_API_MOCKING=false npm run dev` smoke.
import { startContractStub } from './contractStub.ts';

const port = Number(process.env.PORT ?? 8000);

const stub = await startContractStub('default', port);
console.log(`[contract-stub] listening on ${stub.url}`);
console.log('[contract-stub] run `VITE_API_MOCKING=false npm run dev -- --host 127.0.0.1` in another terminal, then hit /api/v1/... through it.');

process.on('SIGINT', () => void stub.close().then(() => process.exit(0)));
process.on('SIGTERM', () => void stub.close().then(() => process.exit(0)));
