import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import { failedSyncJobFixture, nonRetryableSyncErrorFixture, partialSuccessSyncJobFixture, pendingSyncJobFixture, processingSyncJobFixture, retryableSyncErrorFixture, retryingSyncJobFixture, retrySyncFixture, successSyncJobFixture } from '@/mocks/fixtures/syncJobFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { SyncJob } from '@/types/domain';

let pollCount = 0;
const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

function scenarioJob(): { job: SyncJob; error: typeof retryableSyncErrorFixture | null } {
  const scenario = getMockScenario();
  if (scenario === 'all-success' || scenario === 'default') {
    const stages = [pendingSyncJobFixture, processingSyncJobFixture, successSyncJobFixture];
    return { job: stages[Math.min(pollCount++, stages.length - 1)] ?? successSyncJobFixture, error: null };
  }
  if (scenario === 'partial-success') return { job: partialSuccessSyncJobFixture, error: retryableSyncErrorFixture };
  if (scenario === 'retryable-failure') return { job: failedSyncJobFixture, error: retryableSyncErrorFixture };
  if (scenario === 'non-retryable-failure') return { job: failedSyncJobFixture, error: nonRetryableSyncErrorFixture };
  return { job: processingSyncJobFixture, error: null };
}

export const syncJobHandlers = [
  http.get('/api/v1/sync-jobs/:syncJobId', async ({ params }) => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    if (params.syncJobId !== 'job-001') return HttpResponse.json(errorEnvelope({ code: 'VALIDATION_ERROR', message: '작업을 찾을 수 없습니다.' }), { status: 404, ...responseOptions() });
    const { job, error } = scenarioJob();
    const status = job.status === 'PARTIAL_SUCCESS' ? 'PARTIAL_SUCCESS' : job.status === 'FAILED' ? 'FAILED' : job.status === 'SUCCESS' ? 'SUCCESS' : 'PROCESSING';
    return HttpResponse.json(successEnvelope(job, status, error), responseOptions());
  }),
  http.post('/api/v1/sync-jobs/:syncJobId/retry', async ({ params }) => {
    await mockDelay(scenarioLatency());
    const scenario = getMockScenario();
    if (params.syncJobId !== 'job-001' || scenario === 'non-retryable-failure') return HttpResponse.json(errorEnvelope(nonRetryableSyncErrorFixture), { status: 403, ...responseOptions() });
    pollCount = 0;
    return HttpResponse.json(successEnvelope(retrySyncFixture, 'PROCESSING'), responseOptions());
  }),
];

export function resetSyncJobHandlerState(): void { pollCount = 0; }
export { retryingSyncJobFixture };
