import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/App';

vi.mock('@/features/store-change/StoreChangeWizard', () => ({
  StoreChangeWizard: ({ onSyncHandoff }: { onSyncHandoff?: (value: { syncJobId: string; statusUrl: string }) => void }) => (
    <button type="button" onClick={() => onSyncHandoff?.({ syncJobId: 'job-uc1', statusUrl: '/uc1' })}>UC1 승인 완료</button>
  ),
}));

vi.mock('@/features/seo/SeoGenerationWizard', () => ({
  SeoGenerationWizard: ({ onExit }: { onExit?: () => void }) => (
    <div><h1>SEO 단계 화면</h1><button type="button" onClick={onExit}>SEO 홈으로</button></div>
  ),
}));

vi.mock('@/components/SyncStatus/SyncStatus', () => ({
  SyncStatusDashboard: ({ syncJobId }: { syncJobId: string }) => <div>동기화 작업 {syncJobId}</div>,
}));

describe('App mobile routing', () => {
  beforeEach(() => vi.stubEnv('VITE_API_MOCKING', 'true'));
  afterEach(() => vi.unstubAllEnvs());

  test('480px 모바일 홈에는 두 진입 행동만 보이고 개발 패널은 접혀 있다', () => {
    render(<App />);
    expect(screen.getByTestId('dashboard-container')).toHaveClass('app-phone');
    expect(screen.getByRole('button', { name: /AI 홍보 문구 만들기/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /매장정보 변경하기/ })).toBeInTheDocument();
    expect(screen.getByText('개발자용 모의 응답 설정').closest('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('SEO 단계 화면')).not.toBeInTheDocument();
  });

  test('홈, UC2, UC1, 동기화 결과 중 한 화면만 전환해 표시한다', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: /AI 홍보 문구 만들기/ }));
    expect(screen.getByRole('heading', { name: 'SEO 단계 화면' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /매장정보 변경하기/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'SEO 홈으로' }));

    await user.click(screen.getByRole('button', { name: /매장정보 변경하기/ }));
    await user.click(screen.getByRole('button', { name: 'UC1 승인 완료' }));
    expect(screen.getByText('동기화 작업 job-uc1')).toBeInTheDocument();
    expect(screen.queryByText('SEO 단계 화면')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '홈으로 돌아가기' }));
    expect(screen.getByRole('button', { name: /AI 홍보 문구 만들기/ })).toBeInTheDocument();
  });
});
