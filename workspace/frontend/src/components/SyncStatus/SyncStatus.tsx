import { useEffect, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { retryStartedMessage, SYNC_COPY, SYNC_STATUS_TITLES } from '@/content/syncMessages';
import { eligibleRetryTasks, getSyncJob, isTerminalSyncStatus, retrySyncJob } from '@/services/syncJobs';
import type { Platform } from '@/services/contracts/common';
import type { GetSyncJobResponse, PlatformSyncTaskStatus } from '@/services/contracts/syncJob';
import googleLogo from '@/assets/platforms/google.svg';
import naverLogo from '@/assets/platforms/naver.svg';
import kakaoLogo from '@/assets/platforms/kakao.svg';
import './SyncStatus.css';

// Production polling constants (API Contract §7): 2s cadence, stop polling automatically
// after 60s of non-terminal status.
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 60_000;

const accessiblePlatformLabels: Record<Platform, string> = { google: 'Google', naver: 'Naver', kakao: 'Kakao' };
const displayPlatformLabels: Record<Platform, string> = { google: '구글', naver: '네이버', kakao: '카카오' };

const platformLogos: Record<Platform, string> = {
  google: googleLogo,
  naver: naverLogo,
  kakao: kakaoLogo,
};

const statusIcons: Record<PlatformSyncTaskStatus, string> = {
  PENDING: '○',
  PROCESSING: '◌',
  RETRYING: '↻',
  SUCCESS: '✓',
  FAILED: '!',
};

const statusLabels: Record<PlatformSyncTaskStatus, string> = {
  PENDING: '대기 중',
  PROCESSING: '반영 중',
  RETRYING: '재시도 중',
  SUCCESS: '반영 완료',
  FAILED: '반영 실패',
};

export interface SyncStatusDashboardProps {
  syncJobId: string;
  initialJob?: GetSyncJobResponse;
  autoPoll?: boolean;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener('abort', () => {
      window.clearTimeout(timer);
      reject(new DOMException('Polling aborted', 'AbortError'));
    }, { once: true });
  });
}

function safePollingError(error: unknown): string {
  if (error instanceof ApiClientError && error.status === 0) return SYNC_COPY.networkError;
  return SYNC_COPY.pollingError;
}

