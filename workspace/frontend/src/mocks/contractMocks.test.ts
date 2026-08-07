import { ApiClientError, apiRequestParsed } from '@/services/api';
import { handlers } from '@/mocks/handlers';
import {
  approveSeoGenerationResponseSchema,
  createSeoGenerationResponseSchema,
} from '@/services/contracts/seo';
import {
  createStoreChangeResponseSchema,
  patchStoreChangeResponseSchema,
  storeChangeApprovalResponseSchema,
} from '@/services/contracts/storeChange';
import { getSyncJobResponseSchema, retrySyncJobResponseSchema } from '@/services/contracts/syncJob';
import { MOCK_TIMESTAMP } from '@/mocks/factories/envelopeFactory';
import { STORE_CHANGE_PROPOSAL_ID } from '@/mocks/fixtures/storeChangeFixtures';
import { STORE_PROFILE_ID } from '@/mocks/fixtures/storeFixtures';
import { SYNC_JOB_ID } from '@/mocks/fixtures/syncJobFixtures';
import { setMockScenario } from '@/mocks/scenarios';

// The ten endpoints named in API Contract §8 "엔드포인트 요약" - no more, no less.
const EXPECTED_ENDPOINTS: readonly { method: string; path: string }[] = [
  { method: 'POST', path: '/api/v1/store-change-proposals' },
  { method: 'PATCH', path: '/api/v1/store-change-proposals/:proposalId' },
  { method: 'POST', path: '/api/v1/store-change-proposals/:proposalId/reject' },
  { method: 'POST', path: '/api/v1/store-change-proposals/:proposalId/approve' },
  { method: 'POST', path: '/api/v1/seo/generations' },
  { method: 'POST', path: '/api/v1/seo/generations/:generationId/regenerate' },
  { method: 'POST', path: '/api/v1/seo/generations/:generationId/reject' },
  { method: 'POST', path: '/api/v1/seo/generations/:generationId/approve' },
  { method: 'GET', path: '/api/v1/sync-jobs/:syncJobId' },
  { method: 'POST', path: '/api/v1/sync-jobs/:syncJobId/retry' },
];

function normalizedEndpoint(handler: (typeof handlers)[number]): { method: string; path: string } {
  return { method: String(handler.info.method).toUpperCase(), path: handler.info.path.toString().replace(/^\*/, '') };
}

function sortKey(endpoint: { method: string; path: string }): string {
  return `${endpoint.method} ${endpoint.path}`;
}

describe('contract inventory: exactly the ten v0.2 endpoints', () => {
  test('handlers register exactly the documented method/path pairs, no more and no less', () => {
    expect(handlers).toHaveLength(EXPECTED_ENDPOINTS.length);
    const actual = handlers.map(normalizedEndpoint).sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    const expected = [...EXPECTED_ENDPOINTS].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    expect(actual).toEqual(expected);
  });
});

