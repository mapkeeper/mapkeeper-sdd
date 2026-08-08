import { createServer } from 'node:http';

// A real TCP node:http server implementing just enough of the v0.2 contract (API
// Contract §4-6) to prove `apiRequestParsed` works over the wire with MSW disabled
// (Todo 6). Not a reimplementation of the MSW mock - callers pick a `scenario` to drive
// one failure mode per test.
export type ContractStubScenario =
  | 'default'
  | 'disconnect-on-approve'
  | 'malformed-status-response'
  | 'non-json-status-response'
  | 'create-validation-error'
  | 'retry-no-retryable-tasks'
  | 'slow';

export interface StubRequestLogEntry {
  method: string;
  path: string;
}

export interface ContractStub {
  url: string;
  requestLog: StubRequestLogEntry[];
  close(): Promise<void>;
}

const TIMESTAMP = '2026-08-07T00:00:00Z';
const PROPOSAL_ID = '22222222-2222-4222-8222-222222222222';
const GENERATION_ID = '33333333-3333-4333-8333-333333333333';
const SYNC_JOB_ID = '66666666-6666-4666-8666-666666666666';

let requestSequence = 0;
function nextRequestId(): string {
  requestSequence += 1;
  return `req-transport-${String(requestSequence).padStart(3, '0')}`;
}

function envelope(status: 'SUCCESS' | 'PROCESSING' | 'FAILED', data: unknown, error: unknown = null) {
  return { success: error === null, status, data, error, timestamp: TIMESTAMP };
}

const DRAFT_IDS = {
  google: '44444444-4444-4444-8444-444444444441',
  naver: '44444444-4444-4444-8444-444444444442',
  kakao: '44444444-4444-4444-8444-444444444443',
} as const;

function draft(platform: 'google' | 'naver' | 'kakao') {
  return {
    draftId: DRAFT_IDS[platform],
    platform,
    draftText: `${platform} 매장 소개글`,
    keywords: ['만두전골'],
    contentRules: [`team-defined-${platform}-rule`],
  };
}

interface StubGeneration {
  generationId: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  revision: number;
  drafts: ReturnType<typeof draft>[];
}

function buildGeneration(revision: number): StubGeneration {
  return {
    generationId: GENERATION_ID,
    status: 'DRAFT',
    revision,
    drafts: [draft('google'), draft('naver'), draft('kakao')],
  };
}

