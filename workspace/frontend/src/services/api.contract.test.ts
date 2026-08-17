import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { getReviewSummary } from '@/services/reviewApi';
import { approveStoreChangeProposal } from '@/services/storeChangeApi';
import { getSyncJobSnapshot } from '@/services/syncJobs';

const timestamp = '2026-08-17T00:00:00Z';

describe('API runtime contract validation', () => {
  test('플랫폼 Task에 허용되지 않은 PARTIAL_SUCCESS가 오면 거절한다', async () => {
    // Given: a damaged response uses the aggregate-only status on one platform task.
    server.use(
      http.get('/api/v1/sync-jobs/damaged-job', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          syncJobId: 'damaged-job',
          status: 'PARTIAL_SUCCESS',
          platformTasks: [
            { platform: 'google', status: 'PARTIAL_SUCCESS', attemptCount: 1, error: null },
            { platform: 'naver', status: 'SUCCESS', attemptCount: 1, error: null },
            { platform: 'kakao', status: 'FAILED', attemptCount: 3, error: null },
          ],
        },
        error: null,
        timestamp,
      })),
    );

    // When / Then: the service rejects the response before it reaches the UI model.
    await expect(getSyncJobSnapshot('damaged-job')).rejects.toMatchObject({
      message: '서버 응답이 API 계약과 일치하지 않습니다.',
    });
  });

  test('승인 응답에서 필수 상태 필드가 누락되면 거절한다', async () => {
    // Given: the backend response is missing proposalStatus and status.
    server.use(
      http.post('/api/v1/store-change-proposals/damaged-proposal/approve', () => HttpResponse.json({
        success: true,
        status: 'PROCESSING',
        data: {
          proposalId: 'damaged-proposal',
          syncJobId: 'damaged-job',
          statusUrl: '/api/v1/sync-jobs/damaged-job',
        },
        error: null,
        timestamp,
      })),
    );

    // When / Then: incomplete approval data cannot be treated as a valid handoff.
    await expect(approveStoreChangeProposal('damaged-proposal', 'key-001')).rejects.toMatchObject({
      message: '서버 응답이 API 계약과 일치하지 않습니다.',
    });
  });

  test('리뷰 응답에 계약에 없는 필드가 포함되면 거절한다', async () => {
    // Given: an otherwise valid review response contains an uncontracted field.
    server.use(
      http.get('/api/v1/store-profiles/store-001/reviews/summary', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          storeProfileId: 'store-001',
          reviewCount: 1,
          summary: '만두전골이 맛있어요.',
          keywords: ['만두전골'],
          sourceReviews: [],
          internalPrompt: 'must not cross the API boundary',
        },
        error: null,
        timestamp,
      })),
    );

    // When / Then: strict parsing blocks unknown response fields.
    await expect(getReviewSummary('store-001')).rejects.toMatchObject({
      message: '서버 응답이 API 계약과 일치하지 않습니다.',
    });
  });

  test('플랫폼 Task 전용 오류 코드가 최상위 Envelope에 오면 거절한다', async () => {
    // Given: a platform-only timeout code contaminates the common API error namespace.
    server.use(
      http.get('/api/v1/store-profiles/store-001/reviews/summary', () => HttpResponse.json({
        success: false,
        status: 'FAILED',
        data: null,
        error: {
          code: 'API_TIMEOUT',
          message: 'provider response must not cross the common error boundary',
          details: [],
          retryable: true,
        },
        timestamp,
      }, { status: 502 })),
    );

    // When / Then: the common envelope parser rejects the polluted error code.
    await expect(getReviewSummary('store-001')).rejects.toMatchObject({
      message: '공통 응답 규격과 일치하지 않습니다.',
    });
  });
});
