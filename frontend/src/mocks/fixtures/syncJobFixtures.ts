import type { ApiErrorBody, RetrySyncJobResponse } from '@/services/api.types';
import type { SyncJob } from '@/types/domain';

const job = (status: SyncJob['status'], platforms: SyncJob['platforms'], summary: SyncJob['summary']): SyncJob => ({
  syncJobId: 'job-001', status, platforms, summary,
});

export const pendingSyncJobFixture = job('PENDING', { google: 'PENDING', naver: 'PENDING', kakao: 'PENDING' }, { total: 3, succeeded: 0, failed: 0, retrying: 0 });
export const processingSyncJobFixture = job('PROCESSING', { google: 'PROCESSING', naver: 'PENDING', kakao: 'PENDING' }, { total: 3, succeeded: 0, failed: 0, retrying: 0 });
export const retryingSyncJobFixture = job('RETRYING', { google: 'SUCCESS', naver: 'RETRYING', kakao: 'FAILED' }, { total: 3, succeeded: 1, failed: 1, retrying: 1 });
export const partialSuccessSyncJobFixture = job('PARTIAL_SUCCESS', { google: 'SUCCESS', naver: 'RETRYING', kakao: 'FAILED' }, { total: 3, succeeded: 1, failed: 1, retrying: 1 });
export const successSyncJobFixture = job('SUCCESS', { google: 'SUCCESS', naver: 'SUCCESS', kakao: 'SUCCESS' }, { total: 3, succeeded: 3, failed: 0, retrying: 0 });
export const failedSyncJobFixture = job('FAILED', { google: 'FAILED', naver: 'FAILED', kakao: 'FAILED' }, { total: 3, succeeded: 0, failed: 3, retrying: 0 });
export const retryableSyncErrorFixture: ApiErrorBody = { code: 'API_TIMEOUT', message: '일부 플랫폼의 처리가 시간 초과로 실패했습니다.', retryable: true };
export const nonRetryableSyncErrorFixture: ApiErrorBody = { code: 'PERMISSION_DENIED', message: '플랫폼 권한을 확인해 주세요.', retryable: false };
export const retrySyncFixture: RetrySyncJobResponse = { syncJobId: 'job-001', retryingPlatforms: ['naver'] };
