import { seoHandlers, resetSeoHandlerState } from '@/mocks/handlers/seoHandlers';
import { storeChangeHandlers, resetStoreChangeHandlerState } from '@/mocks/handlers/storeChangeHandlers';
import { resetSyncJobHandlerState, syncJobHandlers } from '@/mocks/handlers/syncJobHandlers';
import { resetRequestSequence } from '@/mocks/factories/envelopeFactory';

export const handlers = [...storeChangeHandlers, ...seoHandlers, ...syncJobHandlers];
export function resetMockState(): void {
  resetRequestSequence();
  resetStoreChangeHandlerState();
  resetSeoHandlerState();
  resetSyncJobHandlerState();
}
