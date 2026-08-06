import { apiRequest } from '@/services/api';
import type { ApiErrorBody, GetSyncJobResponse, RetrySyncJobResponse } from '@/services/api.types';
import type { ErrorCode, SyncJob, SyncJobStatus } from '@/types/domain';

const TERMINAL: ReadonlySet<SyncJobStatus> = new Set(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED']);
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['API_TIMEOUT', 'RATE_LIMITED', 'INTERNAL_SERVER_ERROR']);

export const isTerminalSyncStatus = (status: SyncJobStatus): boolean => TERMINAL.has(status);
export const isRetryEligible = (code: ErrorCode | undefined, retryable?: boolean): boolean =>
  retryable === true && code !== undefined && RETRYABLE.has(code);

export async function getSyncJob(syncJobId: string, signal?: AbortSignal): Promise<SyncJob> {
  const options: RequestInit = signal === undefined ? {} : { signal };
  return (await apiRequest<GetSyncJobResponse>(`/api/v1/sync-jobs/${syncJobId}`, options)).data;
}

export interface SyncJobSnapshot {
  job: SyncJob;
  warning: ApiErrorBody | null;
}

export async function getSyncJobSnapshot(
  syncJobId: string,
  signal?: AbortSignal,
): Promise<SyncJobSnapshot> {
  const options: RequestInit = signal === undefined ? {} : { signal };
  const result = await apiRequest<GetSyncJobResponse>(`/api/v1/sync-jobs/${syncJobId}`, options);
  return { job: result.data, warning: result.warning };
}

export async function retrySyncJob(syncJobId: string, signal?: AbortSignal): Promise<RetrySyncJobResponse> {
  const options: RequestInit = signal === undefined ? { method: 'POST' } : { method: 'POST', signal };
  return (await apiRequest<RetrySyncJobResponse>(`/api/v1/sync-jobs/${syncJobId}/retry`, options)).data;
}

export interface PollSyncJobOptions {
  signal?: AbortSignal;
  initialIntervalMs?: number;
  maxIntervalMs?: number;
  backoffFactor?: number;
  onUpdate?: (job: SyncJob) => void;
}

export async function pollSyncJob(syncJobId: string, options: PollSyncJobOptions = {}): Promise<SyncJob> {
  let interval = options.initialIntervalMs ?? 500;
  const maxInterval = options.maxIntervalMs ?? 4_000;
  const factor = options.backoffFactor ?? 1.5;
  for (;;) {
    const job = await getSyncJob(syncJobId, options.signal);
    options.onUpdate?.(job);
    if (isTerminalSyncStatus(job.status)) return job;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, interval);
      options.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Polling aborted', 'AbortError'));
      }, { once: true });
    });
    interval = Math.min(maxInterval, Math.round(interval * factor));
  }
}
