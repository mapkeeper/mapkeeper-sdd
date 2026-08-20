import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { VoicePanel } from '@/components/VoicePanel/VoicePanel';

describe('VoicePanel', () => {
  test.each([
    ['IDLE', '음성으로 변경 내용을 말씀해 주세요'],
    ['LISTENING', '듣고 있습니다'],
    ['RECOGNIZED', '음성을 인식했습니다'],
    ['FAILED', '음성을 인식하지 못했습니다'],
  ] as const)('%s 상태를 화면과 live region으로 명확히 알린다', (state, announcement) => {
    render(
      <VoicePanel
        state={state}
        recognizedText={state === 'RECOGNIZED' ? '영업시간을 바꿔줘' : ''}
        onStart={vi.fn()}
        onManualSubmit={vi.fn()}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(announcement);
  });

  test('듣는 중에도 인식된 텍스트를 실시간으로 보여준다', () => {
    render(
      <VoicePanel state="LISTENING" recognizedText="영업시간을" onStart={vi.fn()} onManualSubmit={vi.fn()} />,
    );
    expect(screen.getByText('“영업시간을”')).toBeInTheDocument();
  });

  test('듣는 중 아직 인식된 텍스트가 없으면 안내 문구를 보여준다', () => {
    render(<VoicePanel state="LISTENING" recognizedText="" onStart={vi.fn()} onManualSubmit={vi.fn()} />);
    expect(screen.getByText('말을 마치면 자동으로 정리해 드려요.')).toBeInTheDocument();
  });

  test('듣는 중 취소 버튼을 누르면 onCancel을 호출한다', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <VoicePanel
        state="LISTENING"
        recognizedText="영업시간을"
        onStart={vi.fn()}
        onManualSubmit={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  test('onCancel이 없으면 취소 버튼을 보여주지 않는다', () => {
    render(<VoicePanel state="LISTENING" recognizedText="" onStart={vi.fn()} onManualSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '취소' })).not.toBeInTheDocument();
  });

  test('음성 시작 버튼은 48px 이상의 터치 영역을 가진다', () => {
    render(<VoicePanel state="IDLE" recognizedText="" onStart={vi.fn()} onManualSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: '음성 인식 시작' })).toHaveStyle({ minHeight: '56px' });
  });

  test('권한 거부를 설명하고 즉시 큰 직접 입력 UI를 제공한다', () => {
    render(
      <VoicePanel
        state="FAILED"
        recognizedText=""
        error="not-allowed"
        onStart={vi.fn()}
        onManualSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(/마이크 권한/)).toBeInTheDocument();
    expect(screen.getByLabelText('변경할 매장 정보 직접 입력')).toHaveStyle({ minHeight: '96px' });
    expect(screen.getByRole('button', { name: '직접 입력 내용 확인' })).toHaveStyle({ minHeight: '56px' });
  });

  test('FAILED 상태의 직접 입력은 제출 전까지 제안 API 콜백을 호출하지 않는다', async () => {
    const user = userEvent.setup();
    const onManualSubmit = vi.fn();
    const onRecognized = vi.fn();
    render(
      <VoicePanel
        state="FAILED"
        recognizedText=""
        onStart={vi.fn()}
        onRecognized={onRecognized}
        onManualSubmit={onManualSubmit}
      />,
    );

    expect(onRecognized).not.toHaveBeenCalled();
    expect(onManualSubmit).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('변경할 매장 정보 직접 입력'), '내일은 임시 휴무입니다');
    expect(onManualSubmit).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '직접 입력 내용 확인' }));
    expect(onManualSubmit).toHaveBeenCalledWith('내일은 임시 휴무입니다');
  });
});