describe('API contract mocks', () => {
  test('UC1 create/patch/approve payload and idempotency replay', async () => {
    const created = await apiRequestParsed('/api/v1/store-change-proposals', createStoreChangeResponseSchema, {
      method: 'POST', body: { storeProfileId: STORE_PROFILE_ID, recognizedText: '영업시간 10시까지로 바꿔줘', locale: 'ko-KR' },
    });
    expect(created.data).toMatchObject({ proposalId: STORE_CHANGE_PROPOSAL_ID, status: 'DRAFT', recognizedTextMasked: '영업시간 ***까지로 바꿔줘' });
    expect(created.timestamp).toBe(MOCK_TIMESTAMP);
    expect(created.requestId).toMatch(/^req-/);

    const patched = await apiRequestParsed(
      `/api/v1/store-change-proposals/${STORE_CHANGE_PROPOSAL_ID}`,
      patchStoreChangeResponseSchema,
      {
        method: 'PATCH',
        body: { changes: [{ field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '20:00' } }] },
      },
    );
    expect(patched.data.changes[0]).toMatchObject({ proposedValue: { open: '09:00', close: '20:00' } });

    const options = { method: 'POST', headers: { 'Idempotency-Key': 'approval-key-001' } } as const;
    const first = await apiRequestParsed(`/api/v1/store-change-proposals/${STORE_CHANGE_PROPOSAL_ID}/approve`, storeChangeApprovalResponseSchema, options);
    const replay = await apiRequestParsed(`/api/v1/store-change-proposals/${STORE_CHANGE_PROPOSAL_ID}/approve`, storeChangeApprovalResponseSchema, options);
    expect(replay.data).toEqual(first.data);
    expect(first.status).toBe('PROCESSING');
  });

  test('UC2 returns one draft per platform and approves the whole Generation with an empty body', async () => {
    const generated = await apiRequestParsed('/api/v1/seo/generations', createSeoGenerationResponseSchema, {
      method: 'POST',
      body: {
        storeProfileId: STORE_PROFILE_ID,
        briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
        seedKeywords: ['만두전골'],
      },
    });
    expect(generated.data.drafts.map(({ platform }) => platform)).toEqual(['google', 'naver', 'kakao']);
    expect(generated.data.status).toBe('DRAFT');
    expect(generated.data.revision).toBe(1);

    const approved = await apiRequestParsed(
      `/api/v1/seo/generations/${generated.data.generationId}/approve`,
      approveSeoGenerationResponseSchema,
      { method: 'POST', headers: { 'Idempotency-Key': 'seo-key-001' } },
    );
    expect(approved.data.statusUrl).toBe('/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666');
    expect(approved.data.approvedPlatforms).toEqual(['google', 'naver', 'kakao']);
  });

  test('validation error follows the common failed envelope', async () => {
    await expect(
      apiRequestParsed('/api/v1/store-change-proposals', createStoreChangeResponseSchema, { method: 'POST', body: {} }),
    ).rejects.toMatchObject({
      status: 422,
      causeBody: {
        code: 'VALIDATION_ERROR',
        message: '허용되지 않은 필드이거나 입력값을 확인할 수 없습니다.',
        details: [{ field: 'changes[0].field', reason: 'unsupported field' }],
      },
    } satisfies Partial<ApiClientError>);
  });

  test('생성 요청에 계약에 없는 필드를 추가하면 422로 거절한다', async () => {
    await expect(
      apiRequestParsed('/api/v1/store-change-proposals', createStoreChangeResponseSchema, {
        method: 'POST',
        body: { storeProfileId: STORE_PROFILE_ID, recognizedText: '영업시간 변경', locale: 'ko-KR', unexpectedField: 'nope' },
      }),
    ).rejects.toMatchObject({ status: 422 } satisfies Partial<ApiClientError>);
  });

  test('UC1 mock 생성은 인식 불가능한 자유 문장도 빈 변경 목록의 DRAFT로 수용한다', async () => {
    const created = await apiRequestParsed('/api/v1/store-change-proposals', createStoreChangeResponseSchema, {
      method: 'POST',
      body: { storeProfileId: STORE_PROFILE_ID, recognizedText: '사장님 마음대로 예쁘게 정리해 주세요', locale: 'ko-KR' },
    });

    expect(created.data).toMatchObject({ proposalId: STORE_CHANGE_PROPOSAL_ID, status: 'DRAFT', changes: [] });
  });

  test('시간만 언급한 모호한 문장은 기본 영업시간 DRAFT를 반환한다', async () => {
    const created = await apiRequestParsed('/api/v1/store-change-proposals', createStoreChangeResponseSchema, {
      method: 'POST',
      body: { storeProfileId: STORE_PROFILE_ID, recognizedText: '영업 시간 정보를 정리해 줘', locale: 'ko-KR' },
    });

    expect(created.data.changes).toEqual([{
      field: 'businessHours',
      currentValue: { open: '09:00', close: '22:00' },
      proposedValue: { open: '09:00', close: '22:00' },
    }]);
  });

  test.each(['all-success', 'partial-success', 'retryable-failure', 'non-retryable-failure'] as const)('sync scenario %s returns contracted enums, task-level truth, and a top-level status separate from the domain status', async (scenario) => {
    setMockScenario(scenario);
    const result = await apiRequestParsed(`/api/v1/sync-jobs/${SYNC_JOB_ID}`, getSyncJobResponseSchema);
    expect(['SUCCESS', 'PROCESSING', 'FAILED']).toContain(result.status);
    expect(['PENDING', 'PROCESSING', 'PARTIAL_SUCCESS', 'SUCCESS', 'FAILED', 'RETRYING']).toContain(result.data.status);
    expect(result.data.platformTasks.map(({ platform }) => platform)).toEqual(['google', 'naver', 'kakao']);
    expect(result.data.platformTasks).toHaveLength(3);
  });

  test('retry preserves successful platform and returns eligible failed platform only', async () => {
    setMockScenario('partial-success');
    const before = await apiRequestParsed(`/api/v1/sync-jobs/${SYNC_JOB_ID}`, getSyncJobResponseSchema);
    expect(before.data.platformTasks.find((task) => task.platform === 'google')?.status).toBe('SUCCESS');
    const retried = await apiRequestParsed(`/api/v1/sync-jobs/${SYNC_JOB_ID}/retry`, retrySyncJobResponseSchema, { method: 'POST' });
    expect(retried.data).toEqual({ syncJobId: SYNC_JOB_ID, status: 'RETRYING', retryingPlatforms: ['naver'], statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}` });
  });

  test('재시도 가능한 실패가 없으면 409 NO_RETRYABLE_TASKS를 반환한다', async () => {
    setMockScenario('all-success');
    await expect(
      apiRequestParsed(`/api/v1/sync-jobs/${SYNC_JOB_ID}/retry`, retrySyncJobResponseSchema, { method: 'POST' }),
    ).rejects.toMatchObject({
      status: 409,
      causeBody: { code: 'NO_RETRYABLE_TASKS', message: '재시도 가능한 실패 플랫폼이 없습니다.' },
    } satisfies Partial<ApiClientError>);
  });
});
