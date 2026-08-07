import { act, fireEvent, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import {
  SYNC_JOB_ID,
  failedNonRetryableSyncJobFixture,
  failedRetryableSyncJobFixture,
  maxAttemptSyncJobFixture,
  partialSuccessSyncJobFixture,
  pendingSyncJobFixture,
  processingSyncJobFixture,
  retryingSyncJobFixture,
  successSyncJobFixture,
} from '@/mocks/fixtures/syncJobFixtures';
import { setMockScenario } from '@/mocks/scenarios';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import type { GetSyncJobResponse } from '@/services/contracts/syncJob';

const timestamp = '2026-08-05T00:00:00Z';

const localizedStatus = {
  PENDING: '대기 중',
  PROCESSING: '반영 중',
  RETRYING: '재시도 중',
  SUCCESS: '반영 완료',
  FAILED: '반영 실패',
} as const;

const platformNames = { google: 'Google', naver: 'Naver', kakao: 'Kakao' } as const;

function jobResponse(job: GetSyncJobResponse) {
  return HttpResponse.json({ success: true, status: 'SUCCESS', data: job, error: null, timestamp });
}

/** Advances fake timers and flushes the resulting promise microtasks (poll loop awaits). */
async function flush(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('SyncStatusDashboard: static rendering of every job state', () => {
  test.each([
    [pendingSyncJobFixture, '동기화 대기 중'],
    [processingSyncJobFixture, '플랫폼에 반영 중'],
    [retryingSyncJobFixture, '실패한 플랫폼 재시도 중'],
    [partialSuccessSyncJobFixture, '일부 플랫폼 반영 완료'],
    [successSyncJobFixture, '모든 플랫폼 반영 완료'],
    [failedRetryableSyncJobFixture, '플랫폼 반영 실패'],
  ] as const)('$job.status 상태와 task별 진행률을 표시한다', (job, label) => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={job} autoPoll={false} />);

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByLabelText('동기화 진행률')).toHaveAttribute('max', '3');
    for (const task of job.platformTasks) {
      expect(screen.getByRole('listitem', { name: new RegExp(platformNames[task.platform]) })).toHaveTextContent(localizedStatus[task.status]);
    }
  });

  test('실패한 task는 개별 오류 메시지와 시도 횟수를 표시한다', () => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={partialSuccessSyncJobFixture} autoPoll={false} />);

    expect(screen.getByText('Naver 플랫폼 처리 시간이 초과되었습니다.')).toBeInTheDocument();
    expect(screen.getByText('1/3회 시도')).toBeInTheDocument();
  });

  test('Google, Naver, Kakao를 식별할 수 있는 로컬 SVG 브랜드 로고를 표시한다', () => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={successSyncJobFixture} autoPoll={false} />);

    for (const platform of ['Google', 'Naver', 'Kakao']) {
      const logo = screen.getByRole('img', { name: `${platform} 로고` });
      expect(logo).toHaveAttribute('src', expect.stringMatching(/(?:\.svg$|^data:image\/svg\+xml)/));
    }
  });

  test('PARTIAL_SUCCESS만 보존 설명 문구를 보여준다', () => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={partialSuccessSyncJobFixture} autoPoll={false} />);
    expect(screen.getByText(/성공한 플랫폼은 그대로 유지/)).toBeInTheDocument();
  });
});

describe('SyncStatusDashboard: retry gating (never re-runs success/non-retryable/max-attempt tasks)', () => {
  test('재시도 가능한 실패가 있으면 단 하나의 job-level 재시도 버튼만 표시한다', () => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={partialSuccessSyncJobFixture} autoPoll={false} />);
    expect(screen.getAllByRole('button', { name: '실패한 플랫폼 다시 시도' })).toHaveLength(1);
  });

  test('재시도 불가 오류(PERMISSION_DENIED)에는 재시도 버튼을 표시하지 않는다', () => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={failedNonRetryableSyncJobFixture} autoPoll={false} />);
    expect(screen.getAllByText('플랫폼 권한을 확인해 주세요.')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });

  test('attemptCount가 3에 도달한 task는 서버가 retryable=true로 표시해도 재시도 버튼을 숨긴다', () => {
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} initialJob={maxAttemptSyncJobFixture} autoPoll={false} />);
    expect(screen.getByText('3/3회 시도')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });
});

