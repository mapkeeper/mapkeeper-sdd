import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';

vi.mock('@/features/store-change/StoreChangeWizard', () => ({
  StoreChangeWizard: ({ onSyncHandoff, storeProfileId }: { onSyncHandoff?: (value: { syncJobId: string; statusUrl: string }) => void; storeProfileId: string }) => (
    <div data-testid="store-change-wizard" data-store-profile-id={storeProfileId}>
      <button type="button" onClick={() => onSyncHandoff?.({ syncJobId: 'job-uc1', statusUrl: '/uc1' })}>UC1 승인 완료</button>
    </div>
  ),
}));

vi.mock('@/features/seo/SeoGenerationWizard', () => ({
  SeoGenerationWizard: ({ onExit, storeProfileId }: { onExit?: () => void; storeProfileId: string }) => (
    <div data-testid="seo-generation-wizard" data-store-profile-id={storeProfileId}><h1>SEO 단계 화면</h1><button type="button" onClick={onExit}>SEO 홈으로</button></div>
  ),
}));

vi.mock('@/components/SyncStatus/SyncStatus', () => ({
  SyncStatusDashboard: ({ syncJobId }: { syncJobId: string }) => <div>동기화 작업 {syncJobId}</div>,
}));

describe('App mobile routing', () => {
  beforeEach(() => vi.stubEnv('VITE_API_MOCKING', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  test('480px 모바일 홈에는 세 가지 핵심 행동만 보이고 개발 도구는 없다', () => {
    render(<App />);
    expect(screen.getByTestId('dashboard-container')).toHaveClass('app-phone');
    expect(screen.getByRole('button', { name: 'AI 가게 홍보 & 소문내기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '음성으로 매장 정보 변경하기' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '우리 가게 리뷰 분석 확인하기' })).toBeInTheDocument();
    expect(screen.getAllByText('연결됨')).toHaveLength(3);
    expect(screen.queryByText('개발자용 모의 응답 설정')).not.toBeInTheDocument();
    expect(screen.queryByText('SEO 단계 화면')).not.toBeInTheDocument();
  });

  test('홈, UC2, UC1, 동기화 결과 중 한 화면만 전환해 표시한다', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'AI 가게 홍보 & 소문내기' }));
    expect(screen.getByRole('heading', { name: 'SEO 단계 화면' })).toBeInTheDocument();
    expect(screen.getByTestId('seo-generation-wizard')).toHaveAttribute('data-store-profile-id', '11111111-1111-4111-8111-111111111111');
    expect(screen.queryByRole('button', { name: '음성으로 매장 정보 변경하기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'SEO 홈으로' }));

    await user.click(screen.getByRole('button', { name: '음성으로 매장 정보 변경하기' }));
    expect(screen.getByTestId('store-change-wizard')).toHaveAttribute('data-store-profile-id', '11111111-1111-4111-8111-111111111111');
    await user.click(screen.getByRole('button', { name: 'UC1 승인 완료' }));
    expect(screen.getByText('동기화 작업 job-uc1')).toBeInTheDocument();
    expect(screen.queryByText('SEO 단계 화면')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '확인 (홈으로 이동)' }));
    expect(screen.getByRole('button', { name: 'AI 가게 홍보 & 소문내기' })).toBeInTheDocument();
  });

  test('리뷰 분석 카드는 요약 모달을 먼저 보여준 뒤 CTA로 UC2에 진입한다', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: '우리 가게 리뷰 분석 확인하기' }));
    expect(screen.getByRole('dialog', { name: /손님들이 우리 가게를/ })).toBeInTheDocument();
    expect(screen.getByText('128')).toBeInTheDocument();
    expect(screen.getByText('#속이알참')).toBeInTheDocument();
    expect(screen.getByText('플랫폼별 주요 반응')).toBeInTheDocument();
    expect(screen.getByText(/만두전골 국물과 푸짐한 양/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'SEO 단계 화면' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '리뷰 분석 창 전체 화면으로 확장' }));
    expect(screen.getByText('맵지기 분석 포인트')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /이 분석으로 AI 홍보문구 만들기/ }));
    expect(screen.getByRole('heading', { name: 'SEO 단계 화면' })).toBeInTheDocument();
  });
});
