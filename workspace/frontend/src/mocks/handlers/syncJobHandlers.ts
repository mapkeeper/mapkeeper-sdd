import { http, HttpResponse } from 'msw';
import { errorEnvelope, mockDelay, nextRequestId, successEnvelope } from '@/mocks/factories/envelopeFactory';
import {
  SYNC_JOB_ID,
  failedNonRetryableSyncJobFixture,
  failedRetryableSyncJobFixture,
  noRetryableTasksErrorFixture,
  partialSuccessSyncJobFixture,
  pendingSyncJobFixture,
  processingSyncJobFixture,
  successSyncJobFixture,
} from '@/mocks/fixtures/syncJobFixtures';
import { getMockScenario, scenarioLatency } from '@/mocks/scenarios';
import type { MockScenario } from '@/mocks/scenarios';
import { eligibleRetryTasks } from '@/services/syncJobs';
import type { GetSyncJobResponse, PlatformSyncTask } from '@/services/contracts/syncJob';

const responseOptions = () => ({ headers: { 'X-Request-ID': nextRequestId() } });

let defaultPollCount = 0;
let recoveryScenario: MockScenario | null = null;
let recoveryPollCount = 0;

const PROGRESSING_SCENARIOS: ReadonlySet<MockScenario> = new Set(['default', 'all-success', 'slow']);

function baseScenarioJob(scenario: MockScenario): GetSyncJobResponse {
  if (scenario === 'partial-success') return partialSuccessSyncJobFixture;
  if (scenario === 'retryable-failure') return failedRetryableSyncJobFixture;
  if (scenario === 'non-retryable-failure') return failedNonRetryableSyncJobFixture;
  const stages = [pendingSyncJobFixture, processingSyncJobFixture, successSyncJobFixture];
  const job = stages[Math.min(defaultPollCount, stages.length - 1)] ?? successSyncJobFixture;
  if (PROGRESSING_SCENARIOS.has(scenario)) defaultPollCount += 1;
  return job;
}

function withRetrying(job: GetSyncJobResponse, platforms: readonly PlatformSyncTask['platform'][]): GetSyncJobResponse {
  return {
    ...job,
    status: 'RETRYING',
    platformTasks: job.platformTasks.map((task) => (
      platforms.includes(task.platform) ? { ...task, status: 'RETRYING', error: null } : task
    )),
  };
}

function withResolved(job: GetSyncJobResponse, platforms: readonly PlatformSyncTask['platform'][]): GetSyncJobResponse {
  const platformTasks = job.platformTasks.map((task) => (
    platforms.includes(task.platform) ? { ...task, status: 'SUCCESS' as const, attemptCount: task.attemptCount + 1, error: null } : task
  ));
  const allSuccess = platformTasks.every((task) => task.status === 'SUCCESS');
  return { ...job, status: allSuccess ? 'SUCCESS' : 'PARTIAL_SUCCESS', platformTasks };
}

// A job-level retry moves the eligible platforms to RETRYING for one poll, then resolves
// them to SUCCESS - simulating "partial→retrying→success" through stateful MSW responses
// rather than direct UI result injection.
function scenarioJob(): GetSyncJobResponse {
  const scenario = getMockScenario();
  const base = baseScenarioJob(scenario);
  if (recoveryScenario === scenario) {
    const eligible = eligibleRetryTasks(base.platformTasks).map((task) => task.platform);
    const stages = [withRetrying(base, eligible), withResolved(base, eligible)];
    const job = stages[Math.min(recoveryPollCount, stages.length - 1)] ?? stages[stages.length - 1];
    recoveryPollCount += 1;
    return job ?? base;
  }
  return base;
}

export const syncJobHandlers = [
  http.get('*/api/v1/sync-jobs/:syncJobId', async () => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const job = scenarioJob();
    // The status-query request itself succeeded even when platform tasks failed; the
    // top-level API status stays SUCCESS and the domain outcome lives in `data.status`
    // (API Contract §1 "외부 플랫폼 일부가 실패해도... 최상위 status=SUCCESS").
    return HttpResponse.json(successEnvelope(job, 'SUCCESS'), responseOptions());
  }),
  http.post('*/api/v1/sync-jobs/:syncJobId/retry', async () => {
    if (getMockScenario() === 'network-error') return HttpResponse.error();
    await mockDelay(scenarioLatency());
    const scenario = getMockScenario();
    // Progressing (pending→processing→success) scenarios never contain a FAILED task, so
    // check eligibility without calling baseScenarioJob and mutating its poll counter.
    const base = PROGRESSING_SCENARIOS.has(scenario) ? successSyncJobFixture : baseScenarioJob(scenario);
    const eligible = eligibleRetryTasks(base.platformTasks);
    if (eligible.length === 0) {
      return HttpResponse.json(errorEnvelope(noRetryableTasksErrorFixture), { status: 409, ...responseOptions() });
    }
    recoveryScenario = scenario;
    recoveryPollCount = 0;
    const retryingPlatforms = eligible.map((task) => task.platform);
    return HttpResponse.json(
      successEnvelope(
        { syncJobId: SYNC_JOB_ID, status: 'RETRYING' as const, retryingPlatforms, statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}` },
        'PROCESSING',
      ),
      { status: 202, ...responseOptions() },
    );
  }),
];

export function resetSyncJobHandlerState(): void {
  defaultPollCount = 0;
  recoveryScenario = null;
  recoveryPollCount = 0;
}
