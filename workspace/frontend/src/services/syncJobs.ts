import { apiRequestParsed } from '@/services/api';
import type { ApiErrorBody, GetSyncJobResponse, RetrySyncJobResponse } from '@/services/api.types';
import { retrySyncJobResponseSchema, syncJobResponseSchema } from '@/services/contracts/sync';
import type { ErrorCode, PlatformTaskDetail, SyncJob, SyncJobStatus } from '@/types/domain';

const TERMINAL: ReadonlySet<SyncJobStatus> = new Set(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED']);
const RETRYABLE: ReadonlySet<ErrorCode> = new Set(['API_TIMEOUT', 'RATE_LIMITED', 'PLATFORM_SERVER_ERROR']);

export const isTerminalSyncStatus = (status: SyncJobStatus): boolean => TERMINAL.has(status);
export const isRetryEligible = (code: ErrorCode | undefined, retryable?: boolean): boolean =>
  retryable === true && code !== undefined && RETRYABLE.has(code);

function toSyncJob(response: GetSyncJobResponse): SyncJob {
  const platforms: SyncJob['platforms'] = { google: 'PENDING', naver: 'PENDING', kakao: 'PENDING' };
  const pendingDetail = (): PlatformTaskDetail => ({ status: 'PENDING', attemptCount: 0, error: null });
  const platformDetails: SyncJob['platformDetails'] = {
    google: pendingDetail(),
    naver: pendingDetail(),
    kakao: pendingDetail(),
  };
  const summary: SyncJob['summary'] = { total: response.platformTasks.length, succeeded: 0, failed: 0, retrying: 0 };

  for (const task of response.platformTasks) {
    platforms[task.platform] = task.status;
    platformDetails[task.platform] = {
      status: task.status,
      attemptCount: task.attemptCount,
      error: task.error,
    };
    if (task.status === 'SUCCESS') summary.succeeded += 1;
    if (task.status === 'FAILED') summary.failed += 1;
    if (task.status === 'RETRYING') summary.retrying += 1;
  }

  return { syncJobId: response.syncJobId, status: response.status, platforms, platformDetails, summary };
}

export async function getSyncJob(syncJobId: string, signal?: AbortSignal): Promise<SyncJob> {
  const options: RequestInit = signal === undefined ? {} : { signal };
  return toSyncJob((await apiRequestParsed(
    `/api/v1/sync-jobs/${syncJobId}`,
    syncJobResponseSchema,
    options,
  )).data);
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
  const result = await apiRequestParsed(`/api/v1/sync-jobs/${syncJobId}`, syncJobResponseSchema, options);
  return { job: toSyncJob(result.data), warning: result.warning };
}

export async function retrySyncJob(syncJobId: string, signal?: AbortSignal): Promise<RetrySyncJobResponse> {
  const options: RequestInit = signal === undefined ? { method: 'POST' } : { method: 'POST', signal };
  return (await apiRequestParsed(
    `/api/v1/sync-jobs/${syncJobId}/retry`,
    retrySyncJobResponseSchema,
    options,
  )).data;
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
