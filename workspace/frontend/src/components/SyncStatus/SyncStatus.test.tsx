import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  failedSyncJobFixture,
  partialSuccessSyncJobFixture,
  pendingSyncJobFixture,
  processingSyncJobFixture,
  retryingSyncJobFixture,
  successSyncJobFixture,
} from '@/mocks/fixtures/syncJobFixtures';
import { setMockScenario } from '@/mocks/scenarios';
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

  test('Google, Naver, Kakao를 식별할 수 있는 로컬 SVG 브랜드 로고를 표시한다', () => {
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} />);

    for (const platform of ['Google', 'Naver', 'Kakao']) {
      const logo = screen.getByRole('img', { name: `${platform} 로고` });
      expect(logo).toHaveAttribute('src', expect.stringMatching(/(?:\.svg$|^data:image\/svg\+xml)/));
    }
  });

  test('UC1 성공 플랫폼을 누르면 매장 정보 이전 값과 변경 값을 보여준다', async () => {
    const user = userEvent.setup();
    render(<SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} viewMode="store-change" storeChanges={[{ field: 'representativeMenuName', currentValue: '만두전골', proposedValue: '김치찌개' }]} />);

    await user.click(screen.getByRole('listitem', { name: /Google/ }));
    expect(screen.getByRole('dialog', { name: '정상적으로 등록되었어요' })).toBeInTheDocument();
    expect(screen.getByText('매장 정보 변경 비교')).toBeInTheDocument();
    expect(screen.getByText('대표 메뉴')).toBeInTheDocument();
    expect(screen.getByText('김치찌개')).toBeInTheDocument();
    expect(screen.queryByText('인근 공영주차장 이용')).not.toBeInTheDocument();
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
    expect(screen.getByText('플랫폼 권한을 확인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });
});
