import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse, http } from 'msw';
import { server } from '@/mocks/server';
import { StoreChangeWizard } from '@/features/store-change/StoreChangeWizard';

class FakeSpeechRecognition {
  static instance: FakeSpeechRecognition | null = null;

  lang = '';
  continuous = false;
  interimResults = false;
  onstart: (() => void) | null = null;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn();
  abort = vi.fn();

  constructor() {
    FakeSpeechRecognition.instance = this;
  }

  recognize(transcript: string): void {
    this.onresult?.({ results: [{ 0: { transcript } }] });
  }
}

const proposalId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-08-03T00:00:00Z';

async function createDraft(user: ReturnType<typeof userEvent.setup>, text = '영업시간을 밤 10시까지로 바꿔줘'): Promise<void> {
  await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
  await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), text);
  await user.click(screen.getByRole('button', { name: '변경안 만들기' }));
  expect(await screen.findByRole('heading', { name: '변경안을 확인해 주세요' })).toBeInTheDocument();
}

describe('StoreChangeWizard', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition');
    Reflect.deleteProperty(window, 'webkitSpeechRecognition');
    FakeSpeechRecognition.instance = null;
  });

  test.each(['취소', '아니야.'])('취소 발화 %s는 API를 호출하지 않고 처음 화면으로 돌아간다', async (transcript) => {
    // Given: 음성 입력 화면에서 브라우저 음성 인식을 사용할 수 있다
    // When: 사용자가 취소 발화를 한다
    // Then: 변경안 API를 호출하지 않고 취소 안내와 초기 화면을 보여준다
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeSpeechRecognition });
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '음성 인식 시작' }));
    FakeSpeechRecognition.instance?.recognize(transcript);

    expect(await screen.findByText('음성 요청을 취소했어요. 처음부터 다시 말씀해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '음성 인식 시작' })).toBeInTheDocument();
    expect(screen.queryByText('AI가 변경안을 작성 중입니다...')).not.toBeInTheDocument();
  });

  test('필수 휴무 날짜가 없으면 재질문하고 추가 답변으로 변경안을 만든다', async () => {
    // Given: 날짜가 빠진 휴무 요청을 입력한다
    // When: 시스템이 필요한 정보를 재질문하고 날짜를 추가로 입력한다
    // Then: 원래 요청과 추가 답변을 합쳐 휴무 변경안을 만든다
    const user = userEvent.setup();
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '문 닫아');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(await screen.findByRole('heading', { name: '조금만 더 알려주세요' })).toBeInTheDocument();
    expect(screen.getByText('휴무 날짜가 필요해요. “8월 15일 하루 종일 임시 휴무”처럼 정확한 날짜를 말씀해 주세요.')).toBeInTheDocument();
    await user.type(screen.getByLabelText('추가로 알려줄 내용'), '8월 15일 하루 종일 임시 휴무');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(await screen.findByText('2026-08-15 ~ 2026-08-15')).toBeInTheDocument();
  });

  test('음성 재질문에 날짜로 답하면 휴무 변경안을 만든다', async () => {
    // Given: 음성 인식 화면에서 날짜가 빠진 휴무 요청을 했다
    // When: 재질문에 음성으로 날짜를 답한다
    // Then: 두 발화를 합쳐 휴무 변경안을 만든다
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeSpeechRecognition });
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '음성 인식 시작' }));
    FakeSpeechRecognition.instance?.recognize('문 닫아');
    expect(await screen.findByRole('heading', { name: '조금만 더 알려주세요' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '음성 인식 시작' }));
    FakeSpeechRecognition.instance?.recognize('8월 15일 하루 종일 임시 휴무');

    expect(await screen.findByText('2026-08-15 ~ 2026-08-15')).toBeInTheDocument();
  });

  test('상대 날짜가 포함된 음성 요청은 재질문 없이 휴무 변경안을 만든다', async () => {
    // Given: 음성 인식 화면에서 내일 휴무 요청을 한다
    // When: 시스템이 상대 날짜를 해석한다
    // Then: 날짜 재질문 없이 내일 날짜의 휴무 변경안을 만든다
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeSpeechRecognition });
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '음성 인식 시작' }));
    FakeSpeechRecognition.instance?.recognize('내일 문 닫아');

    expect(await screen.findByText('2026-08-04 ~ 2026-08-04')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '조금만 더 알려주세요' })).not.toBeInTheDocument();
  });

  test('인식 텍스트로 구조화된 영업시간 변경안을 만들고 검토 화면에 형식화해 보여준다', async () => {
    const user = userEvent.setup();
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '영업시간을 오후 8시까지로 바꿔줘');
    expect(screen.getByText('09:00-22:00')).toBeInTheDocument();
    expect(screen.getByText('09:00-20:00')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  test('임시 휴무 기간과 대표 메뉴 변경이 각각 형식화되어 표시된다', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '8월 15일부터 8월 17일까지 임시 휴무로 해줘');
    expect(await screen.findByText('2026-08-15 ~ 2026-08-17')).toBeInTheDocument();
    expect(screen.getByText('임시 휴무')).toBeInTheDocument();
    unmount();

    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '대표 메뉴를 만두전골로 바꿔줘');
    expect(await screen.findByText('만두전골')).toBeInTheDocument();
    expect(screen.getByText('대표 메뉴')).toBeInTheDocument();
  });

  test('필드별 컨트롤로 영업시간을 수정하면 PATCH로 전체 목록을 저장한다', async () => {
    const user = userEvent.setup();
    let patchBody: unknown;
    server.use(
      http.patch(`/api/v1/store-change-proposals/${proposalId}`, async ({ request }) => {
        patchBody = await request.json();
        return HttpResponse.json({
          success: true,
          status: 'SUCCESS',
          data: {
            proposalId,
            recognizedTextMasked: '***',
            changes: [{ field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '20:00' } }],
            status: 'DRAFT',
          },
          error: null,
          timestamp,
        });
      }),
    );
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '영업시간을 밤 10시까지로 바꿔줘');

    await user.click(screen.getByRole('button', { name: '변경안 수정' }));
    const close = screen.getByLabelText('영업시간 종료 변경 값');
    await user.clear(close);
    await user.type(close, '20:00');
    await user.click(screen.getByRole('button', { name: '수정 내용 저장' }));

    expect(await screen.findByText('09:00-20:00')).toBeInTheDocument();
    expect(patchBody).toEqual({
      changes: [{ field: 'businessHours', currentValue: { open: '09:00', close: '22:00' }, proposedValue: { open: '09:00', close: '20:00' } }],
    });
  });

  test('서버가 STALE_PROPOSAL을 반환하면 안내 후 변경안을 그대로 유지한다', async () => {
    const user = userEvent.setup();
    server.use(
      http.patch(`/api/v1/store-change-proposals/${proposalId}`, () => HttpResponse.json({
        success: false,
        status: 'FAILED',
        data: null,
        error: { code: 'STALE_PROPOSAL', message: '변경안이 그새 바뀌었습니다.' },
        timestamp,
      }, { status: 409 })),
    );
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '영업시간을 밤 10시까지로 바꿔줘');

    await user.click(screen.getByRole('button', { name: '변경안 수정' }));
    await user.click(screen.getByRole('button', { name: '수정 내용 저장' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('변경안이 그새 바뀌었어요');
    expect(screen.getByLabelText('영업시간 종료 변경 값')).toHaveValue('22:00');
  });

  test('거절은 서버 reject API를 호출하며, 실패하면 DRAFT를 유지하고 오류를 보여준다', async () => {
    const user = userEvent.setup();
    let rejectCalls = 0;
    server.use(
      http.post(`/api/v1/store-change-proposals/${proposalId}/reject`, () => {
        rejectCalls += 1;
        return HttpResponse.json({
          success: false,
          status: 'FAILED',
          data: null,
          error: { code: 'INVALID_STATE', message: '이미 처리된 변경안입니다.' },
          timestamp,
        }, { status: 409 });
      }),
    );
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '영업시간을 밤 10시까지로 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 거절' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('변경안을 적용하지 않았습니다')).not.toBeInTheDocument();
    expect(rejectCalls).toBe(1);
  });

  test('거절이 성공하면 서버가 반환한 REJECTED 상태로 전환되고 더 이상 수정·승인할 수 없다', async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`/api/v1/store-change-proposals/${proposalId}/reject`, () => HttpResponse.json({
        success: true,
        status: 'SUCCESS',
        data: { proposalId, recognizedTextMasked: '***', changes: [], status: 'REJECTED' },
        error: null,
        timestamp,
      })),
    );
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await createDraft(user, '영업시간을 밤 10시까지로 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 거절' }));

    expect(await screen.findByText('변경안을 적용하지 않았습니다')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '승인' })).not.toBeInTheDocument();
  });

  test('키보드 제출이나 음성은 승인하지 않고 승인 버튼 클릭만 approve를 한 번 호출한다', async () => {
    const user = userEvent.setup();
    const approvalKeys: string[] = [];
    let resolveApproval: (() => void) | undefined;
    const approvalBarrier = new Promise<void>((resolve) => { resolveApproval = resolve; });
    server.use(
      http.post(`/api/v1/store-change-proposals/${proposalId}/approve`, async ({ request }) => {
        approvalKeys.push(request.headers.get('Idempotency-Key') ?? '');
        await approvalBarrier;
        return HttpResponse.json({
          success: true,
          status: 'PROCESSING',
          data: {
            proposalId,
            proposalStatus: 'APPROVED',
            syncJobId: '66666666-6666-4666-8666-666666666666',
            status: 'PENDING',
            statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
          },
          error: null,
          timestamp,
        });
      }),
    );
    const onSyncHandoff = vi.fn();
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" onSyncHandoff={onSyncHandoff} />);
    await createDraft(user, '영업시간을 밤 10시까지로 바꿔줘');
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
      syncJobId: '66666666-6666-4666-8666-666666666666',
      statusUrl: '/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666',
    }));
  });

  test('생성 요청이 네트워크 오류로 실패하면 가짜 성공 없이 오류 안내만 보여준다', async () => {
    const user = userEvent.setup();
    server.use(http.post('/api/v1/store-change-proposals', () => HttpResponse.error()));
    render(<StoreChangeWizard storeProfileId="11111111-1111-4111-8111-111111111111" />);
    await user.click(screen.getByRole('button', { name: '직접 입력하기' }));
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '영업시간을 밤 10시까지로 바꿔줘');
    await user.click(screen.getByRole('button', { name: '변경안 만들기' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결할 수 없습니다');
    expect(screen.queryByRole('heading', { name: '변경안을 확인해 주세요' })).not.toBeInTheDocument();
  });
});
