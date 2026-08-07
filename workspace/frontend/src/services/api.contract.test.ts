import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { apiRequest, apiRequestParsed, ApiClientError } from '@/services/api';
import { apiEnvelopeSchema, platformTaskErrorSchema, apiErrorSchema } from '@/services/contracts/common';
import {
  createStoreChangeResponseSchema,
  storeChangeApprovalResponseSchema,
  proposalChangeSchema,
} from '@/services/contracts/storeChange';
import {
  createSeoGenerationRequestSchema,
  createSeoGenerationResponseSchema,
  approveSeoGenerationResponseSchema,
} from '@/services/contracts/seo';
import { getSyncJobResponseSchema, retrySyncJobResponseSchema, platformSyncTaskSchema } from '@/services/contracts/syncJob';

const timestamp = '2026-08-05T00:00:00Z';

describe('v0.2 API contract: documented success examples parse', () => {
  test('UC1 create response (API Contract §4)', () => {
    const result = createStoreChangeResponseSchema.safeParse({
      proposalId: '22222222-2222-4222-8222-222222222222',
      recognizedTextMasked: '영업시간을 오후 8시까지로 바꿔줘',
      changes: [
        {
          field: 'businessHours',
          currentValue: { open: '09:00', close: '22:00' },
          proposedValue: { open: '09:00', close: '20:00' },
        },
      ],
      status: 'DRAFT',
    });
    expect(result.success).toBe(true);
  });

  test('UC1 approve response (API Contract §4)', () => {
    const result = storeChangeApprovalResponseSchema.safeParse({
      proposalId: '22222222-2222-4222-8222-222222222222',
      proposalStatus: 'APPROVED',
      syncJobId: '66666666-6666-4666-8666-666666666666',
      status: 'PENDING',
      statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
    });
    expect(result.success).toBe(true);
  });

  test('temporaryClosure and representativeMenuName changes (API Contract §4 "허용 변경 값")', () => {
    expect(
      proposalChangeSchema.safeParse({
        field: 'temporaryClosure',
        currentValue: null,
        proposedValue: { startDate: '2026-08-15', endDate: '2026-08-17' },
      }).success,
    ).toBe(true);
    expect(
      proposalChangeSchema.safeParse({
        field: 'representativeMenuName',
        currentValue: '아메리카노',
        proposedValue: '수제 바닐라라테',
      }).success,
    ).toBe(true);
  });

  test('UC2 create/regenerate response with exactly google, naver, kakao (API Contract §5)', () => {
    const result = createSeoGenerationResponseSchema.safeParse({
      generationId: '33333333-3333-4333-8333-333333333333',
      status: 'DRAFT',
      revision: 1,
      drafts: [
        {
          draftId: '44444444-4444-4444-8444-444444444441',
          platform: 'google',
          draftText: 'Google용 매장 소개글',
          keywords: ['만두전골', '가족외식'],
          contentRules: ['team-defined-google-rule'],
        },
        {
          draftId: '44444444-4444-4444-8444-444444444442',
          platform: 'naver',
          draftText: 'Naver용 매장 소개글',
          keywords: ['만두전골 맛집', '주차편한곳'],
          contentRules: ['team-defined-naver-rule'],
        },
        {
          draftId: '44444444-4444-4444-8444-444444444443',
          platform: 'kakao',
          draftText: 'Kakao용 매장 소개글',
          keywords: ['가족외식', '만두전골'],
          contentRules: ['team-defined-kakao-rule'],
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('UC2 approve response (API Contract §5)', () => {
    const result = approveSeoGenerationResponseSchema.safeParse({
      generationId: '33333333-3333-4333-8333-333333333333',
      generationStatus: 'APPROVED',
      approvedPlatforms: ['google', 'naver', 'kakao'],
      syncJobId: '66666666-6666-4666-8666-666666666666',
      status: 'PENDING',
      statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
    });
    expect(result.success).toBe(true);
  });

  test('SyncJob GET response with a task-local error (API Contract §6)', () => {
    const result = getSyncJobResponseSchema.safeParse({
      syncJobId: '66666666-6666-4666-8666-666666666666',
      status: 'PARTIAL_SUCCESS',
      platformTasks: [
        { platform: 'google', status: 'SUCCESS', attemptCount: 1, error: null },
        {
          platform: 'naver',
          status: 'FAILED',
          attemptCount: 2,
          error: {
            code: 'API_TIMEOUT',
            message: 'Naver 플랫폼 처리 시간이 초과되었습니다.',
            retryable: true,
            platform: 'naver',
          },
        },
        { platform: 'kakao', status: 'SUCCESS', attemptCount: 1, error: null },
      ],
    });
    expect(result.success).toBe(true);
  });

  test('SyncJob retry response (API Contract §6)', () => {
    const result = retrySyncJobResponseSchema.safeParse({
      syncJobId: '66666666-6666-4666-8666-666666666666',
      status: 'RETRYING',
      retryingPlatforms: ['naver'],
      statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
    });
    expect(result.success).toBe(true);
  });
});

describe('v0.2 API contract: rejects malformed boundaries', () => {
  test('rejects unknown envelope keys', () => {
    const schema = apiEnvelopeSchema(getSyncJobResponseSchema);
    const result = schema.safeParse({
      success: true,
      status: 'SUCCESS',
      data: { syncJobId: '66666666-6666-4666-8666-666666666666', status: 'SUCCESS', platformTasks: [] },
      error: null,
      timestamp,
      unexpectedField: 'should not be allowed',
    });
    expect(result.success).toBe(false);
  });

  test('rejects PARTIAL_SUCCESS at the top-level envelope status even though it is a valid SyncJob domain status', () => {
    const schema = apiEnvelopeSchema(getSyncJobResponseSchema);
    const result = schema.safeParse({
      success: true,
      status: 'PARTIAL_SUCCESS',
      data: { syncJobId: '66666666-6666-4666-8666-666666666666', status: 'PARTIAL_SUCCESS', platformTasks: [] },
      error: null,
      timestamp,
    });
    expect(result.success).toBe(false);
  });

  test('rejects an invalid UUID', () => {
    const result = createStoreChangeResponseSchema.safeParse({
      proposalId: 'not-a-uuid',
      recognizedTextMasked: '영업시간을 오후 8시까지로 바꿔줘',
      changes: [],
      status: 'DRAFT',
    });
    expect(result.success).toBe(false);
  });

  test('rejects an invalid timestamp', () => {
    const schema = apiEnvelopeSchema(getSyncJobResponseSchema);
    const result = schema.safeParse({
      success: true,
      status: 'SUCCESS',
      data: { syncJobId: '66666666-6666-4666-8666-666666666666', status: 'SUCCESS', platformTasks: [] },
      error: null,
      timestamp: '2026-08-05',
    });
    expect(result.success).toBe(false);
  });

  test('rejects a malformed structured Proposal value (missing close, unknown field name)', () => {
    expect(
      proposalChangeSchema.safeParse({
        field: 'businessHours',
        currentValue: { open: '09:00' },
        proposedValue: { open: '09:00', close: '20:00' },
      }).success,
    ).toBe(false);
    expect(
      proposalChangeSchema.safeParse({
        field: 'unsupportedField',
        currentValue: null,
        proposedValue: null,
      }).success,
    ).toBe(false);
    expect(
      proposalChangeSchema.safeParse({
        field: 'temporaryClosure',
        currentValue: null,
        proposedValue: { startDate: '2026-08-17', endDate: '2026-08-15' },
      }).success,
    ).toBe(false);
  });

  test('rejects a missing Generation revision or seedKeywords', () => {
    expect(
      createSeoGenerationResponseSchema.safeParse({
        generationId: '33333333-3333-4333-8333-333333333333',
        status: 'DRAFT',
        drafts: [],
      }).success,
    ).toBe(false);
    expect(
      createSeoGenerationRequestSchema.safeParse({
        storeProfileId: '11111111-1111-4111-8111-111111111111',
        briefText: '만두전골의 깊은 국물 맛',
      }).success,
    ).toBe(false);
  });

  test('rejects duplicate and missing platform coverage in Generation drafts', () => {
    const base = {
      draftText: '문구',
      keywords: ['만두전골'],
      contentRules: [],
    };
    const missingKakao = createSeoGenerationResponseSchema.safeParse({
      generationId: '33333333-3333-4333-8333-333333333333',
      status: 'DRAFT',
      revision: 1,
      drafts: [
        { draftId: '44444444-4444-4444-8444-444444444441', platform: 'google', ...base },
        { draftId: '44444444-4444-4444-8444-444444444442', platform: 'naver', ...base },
      ],
    });
    expect(missingKakao.success).toBe(false);

    const duplicateGoogle = createSeoGenerationResponseSchema.safeParse({
      generationId: '33333333-3333-4333-8333-333333333333',
      status: 'DRAFT',
      revision: 1,
      drafts: [
        { draftId: '44444444-4444-4444-8444-444444444441', platform: 'google', ...base },
        { draftId: '44444444-4444-4444-8444-444444444442', platform: 'google', ...base },
        { draftId: '44444444-4444-4444-8444-444444444443', platform: 'kakao', ...base },
      ],
    });
    expect(duplicateGoogle.success).toBe(false);
  });

  test('rejects an out-of-range attemptCount', () => {
    expect(
      platformSyncTaskSchema.safeParse({ platform: 'google', status: 'FAILED', attemptCount: 4, error: null }).success,
    ).toBe(false);
    expect(
      platformSyncTaskSchema.safeParse({ platform: 'google', status: 'FAILED', attemptCount: -1, error: null }).success,
    ).toBe(false);
  });

  test('rejects a misplaced task error: a common API error code cannot satisfy a platform-task error, and vice versa', () => {
    expect(
      platformTaskErrorSchema.safeParse({
        code: 'VALIDATION_ERROR',
        message: '검증 실패',
        retryable: false,
        platform: 'naver',
      }).success,
    ).toBe(false);
    expect(
      apiErrorSchema.safeParse({
        code: 'API_TIMEOUT',
        message: '시간 초과',
      }).success,
    ).toBe(false);
    expect(
      getSyncJobResponseSchema.safeParse({
        syncJobId: '66666666-6666-4666-8666-666666666666',
        status: 'FAILED',
        platformTasks: [
          {
            platform: 'naver',
            status: 'FAILED',
            attemptCount: 1,
            error: { code: 'VALIDATION_ERROR', message: '검증 실패', retryable: false, platform: 'naver' },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('apiRequestParsed: strict boundary over the wire', () => {
  test('parses a documented success response and preserves the X-Request-ID', async () => {
    server.use(
      http.get('/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666', () =>
        HttpResponse.json(
          {
            success: true,
            status: 'SUCCESS',
            data: {
              syncJobId: '66666666-6666-4666-8666-666666666666',
              status: 'SUCCESS',
              platformTasks: [
                { platform: 'google', status: 'SUCCESS', attemptCount: 1, error: null },
                { platform: 'naver', status: 'SUCCESS', attemptCount: 1, error: null },
                { platform: 'kakao', status: 'SUCCESS', attemptCount: 1, error: null },
              ],
            },
            error: null,
            timestamp,
          },
          { headers: { 'X-Request-ID': 'req-sync-get' } },
        ),
      ),
    );

    const result = await apiRequestParsed(
      '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
      getSyncJobResponseSchema,
    );
    expect(result.requestId).toBe('req-sync-get');
    expect(result.data.status).toBe('SUCCESS');
    expect(result.data.platformTasks).toHaveLength(3);
  });

  test('throws a safe ApiClientError on a malformed response and never leaks the raw payload', async () => {
    server.use(
      http.get('/api/v1/sync-jobs/77777777-7777-4777-8777-777777777777', () =>
        HttpResponse.json(
          {
            success: true,
            status: 'SUCCESS',
            data: {
              syncJobId: '77777777-7777-4777-8777-777777777777',
              status: 'PARTIAL_SUCCESS',
              platformTasks: [
                {
                  platform: 'naver',
                  status: 'FAILED',
                  attemptCount: 1,
                  error: { code: 'VALIDATION_ERROR', message: 'top secret internal detail 010-1234-5678', retryable: false, platform: 'naver' },
                },
              ],
            },
            error: null,
            timestamp,
          },
          { status: 200 },
        ),
      ),
    );

    let caught: unknown;
    try {
      await apiRequestParsed(
        '/api/v1/sync-jobs/77777777-7777-4777-8777-777777777777',
        getSyncJobResponseSchema,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ApiClientError);
    const apiError = caught as ApiClientError;
    expect(apiError.status).toBe(200);
    expect(apiError.message).not.toContain('top secret');
    expect(apiError.message).not.toContain('010-1234-5678');
    expect(JSON.stringify(apiError)).not.toContain('010-1234-5678');
  });

  test('the legacy unchecked apiRequest path lets malformed data through, which apiRequestParsed now closes', async () => {
    server.use(
      http.get('/api/v1/sync-jobs/88888888-8888-4888-8888-888888888888', () =>
        HttpResponse.json({
          success: true,
          status: 'PARTIAL_SUCCESS',
          data: { syncJobId: '88888888-8888-4888-8888-888888888888', status: 'PARTIAL_SUCCESS' },
          error: null,
          timestamp,
        }),
      ),
    );

    const legacy = await apiRequest<{ syncJobId: string; status: string }>(
      '/api/v1/sync-jobs/88888888-8888-4888-8888-888888888888',
    );
    expect(legacy.status).toBe('PARTIAL_SUCCESS');

    await expect(
      apiRequestParsed(
        '/api/v1/sync-jobs/88888888-8888-4888-8888-888888888888',
        getSyncJobResponseSchema,
      ),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
