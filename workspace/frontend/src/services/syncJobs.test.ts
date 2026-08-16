import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { getSyncJobSnapshot } from '@/services/syncJobs';

describe('syncJobs API adapter', () => {
  test('백엔드 platformTasks 응답을 동기화 현황 화면 모델로 변환한다', async () => {
    server.use(
      http.get('/api/v1/sync-jobs/live-job', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          syncJobId: 'live-job',
          status: 'SUCCESS',
          platformTasks: [
            { platform: 'google', status: 'SUCCESS', attemptCount: 1, error: null },
            { platform: 'naver', status: 'SUCCESS', attemptCount: 1, error: null },
            { platform: 'kakao', status: 'SUCCESS', attemptCount: 1, error: null },
          ],
        },
        error: null,
        timestamp: '2026-08-12T00:00:00Z',
      })),
    );

    const result = await getSyncJobSnapshot('live-job');

    expect(result.job).toEqual({
      syncJobId: 'live-job',
      status: 'SUCCESS',
      platforms: { google: 'SUCCESS', naver: 'SUCCESS', kakao: 'SUCCESS' },
      platformDetails: {
        google: { status: 'SUCCESS', attemptCount: 1, error: null },
        naver: { status: 'SUCCESS', attemptCount: 1, error: null },
        kakao: { status: 'SUCCESS', attemptCount: 1, error: null },
      },
      summary: { total: 3, succeeded: 3, failed: 0, retrying: 0 },
    });
  });

  test('플랫폼별 오류와 재시도 가능 여부를 최상위 경고와 분리해 보존한다', async () => {
    server.use(
      http.get('/api/v1/sync-jobs/partial-job', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          syncJobId: 'partial-job',
          status: 'PARTIAL_SUCCESS',
          platformTasks: [
            { platform: 'google', status: 'SUCCESS', attemptCount: 1, error: null },
            {
              platform: 'naver',
              status: 'FAILED',
              attemptCount: 3,
              error: {
                code: 'API_TIMEOUT',
                message: '네이버 응답 시간이 초과됐습니다.',
                retryable: true,
                platform: 'naver',
              },
            },
            {
              platform: 'kakao',
              status: 'FAILED',
              attemptCount: 1,
              error: {
                code: 'PERMISSION_DENIED',
                message: '카카오 권한을 확인해 주세요.',
                retryable: false,
                platform: 'kakao',
              },
            },
          ],
        },
        error: null,
        timestamp: '2026-08-12T00:00:00Z',
      })),
    );

    const result = await getSyncJobSnapshot('partial-job');

    expect(result.warning).toBeNull();
    expect(result.job.platformDetails.naver).toMatchObject({
      attemptCount: 3,
      error: { code: 'API_TIMEOUT', retryable: true },
    });
    expect(result.job.platformDetails.kakao.error).toMatchObject({
      code: 'PERMISSION_DENIED',
      retryable: false,
    });
  });
});
