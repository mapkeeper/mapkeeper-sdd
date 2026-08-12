import { ApiClientError, apiRequest } from '@/services/api';
import type { CreateSeoGenerationResponse, CreateStoreChangeResponse, GetSyncJobResponse, RetrySyncJobResponse, SeoApprovalResponse, StoreChangeApprovalResponse } from '@/services/api.types';
import { MOCK_TIMESTAMP } from '@/mocks/factories/envelopeFactory';
import { setMockScenario } from '@/mocks/scenarios';

describe('API contract mocks', () => {
  test('UC1 create/patch/approve payload and idempotency replay', async () => {
    const created = await apiRequest<CreateStoreChangeResponse>('/api/v1/store-change-proposals', {
      method: 'POST', body: { storeProfileId: 'store-123', recognizedText: '영업시간 10시까지로 바꿔줘', locale: 'ko-KR' },
    });
    expect(created.data).toMatchObject({ proposalId: 'prop-001', status: 'DRAFT', recognizedTextMasked: '영업시간 ***까지로 바꿔줘' });
    expect(created.timestamp).toBe(MOCK_TIMESTAMP);
    expect(created.requestId).toMatch(/^req-/);

    const patched = await apiRequest<CreateStoreChangeResponse>('/api/v1/store-change-proposals/prop-001', {
      method: 'PATCH', body: { changes: [{ field: 'businessHours', currentValue: '09:00-22:00', proposedValue: '09:00-20:00' }] },
    });
    expect(patched.data.changes[0]?.proposedValue).toBe('09:00-20:00');

    const options = { method: 'POST', headers: { 'Idempotency-Key': 'approval-key-001' } } as const;
    const first = await apiRequest<StoreChangeApprovalResponse>('/api/v1/store-change-proposals/prop-001/approve', options);
    const replay = await apiRequest<StoreChangeApprovalResponse>('/api/v1/store-change-proposals/prop-001/approve', options);
    expect(replay.data).toEqual(first.data);
    expect(first.status).toBe('PROCESSING');
  });

  test('UC2 returns one draft per platform and approves the whole generation', async () => {
    const generated = await apiRequest<CreateSeoGenerationResponse>('/api/v1/seo/generations', {
      method: 'POST', body: { storeProfileId: 'store-123', briefText: '따뜻한 동네 맛집', seedKeywords: ['친절함'], sourceReviewIds: ['review-001'] },
    });
    expect(generated.data.drafts.map(({ platform }) => platform)).toEqual(['google', 'naver', 'kakao']);
    const approved = await apiRequest<SeoApprovalResponse>('/api/v1/seo/generations/gen-001/approve', {
      method: 'POST', headers: { 'Idempotency-Key': 'seo-key-001' },
    });
    expect(approved.data.statusUrl).toBe('/api/v1/sync-jobs/job-001');
    expect(approved.data.approvedPlatforms).toEqual(['google', 'naver', 'kakao']);
  });

  test('validation error follows the common failed envelope', async () => {
    await expect(apiRequest<never>('/api/v1/store-change-proposals', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 422,
      causeBody: { code: 'VALIDATION_ERROR', message: '허용되지 않은 필드입니다.', details: [{ field: 'changes[0].field', reason: 'unsupported field' }] },
    } satisfies Partial<ApiClientError>);
  });

  test('UC1 mock 생성은 인식 불가능한 자유 문장도 빈 변경 목록의 DRAFT로 수용한다', async () => {
    const created = await apiRequest<CreateStoreChangeResponse>('/api/v1/store-change-proposals', {
      method: 'POST',
      body: { storeProfileId: 'store-123', recognizedText: '사장님 마음대로 예쁘게 정리해 주세요', locale: 'ko-KR' },
    });

    expect(created.data).toMatchObject({ proposalId: 'prop-001', status: 'DRAFT', changes: [] });
  });

  test('시간만 언급한 모호한 문장은 기본 영업시간 DRAFT를 반환한다', async () => {
    const created = await apiRequest<CreateStoreChangeResponse>('/api/v1/store-change-proposals', {
      method: 'POST',
      body: { storeProfileId: 'store-123', recognizedText: '영업 시간 정보를 정리해 줘', locale: 'ko-KR' },
    });

    expect(created.data.changes).toEqual([{
      field: 'businessHours',
      currentValue: '09:00-22:00',
      proposedValue: '09:00-22:00',
    }]);
  });

  test.each(['all-success', 'partial-success', 'retryable-failure', 'non-retryable-failure'] as const)('sync scenario %s returns contracted platform tasks', async (scenario) => {
    setMockScenario(scenario);
    const result = await apiRequest<GetSyncJobResponse>('/api/v1/sync-jobs/job-001');
    expect(['PENDING', 'PROCESSING', 'PARTIAL_SUCCESS', 'SUCCESS', 'FAILED', 'RETRYING']).toContain(result.data.status);
    expect(result.data.platformTasks.map(({ platform }) => platform)).toEqual(['google', 'naver', 'kakao']);
    expect(result.data.platformTasks).toHaveLength(3);
  });

  test('retry preserves successful platform and returns eligible failed platform only', async () => {
    setMockScenario('partial-success');
    const before = await apiRequest<GetSyncJobResponse>('/api/v1/sync-jobs/job-001');
    expect(before.data.platformTasks.find(({ platform }) => platform === 'google')?.status).toBe('SUCCESS');
    const retried = await apiRequest<RetrySyncJobResponse>('/api/v1/sync-jobs/job-001/retry', { method: 'POST' });
    expect(retried.data).toEqual({ syncJobId: 'job-001', retryingPlatforms: ['naver'] });
  });
});
