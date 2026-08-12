import { seoHandlers, resetSeoHandlerState } from '@/mocks/handlers/seoHandlers';
import { storeChangeHandlers, resetStoreChangeHandlerState } from '@/mocks/handlers/storeChangeHandlers';
import { resetSyncJobHandlerState, syncJobHandlers } from '@/mocks/handlers/syncJobHandlers';
import { reviewHandlers } from '@/mocks/handlers/reviewHandlers';
import { resetRequestSequence } from '@/mocks/factories/envelopeFactory';

export const handlers = [...storeChangeHandlers, ...seoHandlers, ...syncJobHandlers, ...reviewHandlers];
export function resetMockState(): void {
  resetRequestSequence();
  resetStoreChangeHandlerState();
  resetSeoHandlerState();
  resetSyncJobHandlerState();
}
