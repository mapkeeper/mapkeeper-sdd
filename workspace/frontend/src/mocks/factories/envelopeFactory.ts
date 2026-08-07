import type { ApiEnvelope, ApiErrorBody } from '@/services/api.types';
import type { EnvelopeStatus } from '@/types/domain';
import type { ApiError } from '@/services/contracts/common';

export const MOCK_TIMESTAMP = '2026-08-03T00:00:00Z';
let requestSequence = 0;

export function nextRequestId(): string {
  requestSequence += 1;
  return `req-${String(requestSequence).padStart(3, '0')}`;
}

export function resetRequestSequence(): void { requestSequence = 0; }

export function successEnvelope<T>(data: T, status: EnvelopeStatus = 'SUCCESS', error: ApiErrorBody | null = null): ApiEnvelope<T> {
  return { success: true, status, data, error, timestamp: MOCK_TIMESTAMP };
}

// Accepts the legacy per-feature error shape (`ApiErrorBody`) as well as the strict v0.2
// common-error shape (`ApiError`) so newly migrated handlers can use the same v0.2 error
// codes (e.g. RESOURCE_NOT_FOUND, INVALID_STATE) that the legacy ErrorCode union does not
// include, without weakening either type.
export function errorEnvelope(error: ApiErrorBody | ApiError): {
  success: false;
  status: 'FAILED';
  data: null;
  error: ApiErrorBody | ApiError;
  timestamp: string;
} {
  return { success: false, status: 'FAILED', data: null, error, timestamp: MOCK_TIMESTAMP };
}

export async function mockDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
