import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { failedSyncJobFixture, nonRetryableFailedSyncJobFixture, nonRetryableSyncErrorFixture, partialSuccessSyncJobFixture, pendingSyncJobFixture, processingSyncJobFixture, retryingSyncJobFixture, retrySyncFixture, successSyncJobFixture } from '@/mocks/fixtures/syncJobFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { GetSyncJobResponse } from '@/services/api.types';
import type { SyncJob } from '@/types/domain';

let pollCount = 0;
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

function scenarioJob(): SyncJob {
  const scenario = getMockScenario();
  if (scenario === 'all-success' || scenario === 'default') {
    const stages = [pendingSyncJobFixture, processingSyncJobFixture, successSyncJobFixture];
    return stages[Math.min(pollCount++, stages.length - 1)] ?? successSyncJobFixture;
  }
  if (scenario === 'partial-success') return partialSuccessSyncJobFixture;
  if (scenario === 'retryable-failure') return failedSyncJobFixture;
  if (scenario === 'non-retryable-failure') return nonRetryableFailedSyncJobFixture;
  return processingSyncJobFixture;
}

function toContractResponse(job: SyncJob): GetSyncJobResponse {
  return {
    syncJobId: job.syncJobId,
    status: job.status,
    platformTasks: (['google', 'naver', 'kakao'] as const).map((platform) => ({
      platform,
      status: job.platformDetails[platform].status,
      attemptCount: job.platformDetails[platform].attemptCount,
      error: job.platformDetails[platform].error,
    })),
  };
}

export const syncJobHandlers = [
  http.get('*/api/v1/sync-jobs/:syncJobId', async ({ params }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    if (params.syncJobId !== 'job-001') return HttpResponse.json(errorEnvelope({ code: 'VALIDATION_ERROR', message: '작업을 찾을 수 없습니다.' }), { status: 404, ...responseOptions() });
    const job = scenarioJob();
    return HttpResponse.json(successEnvelope(toContractResponse(job)), responseOptions());
  }),
  http.post('*/api/v1/sync-jobs/:syncJobId/retry', async ({ params }) => {
    await mockDelay(scenarioLatency());
    const scenario = getMockScenario();
    if (params.syncJobId !== 'job-001' || scenario === 'non-retryable-failure') return HttpResponse.json(errorEnvelope(nonRetryableSyncErrorFixture), { status: 409, ...responseOptions() });
    pollCount = 0;
    return HttpResponse.json(successEnvelope(retrySyncFixture, 'PROCESSING'), responseOptions());
  }),
];

export function resetSyncJobHandlerState(): void { pollCount = 0; }
export { retryingSyncJobFixture };
