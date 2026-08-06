import { useEffect, useState } from 'react';
import { ApiClientError } from '@/services/api';
import { retryStartedMessage, SYNC_COPY, SYNC_STATUS_TITLES } from '@/content/syncMessages';
import {
  getSyncJobSnapshot,
  isRetryEligible,
  isTerminalSyncStatus,
  retrySyncJob,
} from '@/services/syncJobs';
import type { ApiErrorBody } from '@/services/api.types';
import type { Platform, PlatformTaskStatus, SyncJob } from '@/types/domain';
import googleLogo from '@/assets/platforms/google.svg';
import naverLogo from '@/assets/platforms/naver.svg';
import kakaoLogo from '@/assets/platforms/kakao.svg';
import './SyncStatus.css';

const platformLabels: Record<Platform, string> = {
  google: 'Google', naver: 'Naver', kakao: 'Kakao',
};

const accessiblePlatformLabels: Record<Platform, string> = {
  google: 'Google', naver: 'Naver', kakao: 'Kakao',
};

const displayPlatformLabels: Record<Platform, string> = {
  google: '구글', naver: '네이버', kakao: '카카오',
};

export type PlatformResultStatus = 'SUCCESS' | 'FAIL' | 'PENDING' | 'PROCESSING' | 'RETRYING';
export interface PlatformResult {
  id: Platform;
  name: string;
  status: PlatformResultStatus;
  errorMessage?: string;
}

function toPlatformResults(job: SyncJob | null, warning: ApiErrorBody | null = null): PlatformResult[] {
  if (!job) return [];
  return (Object.entries(job.platforms) as Array<[Platform, PlatformTaskStatus]>).map(([id, status]) => ({
    id,
    name: displayPlatformLabels[id],
    status: status === 'FAILED' ? 'FAIL' : status,
    ...(status === 'FAILED' ? { errorMessage: warning?.code === 'API_TIMEOUT' ? '접속 시간 초과' : warning?.code === 'PERMISSION_DENIED' ? '권한 확인 필요' : '플랫폼 연결에 실패했습니다.' } : {}),
  }));
}

const platformLogos: Record<Platform, string> = {
  google: googleLogo,
  naver: naverLogo,
  kakao: kakaoLogo,
};

const statusIcons: Record<PlatformTaskStatus, string> = {
  PENDING: '○',
  PROCESSING: '◌',
  RETRYING: '↻',
  SUCCESS: '✓',
  FAILED: '!',
};

const statusLabels: Record<PlatformTaskStatus, string> = {
  PENDING: '대기 중',
  PROCESSING: '반영 중',
  RETRYING: '재시도 중',
  SUCCESS: '반영 완료',
  FAILED: '반영 실패',
};

export interface SyncStatusDashboardProps {
  syncJobId: string;
  initialJob?: SyncJob;
  resultOverride?: PlatformResult[] | null;
  autoPoll?: boolean;
  pollIntervalMs?: number;
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
  if (error instanceof ApiClientError && error.status === 0) {
    return SYNC_COPY.networkError;
  }
  return SYNC_COPY.pollingError;
}

