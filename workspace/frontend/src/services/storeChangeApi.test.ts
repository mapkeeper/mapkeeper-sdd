import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import {
  approveStoreChangeProposal,
  createStoreChangeProposal,
  patchStoreChangeProposal,
  rejectStoreChangeProposal,
} from '@/services/storeChangeApi';
import { ApiClientError } from '@/services/api';

const timestamp = '2026-08-03T00:00:00Z';
const proposalId = '22222222-2222-4222-8222-222222222222';
const syncJobId = '66666666-6666-4666-8666-666666666666';

describe('storeChangeApi', () => {
  test('생성 요청은 storeProfileId, recognizedText, locale만 전송하고 request ID를 보존한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('application/json');
        expect(await request.json()).toEqual({
          storeProfileId: '11111111-1111-4111-8111-111111111111',
          recognizedText: '영업시간을 밤 10시까지로 바꿔줘',
          locale: 'ko-KR',
        });
        return HttpResponse.json(
          {
            success: true,
            status: 'SUCCESS',
            data: {
              proposalId,
              recognizedTextMasked: '영업시간을 밤 **시까지로 바꿔줘',
              changes: [
                { field: 'businessHours', currentValue: { open: '09:00', close: '21:00' }, proposedValue: { open: '09:00', close: '22:00' } },
              ],
              status: 'DRAFT',
            },
            error: null,
            timestamp,
          },
          { status: 201, headers: { 'X-Request-ID': 'req-create' } },
        );
      }),
    );

    const result = await createStoreChangeProposal({
      storeProfileId: '11111111-1111-4111-8111-111111111111',
      recognizedText: '영업시간을 밤 10시까지로 바꿔줘',
      locale: 'ko-KR',
    });
    expect(result.requestId).toBe('req-create');
    expect(result.data.status).toBe('DRAFT');
    expect(result.data.changes[0]).toMatchObject({ proposedValue: { open: '09:00', close: '22:00' } });
  });

  test('구조가 계약과 다른 응답(문자열 changes 값)은 안전한 타입 오류로 차단한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          proposalId,
          recognizedTextMasked: '영업시간 변경',
          changes: [{ field: 'businessHours', currentValue: '09:00-21:00', proposedValue: '09:00-22:00' }],
          status: 'DRAFT',
        },
        error: null,
        timestamp,
      })),
    );

    await expect(createStoreChangeProposal({
      storeProfileId: '11111111-1111-4111-8111-111111111111',
      recognizedText: '영업시간 변경',
      locale: 'ko-KR',
    })).rejects.toThrow(ApiClientError);
  });

  test('수정 요청은 구조화된 변경 목록 전체를 PATCH body로 전송한다', async () => {
    const changes = [
      { field: 'businessHours' as const, currentValue: { open: '09:00', close: '21:00' }, proposedValue: { open: '09:00', close: '22:00' } },
      { field: 'temporaryClosure' as const, currentValue: null, proposedValue: { startDate: '2026-08-15', endDate: '2026-08-17' } },
      { field: 'representativeMenuName' as const, currentValue: '비빔밥', proposedValue: '돌솥비빔밥' },
    ];
    server.use(
      http.patch('/api/v1/store-change-proposals/:proposalId', async ({ params, request }) => {
        expect(params.proposalId).toBe(proposalId);
        expect(await request.json()).toEqual({ changes });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { proposalId, recognizedTextMasked: '영업시간 변경', changes, status: 'DRAFT' },
          error: null,
          timestamp,
        });
      }),
    );

    await expect(patchStoreChangeProposal(proposalId, { changes })).resolves.toMatchObject({
      data: { proposalId, changes, status: 'DRAFT' },
    });
  });

  test('거절은 빈 body로 명시적 reject endpoint를 호출하고 REJECTED 상태를 반환한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals/:proposalId/reject', async ({ params, request }) => {
        expect(params.proposalId).toBe(proposalId);
        expect(await request.text()).toBe('');
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { proposalId, recognizedTextMasked: '영업시간 변경', changes: [], status: 'REJECTED' },
          error: null,
          timestamp,
        });
      }),
    );

    await expect(rejectStoreChangeProposal(proposalId)).resolves.toMatchObject({ data: { status: 'REJECTED' } });
  });

  test('승인은 빈 body와 필수 Idempotency-Key로만 명시적 approve endpoint를 호출한다', async () => {
    server.use(
      http.post(`/api/v1/store-change-proposals/${proposalId}/approve`, async ({ request }) => {
        expect(request.headers.get('Idempotency-Key')).toBe('approval-key-001');
        expect(await request.text()).toBe('');
        return HttpResponse.json(
          {
            success: true,
            status: 'PROCESSING',
            data: {
              proposalId,
              proposalStatus: 'APPROVED',
              syncJobId,
              status: 'PENDING',
              statusUrl: `/api/v1/sync-jobs/${syncJobId}`,
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-approve' } },
        );
      }),
    );

    const result = await approveStoreChangeProposal(proposalId, 'approval-key-001');
    expect(result).toMatchObject({ status: 'PROCESSING', requestId: 'req-approve' });
    expect(result.data.syncJobId).toBe(syncJobId);
  });
});
