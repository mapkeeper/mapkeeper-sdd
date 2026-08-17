import type { ApiErrorBody, RetrySyncJobResponse } from '@/services/api.types';
import type {
  Platform,
  PlatformTaskDetail,
  PlatformTaskError,
  PlatformTaskStatus,
  SyncJob,
} from '@/types/domain';

const retryableTimeout: PlatformTaskError = {
  code: 'API_TIMEOUT',
  message: '플랫폼 응답 시간이 초과됐습니다.',
  retryable: true,
  platform: 'naver',
};

const permissionDenied: PlatformTaskError = {
  code: 'PERMISSION_DENIED',
  message: '플랫폼 권한을 확인해 주세요.',
  retryable: false,
  platform: 'kakao',
};

function detail(
  status: PlatformTaskStatus,
  attemptCount: number,
  error: PlatformTaskError | null = null,
): PlatformTaskDetail {
  return { status, attemptCount, error };
}

function job(
  status: SyncJob['status'],
  platformDetails: Record<Platform, PlatformTaskDetail>,
): SyncJob {
  const platforms: SyncJob['platforms'] = {
    google: platformDetails.google.status,
    naver: platformDetails.naver.status,
    kakao: platformDetails.kakao.status,
  };
  const values = Object.values(platformDetails);
  return {
    syncJobId: 'job-001',
    status,
    platforms,
    platformDetails,
    summary: {
      total: values.length,
      succeeded: values.filter(({ status: taskStatus }) => taskStatus === 'SUCCESS').length,
      failed: values.filter(({ status: taskStatus }) => taskStatus === 'FAILED').length,
      retrying: values.filter(({ status: taskStatus }) => taskStatus === 'RETRYING').length,
    },
  };
}

export const pendingSyncJobFixture = job('PENDING', {
  google: detail('PENDING', 0),
  naver: detail('PENDING', 0),
  kakao: detail('PENDING', 0),
});
export const processingSyncJobFixture = job('PROCESSING', {
  google: detail('PROCESSING', 1),
  naver: detail('PENDING', 0),
  kakao: detail('PENDING', 0),
});
export const retryingSyncJobFixture = job('RETRYING', {
  google: detail('SUCCESS', 1),
  naver: detail('RETRYING', 2),
  kakao: detail('FAILED', 1, permissionDenied),
});
export const partialSuccessSyncJobFixture = job('PARTIAL_SUCCESS', {
  google: detail('SUCCESS', 1),
  naver: detail('FAILED', 3, retryableTimeout),
  kakao: detail('FAILED', 1, permissionDenied),
});
export const successSyncJobFixture = job('SUCCESS', {
  google: detail('SUCCESS', 1),
  naver: detail('SUCCESS', 1),
  kakao: detail('SUCCESS', 1),
});
export const failedSyncJobFixture = job('FAILED', {
  google: detail('FAILED', 3, { ...retryableTimeout, platform: 'google' }),
  naver: detail('FAILED', 3, retryableTimeout),
  kakao: detail('FAILED', 3, { ...retryableTimeout, platform: 'kakao' }),
});
export const nonRetryableFailedSyncJobFixture = job('FAILED', {
  google: detail('FAILED', 1, { ...permissionDenied, platform: 'google' }),
  naver: detail('FAILED', 1, { ...permissionDenied, platform: 'naver' }),
  kakao: detail('FAILED', 1, permissionDenied),
});

export const retryableSyncErrorFixture: ApiErrorBody = {
  code: 'API_TIMEOUT',
  message: '일부 플랫폼의 처리가 시간 초과로 실패했습니다.',
  retryable: true,
};
export const nonRetryableSyncErrorFixture: ApiErrorBody = {
  code: 'PERMISSION_DENIED',
  message: '플랫폼 권한을 확인해 주세요.',
  retryable: false,
};
export const retrySyncFixture: RetrySyncJobResponse = {
  syncJobId: 'job-001',
  status: 'RETRYING',
  retryingPlatforms: ['naver'],
  statusUrl: '/api/v1/sync-jobs/job-001',
};
