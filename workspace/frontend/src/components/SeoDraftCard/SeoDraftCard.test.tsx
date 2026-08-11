import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SeoDraftCard } from '@/components/SeoDraftCard/SeoDraftCard';
import type { SeoDraft } from '@/types/domain';

const drafts: SeoDraft[] = [
  { draftId: 'draft-001', platform: 'google', draftText: '구글 소개글', contentRules: ['짧고 정확한 정보'], status: 'DRAFT' },
  { draftId: 'draft-002', platform: 'naver', draftText: '네이버 소개글', contentRules: ['친근한 한국어'], status: 'DRAFT' },
  { draftId: 'draft-003', platform: 'kakao', draftText: '카카오 소개글', contentRules: ['동네 중심 표현'], status: 'DRAFT' },
];

describe('SeoDraftCard', () => {
  test.each([
    ['google', 'Google'],
    ['naver', 'Naver'],
    ['kakao', 'Kakao'],
  ] as const)('%s 플랫폼 라벨, 미리보기, 콘텐츠 규칙과 상태를 표시한다', (platform, label) => {
    const draft = drafts.find((item) => item.platform === platform);
    expect(draft).toBeDefined();
    render(
      <SeoDraftCard
        draft={draft as SeoDraft}
        selected
        onSelectionChange={vi.fn()}
        onSave={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText(draft?.draftText ?? '')).toBeInTheDocument();
    expect(screen.getByText(draft?.contentRules[0] ?? '')).toBeInTheDocument();
    expect(screen.getByText('DRAFT')).toBeInTheDocument();
  });

  test('큰 접근 가능 컨트롤로 선택, 수정, 로컬 거절을 수행한다', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const onSave = vi.fn();
    const onReject = vi.fn();
    render(
      <SeoDraftCard
        draft={drafts[0] as SeoDraft}
        selected
        onSelectionChange={onSelectionChange}
        onSave={onSave}
        onReject={onReject}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Google 문구 선택' }));
    expect(onSelectionChange).toHaveBeenCalledWith(false);

    const editButton = screen.getByRole('button', { name: 'Google 문구 수정' });
    expect(editButton).toHaveStyle({ minHeight: '56px' });
    await user.click(editButton);
    const editor = screen.getByRole('textbox', { name: 'Google SEO 문구' });
    await user.clear(editor);
    await user.type(editor, '수정된 구글 소개글');
    await user.click(screen.getByRole('button', { name: 'Google 수정 저장' }));
    expect(onSave).toHaveBeenCalledWith('draft-001', '수정된 구글 소개글');

    await user.click(screen.getByRole('button', { name: 'Google 문구 거절' }));
    expect(onReject).toHaveBeenCalledWith('draft-001');
  });

  test('REJECTED 카드는 선택과 편집을 허용하지 않는다', () => {
    render(
      <SeoDraftCard
        draft={{ ...(drafts[2] as SeoDraft), status: 'REJECTED' }}
        selected={false}
        onSelectionChange={vi.fn()}
        onSave={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText('REJECTED')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Kakao 문구 선택' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Kakao 문구 수정' })).not.toBeInTheDocument();
  });
});
