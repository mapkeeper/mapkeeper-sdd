import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';
import { sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { failedSyncJobFixture } from '@/mocks/fixtures/syncJobFixtures';
import { server } from '@/mocks/server';
import { setMockScenario } from '@/mocks/scenarios';

describe('MVP 통합 흐름', () => {
  test('UC1 생성부터 명시적 승인과 SyncJob handoff까지 완료한다', async () => {
    const user = userEvent.setup();
    const onSyncHandoff = vi.fn();
    render(<StoreChangeWizard storeProfileId="store-123" onSyncHandoff={onSyncHandoff} />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '영업시간을 밤 10시까지로 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));
    await screen.findByRole('heading', { name: '변경안을 확인해 주세요' });
    await user.click(screen.getByRole('button', { name: '승인 단계로 이동' }));
    await user.click(screen.getByRole('button', { name: '승인' }));
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({ syncJobId: 'job-001', statusUrl: '/api/v1/sync-jobs/job-001' }));
  });

  test('UC2 세 플랫폼 생성부터 전체 승인과 SyncJob handoff까지 완료한다', async () => {
    const user = userEvent.setup();
    const onSyncHandoff = vi.fn();
    render(
      <SeoGenerationWizard storeProfileId="store-123" sourceReviews={sourceReviewFixtures} onSyncHandoff={onSyncHandoff} />,
    );
    await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
    await user.click(screen.getByRole('radio', { name: /매장 대표 소개글/ }));
    await user.click(screen.getByRole('button', { name: '선택 완료' }));
    for (const answer of ['동네의 따뜻한 맛집', '친절함', '만두전골']) {
      await user.type(screen.getByRole('textbox', { name: '사장님 답변 입력' }), answer);
      await user.click(screen.getByRole('button', { name: '전송' }));
      if (answer !== '만두전골') await new Promise((resolve) => window.setTimeout(resolve, 550));
    }
    await user.click(screen.getByRole('button', { name: '문구 추천받기' }));
    await screen.findByRole('heading', { name: '3사 전체 추천 문구를 확인해 주세요' });
    await user.click(screen.getByRole('button', { name: '3사 전체 승인' }));
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({ syncJobId: 'job-001', statusUrl: '/api/v1/sync-jobs/job-001' }));
  });

  test('부분 성공은 성공 결과를 보존하고 실패 플랫폼 재시도를 제공한다', async () => {
    setMockScenario('partial-success');
    render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);
    expect(await screen.findByRole('heading', { name: '일부 플랫폼 반영 완료' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Google/ })).toHaveTextContent('반영 완료');
    expect(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' })).toBeInTheDocument();
  });

  test('전체 실패는 재시도 가능 오류와 재시도 불가 오류를 구분한다', async () => {
    setMockScenario('retryable-failure');
    const { unmount } = render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);
    expect(await screen.findByRole('heading', { name: '플랫폼 반영 실패' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' })).toBeInTheDocument();
    unmount();

    setMockScenario('non-retryable-failure');
    render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);
    expect(await screen.findByText('플랫폼 권한을 확인해 주세요.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });

  test('재시작 후 FAILED로 보고된 작업을 복구 가능한 상태로 설명한다', async () => {
    server.use(http.get('/api/v1/sync-jobs/job-restarted', () => HttpResponse.json({
      success: true,
      status: 'FAILED',
      data: { ...failedSyncJobFixture, syncJobId: 'job-restarted' },
      error: { code: 'API_TIMEOUT', message: '서버 재시작으로 작업이 중단되었습니다.', retryable: true },
      timestamp: '2026-08-03T00:00:00Z',
    })));
    render(<SyncStatusDashboard syncJobId="job-restarted" pollIntervalMs={1} />);
    expect(await screen.findByText('서버 재시작으로 작업이 중단되었습니다.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' })).toBeInTheDocument();
  });

  test('네트워크 오류는 민감한 요청 정보 없이 복구 안내를 표시한다', async () => {
    setMockScenario('network-error');
    render(<SyncStatusDashboard syncJobId="job-001" pollIntervalMs={1} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('인터넷 연결을 확인해 주세요.');
    expect(alert).not.toHaveTextContent('/api/v1');
  });
});
