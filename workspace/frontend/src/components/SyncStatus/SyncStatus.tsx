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
import type { Platform, PlatformTaskStatus, ProposalChange, SyncJob } from '@/types/domain';
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
  retryable?: boolean;
  attemptCount?: number;
}

function toPlatformResults(job: SyncJob | null): PlatformResult[] {
  if (!job) return [];
  return (Object.entries(job.platformDetails) as Array<[Platform, SyncJob['platformDetails'][Platform]]>)
    .map(([id, detail]) => ({
      id,
      name: displayPlatformLabels[id],
      status: detail.status === 'FAILED' ? 'FAIL' : detail.status,
      attemptCount: detail.attemptCount,
      ...(detail.error ? {
        errorMessage: detail.error.message,
        retryable: isRetryEligible(detail.error.code, detail.error.retryable),
      } : {}),
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

function CheckCircle() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.6 2.6L16.5 9"/></svg>;
}

function AlertCircle() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>;
}

export interface SyncStatusDashboardProps {
  syncJobId: string;
  initialJob?: SyncJob;
  resultOverride?: PlatformResult[] | null;
  autoPoll?: boolean;
  pollIntervalMs?: number;
  viewMode?: 'store-change' | 'seo';
  storeChanges?: ProposalChange[];
  seoContent?: string;
  seoTags?: string[];
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
  viewMode = 'store-change',
  storeChanges = [],
  seoContent = '정성으로 준비한 대표 메뉴와 따뜻한 서비스를 만나보세요.',
  seoTags = ['맛있는메뉴', '친절함', '다시찾는집'],
}: SyncStatusDashboardProps) {
  const [job, setJob] = useState<SyncJob | null>(initialJob ?? null);
  const [warning, setWarning] = useState<ApiErrorBody | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryMessage, setRetryMessage] = useState<string | null>(null);
  const [isRetrying, setRetrying] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [platformResults, setPlatformResults] = useState<PlatformResult[]>(() => toPlatformResults(initialJob ?? null));
  const [selectedPlatform, setSelectedPlatform] = useState<Platform | null>(null);

  useEffect(() => {
    if (!autoPoll) return;
    const controller = new AbortController();

    const poll = async () => {
      try {
        for (;;) {
          const snapshot = await getSyncJobSnapshot(syncJobId, controller.signal);
          setJob(snapshot.job);
          setWarning(snapshot.warning);
          setPlatformResults(toPlatformResults(snapshot.job));
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
  const isAllFailed = renderedResults.length > 0 && renderedResults.every(({ status }) => status === 'FAIL');
  const hasFailure = renderedResults.some(({ status }) => status === 'FAIL');
  const canRetry = renderedResults.some((result) => result.status === 'FAIL' && (result.retryable ?? resultOverride !== null));
  const firstFailedPlatform = renderedResults.find((result) => result.status === 'FAIL' && (result.retryable ?? resultOverride !== null))?.id;
  const mainTitle = isAllSuccess
    ? '3사에 반영되었습니다!'
    : isAllFailed ? '플랫폼 반영에 실패했어요' : hasFailure ? '일부 플랫폼 반영에 실패했어요' : '플랫폼에 반영하고 있어요';
  const mainDescription = isAllSuccess
    ? '구글, 네이버, 카카오 3사 업데이트가 모두 완료되었습니다.'
    : canRetry ? '실패한 플랫폼은 아래에서 재시도할 수 있습니다.' : hasFailure ? '플랫폼 연결 설정을 확인해 주세요.' : '잠시만 기다려 주세요.';
  const selectedPlatformName = selectedPlatform ? displayPlatformLabels[selectedPlatform] : '';

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
          <li key={result.id} aria-label={`${accessiblePlatformLabels[result.id]} ${statusLabels[domainStatus]}`} className={result.status === 'SUCCESS' ? 'is-clickable' : ''} tabIndex={result.status === 'SUCCESS' ? 0 : undefined} onClick={() => {
            if (result.status === 'SUCCESS') setSelectedPlatform(result.id);
          }} onKeyDown={(event) => {
            if (result.status === 'SUCCESS' && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setSelectedPlatform(result.id); }
          }}>
            <img className="sync-status__brand-logo" src={platformLogos[result.id]} alt={`${accessiblePlatformLabels[result.id]} 로고`} />
            <div className="sync-status__platform-copy"><strong>{result.name}</strong><span>{result.status === 'SUCCESS' ? '업데이트 완료' : result.status === 'FAIL' ? result.errorMessage : statusLabels[domainStatus]}</span>{result.attemptCount !== undefined && result.attemptCount > 1 ? <small>시도 {result.attemptCount}/3회</small> : null}</div>
            <span className="sr-only">{statusLabels[domainStatus]}</span>
            {result.status === 'SUCCESS' ? <span className="sync-status__success-check"><CheckCircle /> 반영 완료</span> : null}
            {result.status === 'SUCCESS' ? <span className="sync-status__chevron" aria-hidden="true">›</span> : null}
            {result.status === 'FAIL' ? <div className="sync-status__failure-action"><strong><AlertCircle /> 실패</strong>{(result.retryable ?? resultOverride !== null) ? <button type="button" aria-label={result.id === firstFailedPlatform ? '실패한 플랫폼 다시 시도' : `${result.name} 재시도`} onClick={(event) => { event.stopPropagation(); void retry(); }} disabled={isRetrying} style={{ minHeight: 56 }}>{isRetrying ? '재시도 중…' : '↻ 재시도'}</button> : null}</div> : null}
            {!['SUCCESS', 'FAIL'].includes(result.status) ? <span className={`sync-status__platform-icon sync-status__platform-icon--${domainStatus.toLowerCase()}`} aria-hidden="true">{statusIcons[domainStatus]}</span> : null}
          </li>
        );})}
      </ul>

      {isAllSuccess ? <aside className="sync-status__guide">{viewMode === 'seo' ? '📣 AI 홍보 소식이 3사 지도에 동시에 소문났어요! 단골 손님들의 방문을 기대해 보세요.' : '🎉 성공적으로 업데이트되었어요! 이제 손님들이 수정된 정보를 지도에서 바로 확인할 수 있습니다.'}</aside> : null}

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

      {selectedPlatform ? <div className="sync-detail-modal" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedPlatform(null); }}>
        <section className="sync-detail-modal__sheet" role="dialog" aria-modal="true" aria-labelledby="sync-detail-title">
          <div className="sync-detail-modal__handle" aria-hidden="true" />
          <header><div><span>{selectedPlatformName} 반영 내역</span><h2 id="sync-detail-title">정상적으로 등록되었어요</h2></div><button type="button" aria-label="반영 내역 닫기" onClick={() => setSelectedPlatform(null)}>×</button></header>
          {viewMode === 'seo' ? <div className="sync-detail-modal__content">
            <section><small>AI 추천 홍보 문구</small><p>{seoContent}</p></section>
            <section><small>적용된 이벤트·키워드 태그</small><div className="sync-detail-modal__tags">{seoTags.map((tag) => <span key={tag}>#{tag.replace(/^#/, '')}</span>)}</div></section>
            <dl className="sync-detail-modal__publish"><dt>발행 상태</dt><dd><CheckCircle /> 정상 등록</dd></dl>
          </div> : <div className="sync-detail-modal__content">
            <small>매장 정보 변경 비교</small>
            <dl className="sync-detail-modal__changes">
              {storeChanges.length > 0 ? storeChanges.map((change) => <div key={change.field}><dt>{change.field === 'businessHours' ? '영업시간' : change.field === 'temporaryClosure' ? '임시 휴무' : '대표 메뉴'}</dt><dd><s>{change.currentValue}</s><b aria-hidden="true">→</b><strong>{change.proposedValue}</strong></dd></div>) : <div><dt>변경 내용</dt><dd><strong>반영된 변경 내용이 없습니다.</strong></dd></div>}
            </dl>
          </div>}
          <button className="sync-detail-modal__confirm" type="button" onClick={() => setSelectedPlatform(null)}>확인</button>
        </section>
      </div> : null}
    </section>
  );
}

export const SyncStatus = SyncStatusDashboard;
