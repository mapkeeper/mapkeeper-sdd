import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import {
  approveStoreChangeProposal,
  createStoreChangeProposal,
  patchStoreChangeProposal,
} from '@/services/storeChangeApi';

const timestamp = '2026-08-03T00:00:00Z';

describe('storeChangeApi', () => {
  test('생성 요청은 storeProfileId, recognizedText, locale만 전송하고 request ID를 보존한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals', async ({ request }) => {
        expect(request.headers.get('content-type')).toContain('application/json');
        expect(await request.json()).toEqual({
          storeProfileId: 'store-123',
          recognizedText: '영업시간을 밤 10시까지로 바꿔줘',
          locale: 'ko-KR',
        });
        return HttpResponse.json(
          {
            success: true,
            status: 'SUCCESS',
            data: {
              proposalId: 'prop-001',
              recognizedTextMasked: '영업시간을 밤 **시까지로 바꿔줘',
              changes: [
                { field: 'businessHours', currentValue: '09:00-21:00', proposedValue: '09:00-22:00' },
              ],
              status: 'DRAFT',
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-create' } },
        );
      }),
    );

    const result = await createStoreChangeProposal({
      storeProfileId: 'store-123',
      recognizedText: '영업시간을 밤 10시까지로 바꿔줘',
      locale: 'ko-KR',
    });
    expect(result.requestId).toBe('req-create');
    expect(result.data.status).toBe('DRAFT');
  });

  test('수정 요청은 허용된 세 필드만 PATCH body로 전송한다', async () => {
    const changes = [
      { field: 'businessHours' as const, currentValue: '09:00-21:00', proposedValue: '09:00-22:00' },
      { field: 'temporaryClosure' as const, currentValue: '영업', proposedValue: '2026-08-06 휴무' },
      { field: 'representativeMenuName' as const, currentValue: '비빔밥', proposedValue: '돌솥비빔밥' },
    ];
    server.use(
      http.patch('/api/v1/store-change-proposals/prop-001', async ({ request }) => {
        expect(await request.json()).toEqual({ changes });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: { proposalId: 'prop-001', changes, status: 'DRAFT' },
          error: null,
          timestamp,
        });
      }),
    );

    await expect(patchStoreChangeProposal('prop-001', { changes })).resolves.toMatchObject({
      data: { proposalId: 'prop-001', changes, status: 'DRAFT' },
    });
  });

  test('승인은 빈 body와 필수 Idempotency-Key로만 명시적 approve endpoint를 호출한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals/prop-001/approve', async ({ request }) => {
        expect(request.headers.get('Idempotency-Key')).toBe('approval-key-001');
        expect(await request.text()).toBe('');
        return HttpResponse.json(
          {
            success: true,
            status: 'PROCESSING',
            data: {
              proposalId: 'prop-001',
              syncJobId: 'job-001',
              statusUrl: '/api/v1/sync-jobs/job-001',
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-approve' } },
        );
      }),
    );

    const result = await approveStoreChangeProposal('prop-001', 'approval-key-001');
    expect(result).toMatchObject({ status: 'PROCESSING', requestId: 'req-approve' });
  });
});