async function readJsonBody(req: import('node:http').IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function startContractStub(scenario: ContractStubScenario = 'default', port = 0): Promise<ContractStub> {
  const requestLog: StubRequestLogEntry[] = [];
  let proposalStatus: 'DRAFT' | 'APPROVED' = 'DRAFT';
  let generation = buildGeneration(1);

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    requestLog.push({ method: req.method ?? '', path: url.pathname });
    await readJsonBody(req);

    if (scenario === 'slow') await new Promise((resolve) => setTimeout(resolve, 500));

    const send = (status: number, payload: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'X-Request-ID': nextRequestId() });
      res.end(JSON.stringify(payload));
    };

    if (req.method === 'POST' && url.pathname === '/api/v1/store-change-proposals') {
      if (scenario === 'create-validation-error') {
        return send(422, envelope('FAILED', null, { code: 'VALIDATION_ERROR', message: '입력값을 확인해 주세요.' }));
      }
      proposalStatus = 'DRAFT';
      return send(201, envelope('SUCCESS', {
        proposalId: PROPOSAL_ID,
        recognizedTextMasked: '영업시간 ***까지로 바꿔줘',
        changes: [{ field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '20:00' } }],
        status: proposalStatus,
      }));
    }

    if (req.method === 'POST' && url.pathname === `/api/v1/store-change-proposals/${PROPOSAL_ID}/approve`) {
      if (scenario === 'disconnect-on-approve') {
        req.socket.destroy();
        return;
      }
      if (!req.headers['idempotency-key']) {
        return send(422, envelope('FAILED', null, { code: 'VALIDATION_ERROR', message: 'Idempotency-Key가 필요합니다.' }));
      }
      proposalStatus = 'APPROVED';
      return send(202, envelope('PROCESSING', {
        proposalId: PROPOSAL_ID,
        proposalStatus: 'APPROVED',
        syncJobId: SYNC_JOB_ID,
        status: 'PENDING',
        statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}`,
      }));
    }

    if (req.method === 'POST' && url.pathname === '/api/v1/seo/generations') {
      generation = buildGeneration(1);
      return send(201, envelope('SUCCESS', generation));
    }

    if (req.method === 'POST' && url.pathname === `/api/v1/seo/generations/${GENERATION_ID}/regenerate`) {
      generation = buildGeneration(generation.revision + 1);
      return send(200, envelope('SUCCESS', generation));
    }

    if (req.method === 'POST' && url.pathname === `/api/v1/seo/generations/${GENERATION_ID}/reject`) {
      generation = { ...generation, status: 'REJECTED' };
      return send(200, envelope('SUCCESS', generation));
    }

    if (req.method === 'POST' && url.pathname === `/api/v1/seo/generations/${GENERATION_ID}/approve`) {
      if (!req.headers['idempotency-key']) {
        return send(422, envelope('FAILED', null, { code: 'VALIDATION_ERROR', message: 'Idempotency-Key가 필요합니다.' }));
      }
      generation = { ...generation, status: 'APPROVED' };
      return send(202, envelope('PROCESSING', {
        generationId: GENERATION_ID,
        generationStatus: 'APPROVED',
        approvedPlatforms: ['google', 'naver', 'kakao'],
        syncJobId: SYNC_JOB_ID,
        status: 'PENDING',
        statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}`,
      }));
    }

    if (req.method === 'GET' && url.pathname === `/api/v1/sync-jobs/${SYNC_JOB_ID}`) {
      if (scenario === 'non-json-status-response') {
        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('not json');
        return;
      }
      if (scenario === 'malformed-status-response') {
        // Missing `platformTasks`, which `getSyncJobResponseSchema` requires.
        return send(200, envelope('SUCCESS', { syncJobId: SYNC_JOB_ID, status: 'PARTIAL_SUCCESS' }));
      }
      return send(200, envelope('SUCCESS', {
        syncJobId: SYNC_JOB_ID,
        status: 'PARTIAL_SUCCESS',
        platformTasks: [
          { platform: 'google', status: 'SUCCESS', attemptCount: 1, error: null },
          { platform: 'naver', status: 'FAILED', attemptCount: 1, error: { code: 'API_TIMEOUT', message: '시간 초과', retryable: true, platform: 'naver' } },
          { platform: 'kakao', status: 'SUCCESS', attemptCount: 1, error: null },
        ],
      }));
    }

    if (req.method === 'POST' && url.pathname === `/api/v1/sync-jobs/${SYNC_JOB_ID}/retry`) {
      if (scenario === 'retry-no-retryable-tasks') {
        return send(409, envelope('FAILED', null, { code: 'NO_RETRYABLE_TASKS', message: '재시도 가능한 실패 플랫폼이 없습니다.' }));
      }
      return send(202, envelope('PROCESSING', {
        syncJobId: SYNC_JOB_ID,
        status: 'RETRYING',
        retryingPlatforms: ['naver'],
        statusUrl: `/api/v1/sync-jobs/${SYNC_JOB_ID}`,
      }));
    }

    send(404, envelope('FAILED', null, { code: 'RESOURCE_NOT_FOUND', message: '리소스를 찾을 수 없습니다.' }));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requestLog,
        close: () => new Promise((res) => server.close(() => res())),
      });
    });
  });
}

export const CONTRACT_STUB_IDS = { PROPOSAL_ID, GENERATION_ID, SYNC_JOB_ID };
