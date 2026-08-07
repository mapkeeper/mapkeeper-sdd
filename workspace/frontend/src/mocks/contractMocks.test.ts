import { ApiClientError, apiRequest } from '@/services/api';
import type { ApproveSeoGenerationResponse, ContentGenerationData } from '@/services/contracts/seo';
import type { StoreChangeApprovalResponse, StoreChangeProposalData } from '@/services/contracts/storeChange';
import type { GetSyncJobResponse, RetrySyncJobResponse } from '@/services/contracts/syncJob';
import { MOCK_TIMESTAMP } from '@/mocks/factories/envelopeFactory';
import { STORE_CHANGE_PROPOSAL_ID } from '@/mocks/fixtures/storeChangeFixtures';
import { SYNC_JOB_ID } from '@/mocks/fixtures/syncJobFixtures';
import { setMockScenario } from '@/mocks/scenarios';

describe('API contract mocks', () => {
  test('UC1 create/patch/approve payload and idempotency replay', async () => {
    const created = await apiRequest<StoreChangeProposalData>('/api/v1/store-change-proposals', {
      method: 'POST', body: { storeProfileId: 'store-123', recognizedText: '영업시간 10시까지로 바꿔줘', locale: 'ko-KR' },
    });
    expect(created.data).toMatchObject({ proposalId: STORE_CHANGE_PROPOSAL_ID, status: 'DRAFT', recognizedTextMasked: '영업시간 ***까지로 바꿔줘' });
    expect(created.timestamp).toBe(MOCK_TIMESTAMP);
    expect(created.requestId).toMatch(/^req-/);

    const patched = await apiRequest<StoreChangeProposalData>(`/api/v1/store-change-proposals/${STORE_CHANGE_PROPOSAL_ID}`, {
      method: 'PATCH',
      body: { changes: [{ field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '20:00' } }] },
    });
    expect(patched.data.changes[0]?.proposedValue).toEqual({ open: '09:00', close: '20:00' });

    const options = { method: 'POST', headers: { 'Idempotency-Key': 'approval-key-001' } } as const;
    const first = await apiRequest<StoreChangeApprovalResponse>(`/api/v1/store-change-proposals/${STORE_CHANGE_PROPOSAL_ID}/approve`, options);
    const replay = await apiRequest<StoreChangeApprovalResponse>(`/api/v1/store-change-proposals/${STORE_CHANGE_PROPOSAL_ID}/approve`, options);
    expect(replay.data).toEqual(first.data);
    expect(first.status).toBe('PROCESSING');
  });

  test('UC2 returns one draft per platform and approves the whole Generation with an empty body', async () => {
    const generated = await apiRequest<ContentGenerationData>('/api/v1/seo/generations', {
      method: 'POST',
      body: {
        storeProfileId: '11111111-1111-4111-8111-111111111111',
        briefText: '만두전골의 깊은 국물 맛을 강조하고 싶어요.',
        seedKeywords: ['만두전골'],
      },
    });
    expect(generated.data.drafts.map(({ platform }) => platform)).toEqual(['google', 'naver', 'kakao']);
    expect(generated.data.status).toBe('DRAFT');
    expect(generated.data.revision).toBe(1);

    const approved = await apiRequest<ApproveSeoGenerationResponse>(`/api/v1/seo/generations/${generated.data.generationId}/approve`, {
      method: 'POST', headers: { 'Idempotency-Key': 'seo-key-001' },
    });
    expect(approved.data.statusUrl).toBe('/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666');
    expect(approved.data.approvedPlatforms).toEqual(['google', 'naver', 'kakao']);
  });

  test('validation error follows the common failed envelope', async () => {
    await expect(apiRequest<never>('/api/v1/store-change-proposals', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      causeBody: {
        code: 'VALIDATION_ERROR',
        message: '허용되지 않은 필드이거나 입력값을 확인할 수 없습니다.',
        details: [{ field: 'changes[0].field', reason: 'unsupported field' }],
      },
    } satisfies Partial<ApiClientError>);
  });

  test('UC1 mock 생성은 인식 불가능한 자유 문장도 빈 변경 목록의 DRAFT로 수용한다', async () => {
    const created = await apiRequest<StoreChangeProposalData>('/api/v1/store-change-proposals', {
      method: 'POST',
      body: { storeProfileId: 'store-123', recognizedText: '사장님 마음대로 예쁘게 정리해 주세요', locale: 'ko-KR' },
    });

    expect(created.data).toMatchObject({ proposalId: STORE_CHANGE_PROPOSAL_ID, status: 'DRAFT', changes: [] });
  });

  test('시간만 언급한 모호한 문장은 기본 영업시간 DRAFT를 반환한다', async () => {
    const created = await apiRequest<StoreChangeProposalData>('/api/v1/store-change-proposals', {
      method: 'POST',
      body: { storeProfileId: 'store-123', recognizedText: '영업 시간 정보를 정리해 줘', locale: 'ko-KR' },
    });

    expect(created.data.changes).toEqual([{
      field: 'businessHours',
      currentValue: { open: '09:00', close: '22:00' },
      proposedValue: { open: '09:00', close: '22:00' },
    }]);
  });

  test.each(['all-success', 'partial-success', 'retryable-failure', 'non-retryable-failure'] as const)('sync scenario %s returns contracted enums, task-level truth, and a top-level status separate from the domain status', async (scenario) => {
    setMockScenario(scenario);
    const result = await apiRequest<GetSyncJobResponse>(`/api/v1/sync-jobs/${SYNC_JOB_ID}`);
    expect(['SUCCESS', 'PROCESSING', 'FAILED']).toContain(result.status);
    expect(['PENDING', 'PROCESSING', 'PARTIAL_SUCCESS', 'SUCCESS', 'FAILED', 'RETRYING']).toContain(result.data.status);
    expect(result.data.platformTasks.map(({ platform }) => platform)).toEqual(['google', 'naver', 'kakao']);
    expect(result.data.platformTasks).toHaveLength(3);
  });

  test('retry preserves successful platform and returns eligible failed platform only', async () => {
    setMockScenario('partial-success');
    const before = await apiRequest<GetSyncJobResponse>(`/api/v1/sync-jobs/${SYNC_JOB_ID}`);
    expect(before.data.platformTasks.find((task) => task.platform === 'google')?.status).toBe('SUCCESS');
    const retried = await apiRequest<RetrySyncJobResponse>(`/api/v1/sync-jobs/${SYNC_JOB_ID}/retry`, { method: 'POST' });
    expect(retried.data).toEqual({ syncJobId: SYNC_JOB_ID, status: 'RETRYING', retryingPlatforms: ['naver'], statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}` });
  });

  test('재시도 가능한 실패가 없으면 409 NO_RETRYABLE_TASKS를 반환한다', async () => {
    setMockScenario('all-success');
    await expect(apiRequest<RetrySyncJobResponse>(`/api/v1/sync-jobs/${SYNC_JOB_ID}/retry`, { method: 'POST' })).rejects.toMatchObject({
      status: 409,
      causeBody: { code: 'NO_RETRYABLE_TASKS', message: '재시도 가능한 실패 플랫폼이 없습니다.' },
    } satisfies Partial<ApiClientError>);
  });
});
