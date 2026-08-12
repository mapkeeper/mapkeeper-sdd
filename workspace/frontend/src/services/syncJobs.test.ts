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
      summary: { total: 3, succeeded: 3, failed: 0, retrying: 0 },
    });
  });
});
