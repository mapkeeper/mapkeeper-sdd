import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import { SeoGenerationWizard } from '@/features/seo/SeoGenerationWizard';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';
import { sourceReviewFixtures } from '@/mocks/fixtures/storeFixtures';
import { SYNC_JOB_ID } from '@/mocks/fixtures/syncJobFixtures';
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
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({
      syncJobId: '66666666-6666-4666-8666-666666666666',
      statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
    }));
  });

  test('UC2 공통 입력 생성부터 전체 승인과 SyncJob handoff까지 완료한다', async () => {
    const user = userEvent.setup();
    const onSyncHandoff = vi.fn();
    server.use(
      http.post('*/api/v1/seo/generations', async () => HttpResponse.json({
        success: true, status: 'SUCCESS',
        data: {
          generationId: '33333333-3333-4333-8333-333333333333',
          status: 'DRAFT',
          revision: 1,
          drafts: [
            { draftId: '44444444-4444-4444-8444-444444444441', platform: 'google', draftText: '구글 문구', keywords: ['만두전골'], contentRules: ['rule'] },
            { draftId: '44444444-4444-4444-8444-444444444442', platform: 'naver', draftText: '네이버 문구', keywords: ['만두전골'], contentRules: ['rule'] },
            { draftId: '44444444-4444-4444-8444-444444444443', platform: 'kakao', draftText: '카카오 문구', keywords: ['만두전골'], contentRules: ['rule'] },
          ],
        },
        error: null, timestamp: '2026-08-03T00:00:00Z',
      }, { status: 201 })),
      http.post('*/api/v1/seo/generations/33333333-3333-4333-8333-333333333333/approve', async () => HttpResponse.json({
        success: true, status: 'PROCESSING',
        data: {
          generationId: '33333333-3333-4333-8333-333333333333',
          generationStatus: 'APPROVED',
          approvedPlatforms: ['google', 'naver', 'kakao'],
          syncJobId: '66666666-6666-4666-8666-666666666666',
          status: 'PENDING',
          statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
        },
        error: null, timestamp: '2026-08-03T00:00:00Z',
      })),
    );
    render(
      <SeoGenerationWizard storeProfileId="11111111-1111-4111-8111-111111111111" sourceReviews={sourceReviewFixtures} onSyncHandoff={onSyncHandoff} />,
    );
    await user.click(screen.getByRole('button', { name: '다음 (문구 만들기)' }));
    await user.type(screen.getByRole('textbox', { name: '공통 홍보 설명' }), '동네의 따뜻한 맛집, 만두전골이 자랑이에요.');
    await user.type(screen.getByRole('textbox', { name: '새 키워드' }), '만두전골');
    await user.click(screen.getByRole('button', { name: '추가' }));
    await user.click(screen.getByRole('button', { name: '문구 만들기' }));
    await screen.findByRole('heading', { name: 'Google·Naver·Kakao 문구를 확인해 주세요' });
    await user.click(screen.getByRole('button', { name: '승인 (3사에 반영)' }));
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({ syncJobId: '66666666-6666-4666-8666-666666666666', statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666' }));
  });

  test('부분 성공은 성공 결과를 보존하고 실패 플랫폼 재시도를 제공한다', async () => {
    setMockScenario('partial-success');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    expect(await screen.findByRole('heading', { name: '일부 플랫폼 반영 완료' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Google/ })).toHaveTextContent('반영 완료');
    expect(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' })).toBeInTheDocument();
  });

  test('전체 실패는 재시도 가능 오류와 재시도 불가 오류를 구분한다', async () => {
    setMockScenario('retryable-failure');
    const { unmount } = render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    expect(await screen.findByRole('heading', { name: '플랫폼 반영 실패' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' })).toBeInTheDocument();
    unmount();

    setMockScenario('non-retryable-failure');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    expect((await screen.findAllByText('플랫폼 권한을 확인해 주세요.'))).toHaveLength(3);
    expect(screen.queryByRole('button', { name: '실패한 플랫폼 다시 시도' })).not.toBeInTheDocument();
  });

  test('재시작 후 FAILED로 보고된 작업을 복구 가능한 상태로 설명한다', async () => {
    const restartedJobId = '88888888-8888-4888-8888-888888888888';
    server.use(http.get(`*/api/v1/sync-jobs/${restartedJobId}`, () => HttpResponse.json({
      success: true,
      status: 'SUCCESS',
      data: {
        syncJobId: restartedJobId,
        status: 'FAILED',
        platformTasks: [
          { platform: 'google', status: 'FAILED', attemptCount: 1, error: { code: 'API_TIMEOUT', message: '서버 재시작으로 작업이 중단되었습니다.', retryable: true, platform: 'google' } },
          { platform: 'naver', status: 'FAILED', attemptCount: 1, error: { code: 'API_TIMEOUT', message: '서버 재시작으로 작업이 중단되었습니다.', retryable: true, platform: 'naver' } },
          { platform: 'kakao', status: 'FAILED', attemptCount: 1, error: { code: 'API_TIMEOUT', message: '서버 재시작으로 작업이 중단되었습니다.', retryable: true, platform: 'kakao' } },
        ],
      },
      error: null,
      timestamp: '2026-08-03T00:00:00Z',
    })));
    render(<SyncStatusDashboard syncJobId={restartedJobId} />);
    expect((await screen.findAllByText('서버 재시작으로 작업이 중단되었습니다.'))).toHaveLength(3);
    expect(screen.getByRole('button', { name: '실패한 플랫폼 다시 시도' })).toBeInTheDocument();
  });

  test('네트워크 오류는 민감한 요청 정보 없이 복구 안내를 표시한다', async () => {
    setMockScenario('network-error');
    render(<SyncStatusDashboard syncJobId={SYNC_JOB_ID} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('인터넷 연결을 확인해 주세요.');
    expect(alert).not.toHaveTextContent('/api/v1');
  });
});