export function SyncStatusDashboard({
  syncJobId,
  initialJob,
  resultOverride = null,
  autoPoll = true,
  pollIntervalMs = 500,
}: SyncStatusDashboardProps) {
  const [job, setJob] = useState<SyncJob | null>(initialJob ?? null);
  const [warning, setWarning] = useState<ApiErrorBody | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [isRetrying, setRetrying] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [platformResults, setPlatformResults] = useState<PlatformResult[]>(() => toPlatformResults(initialJob ?? null));

  useEffect(() => {
    if (!autoPoll) return;
    const controller = new AbortController();

    const poll = async () => {
      try {
        for (;;) {
          const snapshot = await getSyncJobSnapshot(syncJobId, controller.signal);
          setJob(snapshot.job);
          setWarning(snapshot.warning);
          setPlatformResults(toPlatformResults(snapshot.job, snapshot.warning));
          setErrorMessage(null);
          if (isTerminalSyncStatus(snapshot.job.status)) return;
          await delay(pollIntervalMs, controller.signal);
        }
      } catch (error: unknown) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setErrorMessage(safePollingError(error));
      }
    };

    void poll();
    return () => controller.abort();
  }, [autoPoll, pollIntervalMs, refreshToken, syncJobId]);

  const retry = async () => {
    if (isRetrying) return;
    setRetrying(true);
    setErrorMessage(null);
    try {
      const result = await retrySyncJob(syncJobId);
      const labels = result.retryingPlatforms.map((platform) => platformLabels[platform]).join(', ');
      setRetryMessage(retryStartedMessage(labels.split(', ')));
      setRefreshToken((current) => current + 1);
    } catch (error: unknown) {
      setErrorMessage(safePollingError(error));
    } finally {
      setRetrying(false);
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

  const renderedResults = resultOverride ?? platformResults;
  const progress = renderedResults.filter(({ status }) => status === 'SUCCESS').length;
  const isTerminal = isTerminalSyncStatus(job.status);
  const isAllSuccess = renderedResults.length > 0 && renderedResults.every(({ status }) => status === 'SUCCESS');
  const hasFailure = renderedResults.some(({ status }) => status === 'FAIL');
  const canRetry = resultOverride !== null ? hasFailure : isRetryEligible(warning?.code, warning?.retryable);
  const firstFailedPlatform = renderedResults.find(({ status }) => status === 'FAIL')?.id;
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
        <span>{progress} / {job.summary.total}개 플랫폼 완료</span>
        <progress aria-label="동기화 진행률" max={job.summary.total} value={progress} />
      </label> : <progress className="sr-only" aria-label="동기화 진행률" max={job.summary.total} value={progress} />}

      <ul className="sync-status__platforms">
        {renderedResults.map((result) => {
          const domainStatus: PlatformTaskStatus = result.status === 'FAIL' ? 'FAILED' : result.status;
          return (
          <li key={result.id} aria-label={`${accessiblePlatformLabels[result.id]} ${statusLabels[domainStatus]}`}>
            <img className="sync-status__brand-logo" src={platformLogos[result.id]} alt={`${accessiblePlatformLabels[result.id]} 로고`} />
            <div className="sync-status__platform-copy"><strong>{result.name}</strong><span>{result.status === 'SUCCESS' ? '업데이트 완료' : result.status === 'FAIL' ? result.errorMessage : statusLabels[domainStatus]}</span></div>
            <span className="sr-only">{statusLabels[domainStatus]}</span>
            {result.status === 'SUCCESS' ? <span className="sync-status__success-check" aria-hidden="true">✓</span> : null}
            {result.status === 'FAIL' ? <div className="sync-status__failure-action"><strong>실패&nbsp; !</strong>{canRetry ? <button type="button" aria-label={result.id === firstFailedPlatform ? '실패한 플랫폼 다시 시도' : `${result.name} 재시도`} onClick={() => void retry()} disabled={isRetrying} style={{ minHeight: 56 }}>{isRetrying ? '재시도 중…' : '↻ 재시도'}</button> : null}</div> : null}
            {!['SUCCESS', 'FAIL'].includes(result.status) ? <span className={`sync-status__platform-icon sync-status__platform-icon--${domainStatus.toLowerCase()}`} aria-hidden="true">{statusIcons[domainStatus]}</span> : null}
          </li>
        );})}
      </ul>

      {job.status === 'PARTIAL_SUCCESS' ? (
        <p className="sync-status__explanation">{SYNC_COPY.partialSuccess}</p>
      ) : null}
      {warning ? <p className="sync-status__warning">{warning.message}</p> : null}
      {errorMessage ? <p role="alert">{errorMessage}</p> : null}
      {retryMessage ? <p role="status">{retryMessage}</p> : null}
      {canRetry && !hasFailure ? (
        <button type="button" onClick={() => void retry()} disabled={isRetrying} style={{ minHeight: 56 }}>
          {isRetrying ? SYNC_COPY.retryingAction : SYNC_COPY.retryAction}
        </button>
      ) : null}
    </section>
  );
}

export const SyncStatus = SyncStatusDashboard;
