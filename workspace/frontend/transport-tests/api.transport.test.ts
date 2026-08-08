// Node-environment, MSW-disabled transport suite (Todo 6). This proves the actual
// service wrappers make real TCP requests against a `node:http` stub and that the same
// strict Zod schemas guard the wire response - not just MSW's in-process interception.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { approveSeoGeneration, createSeoGeneration, regenerateSeoGeneration, rejectSeoGeneration } from '@/services/seoApi';
import { approveStoreChangeProposal, createStoreChangeProposal } from '@/services/storeChangeApi';
import { getSyncJob, retrySyncJob } from '@/services/syncJobs';
import { ApiClientError, apiRequestParsed } from '@/services/api';
import { getSyncJobResponseSchema } from '@/services/contracts/syncJob';
import { CONTRACT_STUB_IDS, startContractStub, type ContractStub } from './contractStub';

const STORE_PROFILE_ID = '11111111-1111-4111-8111-111111111111';

let stub: ContractStub | undefined;

function useStub(scenario: Parameters<typeof startContractStub>[0] = 'default') {
  return startContractStub(scenario).then((started) => {
    stub = started;
    vi.stubEnv('VITE_API_MOCKING', 'false');
    vi.stubEnv('VITE_API_BASE_URL', started.url);
    return started;
  });
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await stub?.close();
  stub = undefined;
});

describe('mock-off transport: real TCP against a node:http contract stub', () => {
  test('UC1 create -> approve hands off a SyncJob, using only real fetch (no MSW, no local fallback)', async () => {
    const started = await useStub();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const created = await createStoreChangeProposal({ storeProfileId: STORE_PROFILE_ID, recognizedText: '영업시간을 오후 8시까지로 바꿔줘', locale: 'ko-KR' });
    expect(created.data.proposalId).toBe(CONTRACT_STUB_IDS.PROPOSAL_ID);

    const approved = await approveStoreChangeProposal(created.data.proposalId, 'transport-key-001');
    expect(approved.data.syncJobId).toBe(CONTRACT_STUB_IDS.SYNC_JOB_ID);
    expect(approved.data.statusUrl).toBe(`/api/v1/sync-jobs/${CONTRACT_STUB_IDS.SYNC_JOB_ID}`);

    expect(fetchSpy).toHaveBeenCalledWith(`${started.url}/api/v1/store-change-proposals`, expect.anything());
    expect(started.requestLog.map((entry) => entry.path)).toEqual([
      '/api/v1/store-change-proposals',
      `/api/v1/store-change-proposals/${CONTRACT_STUB_IDS.PROPOSAL_ID}/approve`,
    ]);
  });

  test('UC2 create -> regenerate -> reject (separately) -> approve hands off a SyncJob', async () => {
    await useStub();

    const created = await createSeoGeneration({ storeProfileId: STORE_PROFILE_ID, briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.', seedKeywords: ['만두전골'] });
    expect(created.data.drafts.map((d) => d.platform)).toEqual(['google', 'naver', 'kakao']);

    const regenerated = await regenerateSeoGeneration(created.data.generationId, { briefText: '주차가 편한 가족 외식 장소예요.', seedKeywords: ['주차편한곳'] });
    expect(regenerated.data.revision).toBe(2);

    const rejected = await rejectSeoGeneration(created.data.generationId);
    expect(rejected.data.status).toBe('REJECTED');

    const approved = await approveSeoGeneration(created.data.generationId, 'transport-key-002');
    expect(approved.data.approvedPlatforms).toEqual(['google', 'naver', 'kakao']);
    expect(approved.data.syncJobId).toBe(CONTRACT_STUB_IDS.SYNC_JOB_ID);
  });

  test('Sync status and retry are real TCP GET/POST requests', async () => {
    await useStub();
    const status = await getSyncJob(CONTRACT_STUB_IDS.SYNC_JOB_ID);
    expect(status.data.status).toBe('PARTIAL_SUCCESS');
    expect(status.data.platformTasks).toHaveLength(3);

    const retried = await retrySyncJob(CONTRACT_STUB_IDS.SYNC_JOB_ID);
    expect(retried.data.retryingPlatforms).toEqual(['naver']);
  });

  test('a non-JSON response body is a safe ApiClientError, not a crash', async () => {
    await useStub('non-json-status-response');
    await expect(apiRequestParsed(`/api/v1/sync-jobs/${CONTRACT_STUB_IDS.SYNC_JOB_ID}`, getSyncJobResponseSchema))
      .rejects.toBeInstanceOf(ApiClientError);
  });

  test('a malformed envelope (missing platformTasks) never reaches the caller as trusted data', async () => {
    await useStub('malformed-status-response');
    let caught: unknown;
    try {
      await getSyncJob(CONTRACT_STUB_IDS.SYNC_JOB_ID);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ApiClientError);
  });

  test('a 422 validation error surfaces the common error code over real HTTP', async () => {
    await useStub('create-validation-error');
    await expect(
      createStoreChangeProposal({ storeProfileId: STORE_PROFILE_ID, recognizedText: '영업시간 변경', locale: 'ko-KR' }),
    ).rejects.toMatchObject({
      status: 422,
      causeBody: { code: 'VALIDATION_ERROR', message: '입력값을 확인해 주세요.' },
    } satisfies Partial<ApiClientError>);
  });

  test('a 409 NO_RETRYABLE_TASKS surfaces over real HTTP', async () => {
    await useStub('retry-no-retryable-tasks');
    await expect(retrySyncJob(CONTRACT_STUB_IDS.SYNC_JOB_ID)).rejects.toMatchObject({
      status: 409,
      causeBody: { code: 'NO_RETRYABLE_TASKS', message: '재시도 가능한 실패 플랫폼이 없습니다.' },
    } satisfies Partial<ApiClientError>);
  });

  test('a disconnect right after the approval request is sent is a safe network-failure error (status 0), not a fabricated success', async () => {
    await useStub('disconnect-on-approve');
    const created = await createStoreChangeProposal({ storeProfileId: STORE_PROFILE_ID, recognizedText: '영업시간을 오후 8시까지로 바꿔줘', locale: 'ko-KR' });

    await expect(approveStoreChangeProposal(created.data.proposalId, 'transport-key-003')).rejects.toMatchObject({
      status: 0,
    } satisfies Partial<ApiClientError>);
  });

  test('a client-side timeout aborts the in-flight request instead of hanging', async () => {
    await useStub('slow');
    await expect(
      getSyncJob(CONTRACT_STUB_IDS.SYNC_JOB_ID, AbortSignal.timeout(20)),
    ).rejects.toThrow();
  });
});