describe('SyncStatusDashboard: polling cadence and termination (fake timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  test('정확히 2초 간격으로 폴링한다', async () => {
    setMockScenario('default');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);

    await flush(50); // first GET resolves (PENDING)
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await flush(1900); // well under the 2s mark
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await flush(150); // crosses the 2s mark
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  test('PENDING부터 SUCCESS까지 폴링하고 terminal 상태에서 완전히 멈춘다', async () => {
    setMockScenario('all-success');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);

    await flush(50); // PENDING
    await flush(2050); // PROCESSING
    await flush(2050); // SUCCESS - terminal, loop returns

    expect(screen.getByRole('heading', { name: '모든 플랫폼 반영 완료' })).toBeInTheDocument();
    const callsAtTerminal = fetchSpy.mock.calls.length;

    await flush(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(callsAtTerminal);
  });

  test('부분 성공에서 재시도를 누르면 RETRYING을 거쳐 SUCCESS로 해결된다', async () => {
    setMockScenario('partial-success');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    await flush(50);
    expect(screen.getByRole('heading', { name: '일부 플랫폼 반영 완료' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' }));
    await flush(50); // retry POST resolves, refreshToken bumps, new poll loop starts
    await flush(50); // first GET after retry: RETRYING
    expect(screen.getByText('Naver 재시도를 시작했습니다.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '실패한 플랫폼 재시도 중' })).toBeInTheDocument();

    await flush(2050); // next GET: resolved to SUCCESS
    expect(screen.getByRole('heading', { name: '모든 플랫폼 반영 완료' })).toBeInTheDocument();
  });

  test('60초가 지나면 지연 안내와 다시 확인 버튼을 보여주고, 그 이후 자동으로는 다시 폴링하지 않는다', async () => {
    let callCount = 0;
    server.use(http.get(`*/api/v1/sync-jobs/${SYNC_JOB_ID}`, async () => {
      callCount += 1;
      return jobResponse(processingSyncJobFixture);
    }));
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);

    await flush(60_100);
    expect(screen.getByText(/반영이 예상보다 오래 걸리고 있어요/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeInTheDocument();
    const callsAtDelay = callCount;

    await flush(10_000);
    expect(callCount).toBe(callsAtDelay);
  });

  test('다시 확인 버튼은 즉시 GET 1회만 수행하고, 여전히 진행 중이면 지연 상태를 유지한다', async () => {
    let callCount = 0;
    server.use(http.get(`*/api/v1/sync-jobs/${SYNC_JOB_ID}`, async () => {
      callCount += 1;
      return jobResponse(processingSyncJobFixture);
    }));
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    await flush(60_100);
    const callsAtDelay = callCount;

    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    await flush(50);

    expect(callCount).toBe(callsAtDelay + 1);
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeInTheDocument();
  });

  test('다시 확인이 terminal 상태를 받으면 지연 안내를 닫는다', async () => {
    let resolved = false;
    server.use(http.get(`*/api/v1/sync-jobs/${SYNC_JOB_ID}`, async () => jobResponse(resolved ? successSyncJobFixture : processingSyncJobFixture)));
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    await flush(60_100);
    expect(screen.getByRole('button', { name: '다시 확인' })).toBeInTheDocument();

    resolved = true;
    fireEvent.click(screen.getByRole('button', { name: '다시 확인' }));
    await flush(50);

    expect(screen.queryByRole('button', { name: '다시 확인' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '모든 플랫폼 반영 완료' })).toBeInTheDocument();
  });

  test('언마운트하면 폴링을 중단하고 이후 상태를 갱신하지 않는다', async () => {
    let callCount = 0;
    server.use(http.get(`*/api/v1/sync-jobs/${SYNC_JOB_ID}`, async () => {
      callCount += 1;
      return jobResponse(processingSyncJobFixture);
    }));
    const { unmount } = render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    await flush(50);
    expect(callCount).toBe(1);

    unmount();
    await flush(10_000);
    expect(callCount).toBe(1);
  });

  test('syncJobId가 바뀌면(supersession) 이전 폴링을 중단하고 새 작업을 폴링한다', async () => {
    const seen: string[] = [];
    server.use(http.get('*/api/v1/sync-jobs/:syncJobId', async ({ params }) => {
      seen.push(String(params.syncJobId));
      return jobResponse(processingSyncJobFixture);
    }));
    const otherJobId = '77777777-7777-4777-8777-777777777777';
    const { rerender } = render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    await flush(50);
    expect(seen).toEqual([SYNC_JOB_ID]);

    rerender(<SyncStatusDashboard syncJobId={otherJobId} />);
    await flush(50);
    expect(seen).toEqual([SYNC_JOB_ID, otherJobId]);

    // advancing further must not produce a poll under the old job id
    await flush(2050);
    expect(seen.filter((id) => id === SYNC_JOB_ID)).toHaveLength(1);
  });

  test('네트워크 오류는 폴링을 멈추고 무한 재시도하지 않는다', async () => {
    server.use(http.get(`*/api/v1/sync-jobs/${SYNC_JOB_ID}`, () => HttpResponse.error()));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);

    await flush(50);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('인터넷 연결을 확인해 주세요.');
    const callsAfterError = fetchSpy.mock.calls.length;

    await flush(10_000);
    expect(fetchSpy).toHaveBeenCalledTimes(callsAfterError);
  });

  test('권한 오류처럼 재시도할 수 없는 실패에는 재시도 버튼을 표시하지 않는다(폴링 경로)', async () => {
    setMockScenario('non-retryable-failure');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    await flush(50);

    expect(screen.getByRole('heading', { name: '플랫폼 반영 실패' })).toBeInTheDocument();
    expect(screen.getAllByText('플랫폼 권한을 확인해 주세요.')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });
});
