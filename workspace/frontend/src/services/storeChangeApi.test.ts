import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import {
  approveStoreChangeProposal,
  createStoreChangeProposal,
  patchStoreChangeProposal,
  rejectStoreChangeProposal,
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
                {
                  field: 'businessHours',
                  currentValue: { open: '09:00', close: '21:00' },
                  proposedValue: { open: '09:00', close: '22:00' },
                },
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

  test('수정 요청은 화면 문자열을 백엔드의 필드별 구조화 값으로 변환한다', async () => {
    const changes = [
      { field: 'businessHours' as const, currentValue: '09:00-21:00', proposedValue: '09:00-22:00' },
      { field: 'temporaryClosure' as const, currentValue: '영업', proposedValue: '2026-08-06 휴무' },
      { field: 'representativeMenuName' as const, currentValue: '비빔밥', proposedValue: '돌솥비빔밥' },
    ];
    server.use(
      http.patch('/api/v1/store-change-proposals/prop-001', async ({ request }) => {
        expect(await request.json()).toEqual({
          changes: [
            {
              field: 'businessHours',
              currentValue: { open: '09:00', close: '21:00' },
              proposedValue: { open: '09:00', close: '22:00' },
            },
            {
              field: 'temporaryClosure',
              currentValue: null,
              proposedValue: { startDate: '2026-08-06', endDate: '2026-08-06' },
            },
            {
              field: 'representativeMenuName',
              currentValue: '비빔밥',
              proposedValue: '돌솥비빔밥',
            },
          ],
        });
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            proposalId: 'prop-001',
            recognizedTextMasked: '수정된 변경안',
            changes: [
              {
                field: 'businessHours',
                currentValue: { open: '09:00', close: '21:00' },
                proposedValue: { open: '09:00', close: '22:00' },
              },
              {
                field: 'temporaryClosure',
                currentValue: null,
                proposedValue: { startDate: '2026-08-06', endDate: '2026-08-06' },
              },
              {
                field: 'representativeMenuName',
                currentValue: '비빔밥',
                proposedValue: '돌솥비빔밥',
              },
            ],
            status: 'DRAFT',
          },
          error: null,
          timestamp,
        });
      }),
    );

    await expect(patchStoreChangeProposal('prop-001', changes)).resolves.toMatchObject({
      data: {
        proposalId: 'prop-001',
        changes: [
          changes[0],
          { field: 'temporaryClosure', currentValue: '설정 없음', proposedValue: '2026-08-06 ~ 2026-08-06' },
          changes[2],
        ],
        status: 'DRAFT',
      },
    });
  });

  test('거절은 body 없이 명시적 reject endpoint를 호출한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals/prop-001/reject', async ({ request }) => {
        expect(await request.text()).toBe('');
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            proposalId: 'prop-001',
            recognizedTextMasked: '영업시간 변경 요청',
            changes: [{
              field: 'businessHours',
              currentValue: { open: '09:00', close: '21:00' },
              proposedValue: { open: '09:00', close: '22:00' },
            }],
            status: 'REJECTED',
          },
          error: null,
          timestamp,
        });
      }),
    );

    const result = await rejectStoreChangeProposal('prop-001');

    expect(result.data.status).toBe('REJECTED');
  });

  test('백엔드의 영업시간·임시 휴무 객체를 화면용 문자열로 변환한다', async () => {
    server.use(
      http.post('/api/v1/store-change-proposals', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          proposalId: 'prop-002',
          recognizedTextMasked: '내일 문 닫아',
          changes: [{
            field: 'temporaryClosure',
            currentValue: null,
            proposedValue: { startDate: '2026-08-17', endDate: '2026-08-17' },
          }],
          status: 'DRAFT',
        },
        error: null,
        timestamp,
      })),
    );

    const result = await createStoreChangeProposal({
      storeProfileId: 'store-123',
      recognizedText: '내일 문 닫아',
      locale: 'ko-KR',
    });

    expect(result.data.changes).toEqual([{
      field: 'temporaryClosure',
      currentValue: '설정 없음',
      proposedValue: '2026-08-17 ~ 2026-08-17',
    }]);
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
              proposalStatus: 'APPROVED',
              syncJobId: 'job-001',
              status: 'PENDING',
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
