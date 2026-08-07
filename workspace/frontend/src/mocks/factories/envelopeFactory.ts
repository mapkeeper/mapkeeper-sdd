import type { ApiEnvelope, ApiError, ApiStatus } from '@/services/contracts/common';

export const MOCK_TIMESTAMP = '2026-08-03T00:00:00Z';
let requestSequence = 0;

export function nextRequestId(): string {
  requestSequence += 1;
  return `req-${String(requestSequence).padStart(3, '0')}`;
}

export function resetRequestSequence(): void { requestSequence = 0; }

export function successEnvelope<T>(data: T, status: ApiStatus = 'SUCCESS', error: ApiError | null = null): ApiEnvelope<T> {
  return { success: true, status, data, error, timestamp: MOCK_TIMESTAMP };
}

export function errorEnvelope(error: ApiError): {
  success: false;
  status: 'FAILED';
  data: null;
  error: ApiError;
  timestamp: string;
} {
  return { success: false, status: 'FAILED', data: null, error, timestamp: MOCK_TIMESTAMP };
}

export async function mockDelay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
