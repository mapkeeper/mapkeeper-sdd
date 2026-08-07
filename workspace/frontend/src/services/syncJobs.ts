import { apiRequestParsed } from '@/services/api';
import type { ParsedApiResult } from '@/services/contracts/common';
import { getSyncJobResponseSchema, retrySyncJobResponseSchema } from '@/services/contracts/syncJob';
import type { GetSyncJobResponse, PlatformSyncTask, RetrySyncJobResponse } from '@/services/contracts/syncJob';

const TERMINAL_STATUSES: ReadonlySet<GetSyncJobResponse['status']> = new Set(['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED']);
const MAX_ATTEMPTS = 3;

export function isTerminalSyncStatus(status: GetSyncJobResponse['status']): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Tasks the job-level retry action is allowed to re-run: `FAILED`, server-marked
 * `retryable`, and under the max-attempt cap (API Contract §6 "재시도" - timeout/429/5xx
 * only, up to 3 attempts). Successes and non-retryable/max-attempt tasks are excluded so
 * the single retry button never re-runs them.
 */
export function eligibleRetryTasks(tasks: readonly PlatformSyncTask[]): PlatformSyncTask[] {
  return tasks.filter((task) => task.status === 'FAILED' && task.error?.retryable === true && task.attemptCount < MAX_ATTEMPTS);
}

export function getSyncJob(syncJobId: string, signal?: AbortSignal): Promise<ParsedApiResult<GetSyncJobResponse>> {
  return apiRequestParsed(`/api/v1/sync-jobs/${encodeURIComponent(syncJobId)}`, getSyncJobResponseSchema, signal ? { signal } : {});
}

export function retrySyncJob(syncJobId: string, signal?: AbortSignal): Promise<ParsedApiResult<RetrySyncJobResponse>> {
  return apiRequestParsed(`/api/v1/sync-jobs/${encodeURIComponent(syncJobId)}/retry`, retrySyncJobResponseSchema, {
    method: 'POST',
    ...(signal ? { signal } : {}),
  });
}
