import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Wizard } from '@/components/Wizard/Wizard';

describe('Wizard', () => {
  test('진행 단계와 화면당 하나의 주요 행동을 표시한다', async () => {
    const user = userEvent.setup();
    const onPrimaryAction = vi.fn();
    render(
      <Wizard
        title="변경안을 확인해 주세요"
        currentStep={2}
        totalSteps={4}
        primaryAction={{ label: '다음 단계', onClick: onPrimaryAction }}
      >
        <p>변경 내용</p>
      </Wizard>,
    );

    expect(screen.getByText('2 / 4 단계')).toBeInTheDocument();
    expect(screen.getAllByTestId('wizard-primary-action')).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: '다음 단계' }));
    expect(onPrimaryAction).toHaveBeenCalledOnce();
  });

  test('단계가 바뀌면 제목으로 포커스를 이동한다', () => {
    const { rerender } = render(
      <Wizard title="첫 단계" currentStep={1} totalSteps={2} primaryAction={{ label: '다음', onClick: vi.fn() }}>
        첫 내용
      </Wizard>,
    );
    rerender(
      <Wizard title="둘째 단계" currentStep={2} totalSteps={2} primaryAction={{ label: '완료', onClick: vi.fn() }}>
        둘째 내용
      </Wizard>,
    );
    expect(screen.getByRole('heading', { name: '둘째 단계' })).toHaveFocus();
  });

  test('저장하지 않은 변경이 있으면 페이지 이탈을 보호한다', () => {
    render(
      <Wizard title="수정 중" currentStep={1} totalSteps={1} dirty primaryAction={{ label: '저장', onClick: vi.fn() }}>
        수정 내용
      </Wizard>,
    );
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
