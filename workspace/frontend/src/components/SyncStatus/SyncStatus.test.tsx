import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import {
  failedSyncJobFixture,
  partialSuccessSyncJobFixture,
  pendingSyncJobFixture,
  processingSyncJobFixture,
  retryingSyncJobFixture,
  successSyncJobFixture,
} from '@/mocks/fixtures/syncJobFixtures';
import { setMockScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';

const localizedStatus = {
  PENDING: '대기 중',
  PROCESSING: '반영 중',
  RETRYING: '재시도 중',
  SUCCESS: '반영 완료',
  FAILED: '반영 실패',
} as const;

describe('SyncStatusDashboard', () => {
  test.each([
    [pendingSyncJobFixture, '동기화 대기 중'],
    [processingSyncJobFixture, '플랫폼에 반영 중'],
    [retryingSyncJobFixture, '실패한 플랫폼 재시도 중'],
    [partialSuccessSyncJobFixture, '일부 플랫폼 반영 완료'],
    [successSyncJobFixture, '모든 플랫폼 반영 완료'],
    [failedSyncJobFixture, '플랫폼 반영 실패'],
  ] as const)('$job.status 상태와 플랫폼별 진행률을 큰 현황판으로 표시한다', (job, label) => {
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={job} autoPoll={false} />);

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByLabelText('동기화 진행률')).toHaveAttribute('max', '3');
    expect(screen.getByRole('listitem', { name: /Google/ })).toHaveTextContent(localizedStatus[job.platforms.google]);
    expect(screen.getByRole('listitem', { name: /Naver/ })).toHaveTextContent(localizedStatus[job.platforms.naver]);
    expect(screen.getByRole('listitem', { name: /Kakao/ })).toHaveTextContent(localizedStatus[job.platforms.kakao]);
  });

  test('PENDING부터 SUCCESS까지 실시간 폴링하고 최종 상태에서 멈춘다', async () => {
    setMockScenario('all-success');
    render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);

    expect(await screen.findByRole('heading', { name: '모든 플랫폼 반영 완료' })).toBeInTheDocument();
    expect(screen.getByLabelText('동기화 진행률')).toHaveAttribute('value', '3');
  });

  test('조회 제한을 넘기면 자동 조회를 멈추고 사용자가 다시 확인할 수 있다', async () => {
    // Given: the backend keeps one job in PROCESSING beyond the polling window.
    const user = userEvent.setup();
    let requestCount = 0;
    let hasJobFinished = false;
    server.use(http.get('*/api/v1/sync-jobs/job-delayed', () => {
      requestCount += 1;
      const platformStatus = hasJobFinished ? 'SUCCESS' : 'PENDING';
      return HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          syncJobId: 'job-delayed',
          status: hasJobFinished ? 'SUCCESS' : 'PROCESSING',
          platformTasks: [
            { platform: 'google', status: hasJobFinished ? 'SUCCESS' : 'PROCESSING', attemptCount: 1, error: null },
            { platform: 'naver', status: platformStatus, attemptCount: hasJobFinished ? 1 : 0, error: null },
            { platform: 'kakao', status: platformStatus, attemptCount: hasJobFinished ? 1 : 0, error: null },
          ],
        },
        error: null,
        timestamp: '2026-08-17T00:00:00Z',
      });
    }));
    render(
      <SyncStatusDashboard
        syncJobId="job-delayed"
        pollIntervalMs={1}
        pollTimeoutMs={20}
      />,
    );
    const checkAgain = await screen.findByRole('button', { name: '다시 확인' });
    const requestsBeforeRestart = requestCount;

    // When: the job has finished in the meantime and the owner checks again.
    // Restarting grants the same short polling budget, so a job left PROCESSING
    // would re-raise the delayed notice within milliseconds and the assertion
    // below would be a race against that timer rather than a check of intent.
    hasJobFinished = true;
    await user.click(checkAgain);

    // Then: a fresh request is made and the delayed notice leaves for good.
    await waitFor(() => expect(requestCount).toBeGreaterThan(requestsBeforeRestart));
    expect(await screen.findByRole('heading', { name: '모든 플랫폼 반영 완료' })).toBeInTheDocument();
    expect(screen.queryByText('처리가 평소보다 오래 걸리고 있어요.')).not.toBeInTheDocument();
  });

  test('Google, Naver, Kakao를 식별할 수 있는 로컬 SVG 브랜드 로고를 표시한다', () => {
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} />);

    for (const platform of ['Google', 'Naver', 'Kakao']) {
      const logo = screen.getByRole('img', { name: `${platform} 로고` });
      expect(logo).toHaveAttribute('src', expect.stringMatching(/(?:\.svg$|^data:image\/svg\+xml)/));
    }
  });

  test('UC1 성공 플랫폼을 누르면 지도 화면 미리보기로 이전 값과 변경 값을 보여준다', async () => {
    const user = userEvent.setup();
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} viewMode="store-change" storeName="행복분식" storeChanges={[{ field: 'representativeMenuName', currentValue: '만두전골', proposedValue: '김치찌개' }]} />);

    await user.click(screen.getByRole('listitem', { name: /Google/ }));
    const dialog = screen.getByRole('dialog', { name: '정상적으로 등록되었어요' });
    const preview = within(dialog).getByRole('region', { name: '지도 화면 미리보기' });
    expect(within(preview).getByText('미리보기 · 실제 지도 화면과 다를 수 있습니다')).toBeInTheDocument();
    expect(within(preview).getByRole('tab', { name: /구글/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(preview).getByRole('heading', { name: '행복분식' })).toBeInTheDocument();
    expect(preview.querySelector('.map-viewport[data-platform="google"] .map-viewport__query')).toHaveTextContent('행복분식');
    expect(preview.querySelector('.map-viewport__surface')).toHaveAttribute('aria-hidden', 'true');
    expect(within(preview).getByText('이번에 업데이트된 정보 1개')).toBeInTheDocument();
    expect(within(preview).getByText('대표 메뉴')).toBeInTheDocument();
    expect(within(preview).getByText('김치찌개')).toBeInTheDocument();
    expect(within(preview).getByText('변경됨')).toBeInTheDocument();
    expect(screen.queryByText('인근 공영주차장 이용')).not.toBeInTheDocument();

    await user.click(within(preview).getByRole('button', { name: 'Before · 변경 전' }));
    expect(within(preview).getByText('만두전골')).toBeInTheDocument();
    expect(within(preview).queryByText('김치찌개')).not.toBeInTheDocument();
    expect(within(preview).queryByText('변경됨')).not.toBeInTheDocument();
  });

  test('UC1 미리보기에서 실패한 플랫폼은 반영된 것처럼 보이지 않는다', async () => {
    const user = userEvent.setup();
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={partialSuccessSyncJobFixture} autoPoll={false} viewMode="store-change" storeChanges={[{ field: 'parkingInfo', currentValue: '주차 불가', proposedValue: '건물 뒤 2대 주차 가능' }]} />);

    await user.click(screen.getByRole('listitem', { name: /Google/ }));
    const googleTab = screen.getByRole('tab', { name: /구글/ });
    expect(screen.getByText('건물 뒤 2대 주차 가능')).toBeInTheDocument();

    await user.type(googleTab, '{ArrowRight}');
    const naverTab = screen.getByRole('tab', { name: /네이버/ });
    expect(naverTab).toHaveAttribute('aria-selected', 'true');
    expect(naverTab).toHaveFocus();
    expect(naverTab).toHaveTextContent('반영 실패');
    expect(screen.getByRole('status')).toHaveTextContent('반영에 실패해 변경 전 정보가 그대로 보여요');
    expect(screen.getByText('주차 불가')).toBeInTheDocument();
    expect(screen.queryByText('건물 뒤 2대 주차 가능')).not.toBeInTheDocument();
    expect(screen.queryByText('변경됨')).not.toBeInTheDocument();
  });

  test('반영 내역 시트는 Escape로 닫히고 연 플랫폼으로 초점을 되돌린다', async () => {
    const user = userEvent.setup();
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} viewMode="store-change" storeChanges={[{ field: 'businessHours', currentValue: '09:00-21:00', proposedValue: '10:00-22:00' }]} />);
    const googleItem = screen.getByRole('listitem', { name: /Google/ });

    googleItem.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: '반영 내역 닫기' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(googleItem).toHaveFocus();
  });

  test('UC2 성공 플랫폼을 누르면 최종 홍보 문구와 태그 및 발행 상태를 보여준다', async () => {
    const user = userEvent.setup();
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} viewMode="seo" seoContent="우리 가게 최종 홍보 문구" seoTags={['국물맛집', '친절함']} />);

    await user.click(screen.getByRole('listitem', { name: /Naver/ }));
    expect(screen.getByText('우리 가게 최종 홍보 문구')).toBeInTheDocument();
    expect(screen.getByText('#국물맛집')).toBeInTheDocument();
    expect(screen.getByText('정상 등록')).toBeInTheDocument();
  });

  test('부분 성공은 성공한 플랫폼을 보존하고 재시도 가능한 실패만 다시 요청한다', async () => {
    const user = userEvent.setup();
    setMockScenario('partial-success');
    render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);

    expect(await screen.findByRole('heading', { name: '일부 플랫폼 반영 완료' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Google/ })).toHaveTextContent('반영 완료');
    expect(screen.getByText(/성공한 플랫폼은 그대로 유지/)).toBeInTheDocument();

    const retryButton = screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' });
    expect(retryButton).toHaveStyle({ minHeight: '56px' });
    await user.click(retryButton);
    expect(await screen.findByText('Naver 재시도를 시작했습니다.')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Google/ })).toHaveTextContent('반영 완료');
  });

  test('권한 오류처럼 재시도할 수 없는 실패에는 재시도 버튼을 표시하지 않는다', async () => {
    setMockScenario('non-retryable-failure');
    render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);

    expect(await screen.findByRole('heading', { name: '플랫폼 반영 실패' })).toBeInTheDocument();
    expect(screen.getAllByText('플랫폼 권한을 확인해 주세요.')).toHaveLength(3);
    expect(screen.getByText('플랫폼 연결 설정을 확인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });
});
