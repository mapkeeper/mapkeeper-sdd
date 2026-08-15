import { render, screen } from '@testing-library/react';
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
  ] as const)('%s 플랫폼 결과와 읽기 전용 상태를 표시한다', (platform, label) => {
    const draft = drafts.find((item) => item.platform === platform) as SeoDraft;
    render(<SeoDraftCard draft={draft} />);

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText(draft.draftText)).toBeInTheDocument();
    expect(screen.getByText(draft.contentRules[0] as string)).toBeInTheDocument();
    expect(screen.getByText('검토 중')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('승인된 상태는 사용자에게 반영 완료로 표시한다', () => {
    const draft = drafts.find((item) => item.platform === 'google') as SeoDraft;

    render(
      <SeoDraftCard
        draft={{ ...draft, status: 'APPROVED' }}
      />,
    );

    expect(screen.getByText('반영 완료')).toBeInTheDocument();
    expect(screen.queryByText('APPROVED')).not.toBeInTheDocument();
  });

  test('거절된 상태는 사용자에게 반영 제외로 표시한다', () => {
    const draft = drafts.find((item) => item.platform === 'google') as SeoDraft;

    render(
      <SeoDraftCard
        draft={{ ...draft, status: 'REJECTED' }}
      />,
    );

    expect(screen.getByText('반영 제외')).toBeInTheDocument();
    expect(screen.queryByText('REJECTED')).not.toBeInTheDocument();
  });
});