export function SyncStatusDashboard({ syncJobId, initialJob, autoPoll = true }: SyncStatusDashboardProps) {
  const [job, setJob] = useState<GetSyncJobResponse | null>(initialJob ?? null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [isRetrying, setRetrying] = useState(false);
  const [isRechecking, setRechecking] = useState(false);
  const [delayed, setDelayed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  // Single polling implementation: aborts on unmount, on a newer syncJobId/refresh
  // superseding it, and stops (without retrying) on a network error. It never restarts
  // itself once delayed - only the one-shot recheck button issues another GET.
  useEffect(() => {
    if (!autoPoll) return;
    const controller = new AbortController();

    const poll = async () => {
      setDelayed(false);
      let elapsed = 0;
      try {
        for (;;) {
          const result = await getSyncJob(syncJobId, controller.signal);
          setJob(result.data);
          setErrorMessage(null);
          if (isTerminalSyncStatus(result.data.status)) return;
          if (elapsed >= POLL_TIMEOUT_MS) {
            setDelayed(true);
            return;
          }
          await delay(POLL_INTERVAL_MS, controller.signal);
          elapsed += POLL_INTERVAL_MS;
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setErrorMessage(safePollingError(error));
      }
    };

    void poll();
    return () => controller.abort();
  }, [autoPoll, refreshToken, syncJobId]);

  const retry = async () => {
    if (isRetrying) return;
    setRetrying(true);
    setErrorMessage(null);
    try {
      const result = await retrySyncJob(syncJobId);
      const labels = result.data.retryingPlatforms.map((platform) => accessiblePlatformLabels[platform]);
      setRetryMessage(retryStartedMessage(labels));
      setDelayed(false);
      setRefreshToken((current) => current + 1);
    } catch (error: unknown) {
      setErrorMessage(safePollingError(error));
    } finally {
      setRetrying(false);
    }
  };

  // One immediate GET only; if the job is still non-terminal it remains delayed instead
  // of silently resuming the 2s loop (API Contract §7 "다시 확인 버튼").
  const recheck = async () => {
    if (isRechecking) return;
    setRechecking(true);
    setErrorMessage(null);
    try {
      const result = await getSyncJob(syncJobId);
      setJob(result.data);
      if (isTerminalSyncStatus(result.data.status)) setDelayed(false);
    } catch (error: unknown) {
      setErrorMessage(safePollingError(error));
    } finally {
      setRechecking(false);
    }
  };

  if (!job) {
    return (
      <section className="sync-status" aria-label="플랫폼 동기화 현황">
        <h2>동기화 상태 확인 중</h2>
        {errorMessage ? <p role="alert">{errorMessage}</p> : <p role="status">잠시만 기다려 주세요.</p>}
      </section>
    );
  }

  const isTerminal = isTerminalSyncStatus(job.status);
  const succeededCount = job.platformTasks.filter((task) => task.status === 'SUCCESS').length;
  const eligibleTasks = eligibleRetryTasks(job.platformTasks);
  const canRetry = eligibleTasks.length > 0;
  const isAllSuccess = job.status === 'SUCCESS';
  const hasFailure = job.platformTasks.some((task) => task.status === 'FAILED');
  const mainTitle = isAllSuccess
    ? '3사에 반영되었습니다!'
    : hasFailure ? '일부 플랫폼 반영에 실패했어요' : '플랫폼에 반영하고 있어요';
  const mainDescription = isAllSuccess
    ? '모든 플랫폼 업데이트가 완료되었습니다.'
    : hasFailure ? '실패한 플랫폼은 아래에서 재시도할 수 있습니다.' : '잠시만 기다려 주세요.';

  return (
    <section className="sync-status" aria-label="플랫폼 동기화 현황" data-reduced-motion-safe="true">
      <header className={`sync-status__hero ${isAllSuccess ? 'sync-status__hero--success' : hasFailure ? 'sync-status__hero--failure' : 'sync-status__hero--working'}`}>
        <span className="sync-status__overall-icon" aria-hidden="true">
          {isAllSuccess ? '✓' : hasFailure ? '!' : '↻'}
        </span>
        <h1>{mainTitle}</h1>
        <p>{mainDescription}</p>
        <h2 className="sr-only">{SYNC_STATUS_TITLES[job.status]}</h2>
      </header>

      {!isTerminal ? <label className="sync-status__progress">
        <span>{succeededCount} / {job.platformTasks.length}개 플랫폼 완료</span>
        <progress aria-label="동기화 진행률" max={job.platformTasks.length} value={succeededCount} />
      </label> : <progress className="sr-only" aria-label="동기화 진행률" max={job.platformTasks.length} value={succeededCount} />}

      <ul className="sync-status__platforms">
        {job.platformTasks.map((task) => (
          <li key={task.platform} aria-label={`${accessiblePlatformLabels[task.platform]} ${statusLabels[task.status]}`}>
            <img className="sync-status__brand-logo" src={platformLogos[task.platform]} alt={`${accessiblePlatformLabels[task.platform]} 로고`} />
            <div className="sync-status__platform-copy">
              <strong>{displayPlatformLabels[task.platform]}</strong>
              <span>{task.status === 'SUCCESS' ? '업데이트 완료' : task.status === 'FAILED' ? (task.error?.message ?? '반영에 실패했습니다.') : statusLabels[task.status]}</span>
            </div>
            <span className="sr-only">{statusLabels[task.status]}</span>
            {task.status === 'SUCCESS' ? <span className="sync-status__success-check" aria-hidden="true">✓</span> : null}
            {task.status === 'FAILED' ? (
              <div className="sync-status__failure-action">
                <strong>실패&nbsp; !</strong>
                <span className="sync-status__attempt-count">{task.attemptCount}/3회 시도</span>
              </div>
            ) : null}
            {!['SUCCESS', 'FAILED'].includes(task.status) ? <span className={`sync-status__platform-icon sync-status__platform-icon--${task.status.toLowerCase()}`} aria-hidden="true">{statusIcons[task.status]}</span> : null}
          </li>
        ))}
      </ul>

      {job.status === 'PARTIAL_SUCCESS' ? (
        <p className="sync-status__explanation">{SYNC_COPY.partialSuccess}</p>
      ) : null}
      {delayed ? (
        <div className="sync-status__delayed" role="status">
          <p>{SYNC_COPY.delayedNotice}</p>
          <button type="button" onClick={() => void recheck()} disabled={isRechecking} style={{ minHeight: 56 }}>
            {isRechecking ? SYNC_COPY.recheckingAction : SYNC_COPY.recheckAction}
          </button>
        </div>
      ) : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {retryMessage ? <p role="status">{retryMessage}</p> : null}
      {canRetry ? (
        <button type="button" onClick={() => void retry()} disabled={isRetrying} style={{ minHeight: 56 }}>
          {isRetrying ? SYNC_COPY.retryingAction : SYNC_COPY.retryAction}
        </button>
      ) : null}
    </section>
  );
}

export const SyncStatus = SyncStatusDashboard;
