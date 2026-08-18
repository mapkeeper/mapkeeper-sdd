import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { server } from '@/mocks/server';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';

async function createDraft(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
  await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '영업시간을 밤 11시까지로 바꿔줘');
  await user.click(screen.getByRole('button', { name: '변경안 만들기' }));
  expect(await screen.findByRole('heading', { name: '변경안을 확인해 주세요' })).toBeInTheDocument();
}

describe('StoreChangeWizard', () => {
  afterEach(() => vi.unstubAllEnvs());
  test('빠른 시작 버튼이 대표 메뉴 예시를 직접 입력창에 채운다', async () => {
    const user = userEvent.setup();
    render(<StoreChangeWizard storeProfileId="store-123" />);

    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.click(screen.getByRole('button', { name: '대표 메뉴' }));

    expect(screen.getByLabelText('변경할 매장 정보 직접 입력')).toHaveValue('대표 메뉴를 김치찌개로 바꿔줘');
  });

  test('시작 화면은 홈으로 나가기만 보이고, 중간 단계는 이전 단계로 한 단계씩만 돌아간다', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<StoreChangeWizard storeProfileId="store-123" onExit={onExit} />);

    // INPUT: edge step, only the exit control.
    expect(screen.getByRole('button', { name: '홈으로 나가기' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '이전 단계로' })).not.toBeInTheDocument();

    // MANUAL: back goes to INPUT, not home.
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    expect(screen.queryByRole('button', { name: '홈으로 나가기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(screen.getByRole('button', { name: '홈으로 나가기' })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    // REVIEW → EDIT: back from the edit screen returns to REVIEW, not home
    // (this used to jump straight to the home screen and discard the edit).
    await createDraft(user);
    expect(screen.getByRole('button', { name: '이전 단계로' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '✎ 직접 수정' }));
    expect(await screen.findByRole('heading', { name: '변경 값을 수정해 주세요' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '홈으로 나가기' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(await screen.findByRole('heading', { name: '변경안을 확인해 주세요' })).toBeInTheDocument();
    expect(onExit).not.toHaveBeenCalled();

    // CONFIRM: back also returns to REVIEW.
    await user.click(screen.getByRole('button', { name: '승인 단계로 이동' }));
    expect(await screen.findByRole('heading', { name: '이 내용으로 반영할까요?' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    expect(await screen.findByRole('heading', { name: '변경안을 확인해 주세요' })).toBeInTheDocument();

    // Only the exit control actually calls onExit.
    await user.click(screen.getByRole('button', { name: '이전 단계로' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '홈으로 나가기' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: '홈으로 나가기' }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  test('인식 텍스트로 변경안을 만들고 검토 화면으로 이동한다', async () => {
    const user = userEvent.setup();
    render(<StoreChangeWizard storeProfileId="store-123" />);
    await createDraft(user);
    expect(screen.getByText('09:00-23:00')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  test('음성 또는 직접 입력 문장에 따라 허용된 변경 필드와 값이 동적으로 생성된다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '8월 10일은 임시 휴무로 해줘');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));
    expect(await screen.findByText('2026-08-10 ~ 2026-08-10')).toBeInTheDocument();
    expect(screen.getByText('임시 휴무')).toBeInTheDocument();
    unmount();

    render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '대표 메뉴를 김치만두로 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));
    expect(await screen.findByText('김치만두')).toBeInTheDocument();
    expect(screen.getByText('만두전골')).toBeInTheDocument();
    expect(screen.getByText('대표 메뉴')).toBeInTheDocument();
  });

  test('임시 휴무의 구조화된 날짜 응답도 흰 화면 없이 미리보기에 표시한다', async () => {
    const user = userEvent.setup();
    server.use(
      http.post('/api/v1/store-change-proposals', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          proposalId: 'prop-002',
          recognizedTextMasked: '내일 문 닫아',
          changes: [{
            field: 'temporaryClosure',
            currentValue: null,
            proposedValue: { startDate: '2026-08-17', endDate: '2026-08-17' },
          }],
          status: 'DRAFT',
        },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      })),
    );
    render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '내일 문 닫아');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(await screen.findByText('임시 휴무')).toBeInTheDocument();
    expect(screen.getByText('2026-08-17 ~ 2026-08-17')).toBeInTheDocument();
  });

  test('임시 휴무 수정은 텍스트 입력 대신 시작일·종료일 캘린더로 날짜를 바꾼다', async () => {
    const user = userEvent.setup();
    let patchBody: unknown;
    server.use(
      http.post('/api/v1/store-change-proposals', () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: {
          proposalId: 'prop-003',
          recognizedTextMasked: '내일 문 닫아',
          changes: [{
            field: 'temporaryClosure',
            currentValue: null,
            proposedValue: { startDate: '2026-08-17', endDate: '2026-08-17' },
          }],
          status: 'DRAFT',
        },
        error: null,
        timestamp: '2026-08-03T00:00:00Z',
      })),
      http.patch('/api/v1/store-change-proposals/:proposalId', async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            proposalId: 'prop-003',
            recognizedTextMasked: '내일 문 닫아',
            changes: [{
              field: 'temporaryClosure',
              currentValue: null,
              proposedValue: { startDate: '2026-08-20', endDate: '2026-08-22' },
            }],
            status: 'DRAFT',
          },
          error: null,
          timestamp: '2026-08-03T00:00:00Z',
        });
      }),
    );
    render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.click(screen.getByRole('button', { name: '임시 휴무' }));
    expect(screen.getByLabelText('변경할 매장 정보 직접 입력')).toHaveValue('내일 문 닫아');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));
    expect(await screen.findByText('2026-08-17 ~ 2026-08-17')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '변경안 수정' }));
    expect(screen.queryByLabelText('임시 휴무 변경 값')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('시작일'), { target: { value: '2026-08-20' } });
    fireEvent.change(screen.getByLabelText('종료일'), { target: { value: '2026-08-22' } });
    await user.click(screen.getByRole('button', { name: '수정 내용 저장' }));

    expect(await screen.findByText('2026-08-20 ~ 2026-08-22')).toBeInTheDocument();
    expect(patchBody).toMatchObject({
      changes: [{
        field: 'temporaryClosure',
        proposedValue: { startDate: '2026-08-20', endDate: '2026-08-22' },
      }],
    });
  });

  test('허용 필드 값을 수정하고 변경하지 않기를 선택하면 서버의 거절 상태를 확인한다', async () => {
    const user = userEvent.setup();
    let patchCalls = 0;
    let approveCalls = 0;
    let rejectCalls = 0;
    server.use(
      http.patch('/api/v1/store-change-proposals/:proposalId', () => {
        patchCalls += 1;
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            proposalId: 'prop-001',
            recognizedTextMasked: '영업시간 변경 요청',
            changes: [{
              field: 'businessHours',
              currentValue: { open: '09:00', close: '22:00' },
              proposedValue: { open: '09:00', close: '20:00' },
            }],
            status: 'DRAFT',
          },
          error: null,
          timestamp: '2026-08-03T00:00:00Z',
        });
      }),
      http.post('/api/v1/store-change-proposals/:proposalId/approve', () => {
        approveCalls += 1;
        return HttpResponse.error();
      }),
      http.post('/api/v1/store-change-proposals/:proposalId/reject', () => {
        rejectCalls += 1;
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            proposalId: 'prop-001',
            recognizedTextMasked: '영업시간 변경 요청',
            changes: [{
              field: 'businessHours',
              currentValue: { open: '09:00', close: '22:00' },
              proposedValue: { open: '09:00', close: '20:00' },
            }],
            status: 'REJECTED',
          },
          error: null,
          timestamp: '2026-08-03T00:00:00Z',
        });
      }),
    );
    const { unmount } = render(<StoreChangeWizard storeProfileId="store-123" />);
    await createDraft(user);
    await user.click(screen.getByRole('button', { name: '변경안 수정' }));
    const value = screen.getByLabelText('영업시간 변경 값');
    await user.clear(value);
    await user.type(value, '09:00-20:00');
    await user.click(screen.getByRole('button', { name: '수정 내용 저장' }));
    expect(await screen.findByText('09:00-20:00')).toBeInTheDocument();
    expect(patchCalls).toBe(1);

    await user.click(screen.getByRole('button', { name: '이번에는 변경하지 않기' }));
    expect(screen.getByText('변경안을 적용하지 않았습니다')).toBeInTheDocument();
    expect(rejectCalls).toBe(1);
    expect(approveCalls).toBe(0);
    unmount();
  });

  test('키보드 제출이나 음성은 승인하지 않고 승인 버튼 클릭만 approve를 한 번 호출한다', async () => {
    const user = userEvent.setup();
    const approvalKeys: string[] = [];
    let resolveApproval: (() => void) | undefined;
    const approvalBarrier = new Promise<void>((resolve) => { resolveApproval = resolve; });
    server.use(
      http.post('/api/v1/store-change-proposals/prop-001/approve', async ({ request }) => {
        approvalKeys.push(request.headers.get('Idempotency-Key') ?? '');
        await approvalBarrier;
        return HttpResponse.json({
          success: true,
          status: 'PROCESSING',
          data: {
            proposalId: 'prop-001',
            proposalStatus: 'APPROVED',
            syncJobId: 'job-001',
            status: 'PENDING',
            statusUrl: '/api/v1/sync-jobs/job-001',
          },
          error: null,
          timestamp: '2026-08-03T00:00:00Z',
        });
      }),
    );
    const onSyncHandoff = vi.fn();
    render(<StoreChangeWizard storeProfileId="store-123" onSyncHandoff={onSyncHandoff} />);
    await createDraft(user);
    await user.click(screen.getByRole('button', { name: '승인 단계로 이동' }));

    await user.keyboard('{Enter}');
    expect(approvalKeys).toHaveLength(0);
    const approveButton = screen.getByRole('button', { name: '승인' });
    await user.dblClick(approveButton);
    expect(approveButton).toBeDisabled();
    expect(approvalKeys).toHaveLength(1);
    expect(approvalKeys[0]).not.toBe('');

    resolveApproval?.();
    await waitFor(() => expect(onSyncHandoff).toHaveBeenCalledWith({
      syncJobId: 'job-001',
      statusUrl: '/api/v1/sync-jobs/job-001',
      changes: [{ field: 'businessHours', currentValue: '09:00-22:00', proposedValue: '09:00-23:00' }],
    }));
  });

  test('변경 내용이 없는 요청은 승인 단계와 approve 호출로 넘어가지 않는다', async () => {
    const user = userEvent.setup();
    let approveCalls = 0;
    server.use(
      http.post('/api/v1/store-change-proposals/:proposalId/approve', () => {
        approveCalls += 1;
        return HttpResponse.error();
      }),
    );
    render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '안녕하세요');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('변경할 매장 정보를 인식하지 못했어요');
    expect(screen.queryByRole('button', { name: '승인 단계로 이동' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '다시 입력하기' })).toBeInTheDocument();
    expect(approveCalls).toBe(0);
  });

  test('현재 대표 메뉴와 같은 메뉴 요청은 반영 단계로 넘어가지 않는다', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_API_MOCKING', 'false');
    server.use(
      http.post('/api/v1/store-change-proposals', () => HttpResponse.json({
        success: false,
        status: 'FAILED',
        data: null,
        error: { code: 'INVALID_STATE', message: '현재 매장 정보와 달라진 내용이 없습니다.', details: [] },
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 409 })),
    );
    render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '대표 메뉴를 비빔밥으로 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('변경할 매장 정보를 인식하지 못했어요. 다시 입력해 주세요.');
    expect(screen.getByRole('heading', { name: '변경안을 확인해 주세요' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '승인 단계로 이동' })).not.toBeInTheDocument();
  });

  test('Mock 서버가 검증 오류를 반환해도 처리 안내 후 원문 메모 DRAFT로 진행한다', async () => {
    const user = userEvent.setup();
    vi.stubEnv('VITE_API_MOCKING', 'true');
    server.use(
      http.post('/api/v1/store-change-proposals', () => HttpResponse.json({
        success: false,
        status: 'FAILED',
        data: null,
        error: {
          code: 'VALIDATION_ERROR',
          message: '허용되지 않은 필드입니다.',
          details: [{ field: 'recognizedText', reason: 'unsupported field' }],
        },
        timestamp: '2026-08-03T00:00:00Z',
      }, { status: 422 })),
    );
    render(<StoreChangeWizard storeProfileId="store-123" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '전화번호 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(screen.getByRole('status')).toHaveTextContent('AI가 변경안을 작성 중입니다...');
    expect(screen.getByRole('status')).toHaveTextContent('최대 1분 정도 걸릴 수 있어요.');
    expect(await screen.findByRole('heading', { name: '변경안을 확인해 주세요' }, { timeout: 1_500 })).toBeInTheDocument();
    expect(screen.getByText('요청 메모')).toBeInTheDocument();
    expect(screen.getByText('전화번호 바꿔줘')).toBeInTheDocument();
    expect(screen.queryByText('허용되지 않은 필드입니다.')).not.toBeInTheDocument();
  });
});
