import type { Platform } from '@/services/contracts/common';
import type { GetSyncJobResponse, PlatformSyncTask, RetrySyncJobResponse } from '@/services/contracts/syncJob';

export const SYNC_JOB_ID = '66666666-6666-4666-8666-666666666666';

const PLATFORM_LABELS: Record<Platform, string> = { google: 'Google', naver: 'Naver', kakao: 'Kakao' };

function task(platform: Platform, status: PlatformSyncTask['status'], attemptCount: number, error: PlatformSyncTask['error'] = null): PlatformSyncTask {
  return { platform, status, attemptCount, error };
}

function apiTimeoutError(platform: Platform): NonNullable<PlatformSyncTask['error']> {
  return { code: 'API_TIMEOUT', message: `${PLATFORM_LABELS[platform]} 플랫폼 처리 시간이 초과되었습니다.`, retryable: true, platform };
}

function permissionDeniedError(platform: Platform): NonNullable<PlatformSyncTask['error']> {
  return { code: 'PERMISSION_DENIED', message: '플랫폼 권한을 확인해 주세요.', retryable: false, platform };
}

export const pendingSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'PENDING',
  platformTasks: [task('google', 'PENDING', 0), task('naver', 'PENDING', 0), task('kakao', 'PENDING', 0)],
};

export const processingSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'PROCESSING',
  platformTasks: [task('google', 'PROCESSING', 1), task('naver', 'PENDING', 0), task('kakao', 'PENDING', 0)],
};

// Illustrates the aggregation rule "하나 이상 RETRYING → RETRYING" even though kakao is
// still FAILED (Data Model §5).
export const retryingSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'RETRYING',
  platformTasks: [task('google', 'SUCCESS', 1), task('naver', 'RETRYING', 2), task('kakao', 'FAILED', 1, apiTimeoutError('kakao'))],
};

export const partialSuccessSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'PARTIAL_SUCCESS',
  platformTasks: [task('google', 'SUCCESS', 1), task('naver', 'FAILED', 1, apiTimeoutError('naver')), task('kakao', 'SUCCESS', 1)],
};

export const successSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'SUCCESS',
  platformTasks: [task('google', 'SUCCESS', 1), task('naver', 'SUCCESS', 1), task('kakao', 'SUCCESS', 1)],
};

export const failedRetryableSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'FAILED',
  platformTasks: [
    task('google', 'FAILED', 1, apiTimeoutError('google')),
    task('naver', 'FAILED', 1, apiTimeoutError('naver')),
    task('kakao', 'FAILED', 1, apiTimeoutError('kakao')),
  ],
};

export const failedNonRetryableSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'FAILED',
  platformTasks: [
    task('google', 'FAILED', 1, permissionDeniedError('google')),
    task('naver', 'FAILED', 1, permissionDeniedError('naver')),
    task('kakao', 'FAILED', 1, permissionDeniedError('kakao')),
  ],
};

// naver already used its 3rd attempt: server-marked retryable, but the frontend must
// still refuse to retry it (API Contract §6 "최대 3회 재시도").
export const maxAttemptSyncJobFixture: GetSyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'PARTIAL_SUCCESS',
  platformTasks: [task('google', 'SUCCESS', 1), task('naver', 'FAILED', 3, apiTimeoutError('naver')), task('kakao', 'SUCCESS', 1)],
};

export const retrySyncFixture: RetrySyncJobResponse = {
  syncJobId: SYNC_JOB_ID,
  status: 'RETRYING',
  retryingPlatforms: ['naver'],
  statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}`,
};

export const noRetryableTasksErrorFixture = {
  code: 'NO_RETRYABLE_TASKS' as const,
  message: '재시도 가능한 실패 플랫폼이 없습니다.',
};
