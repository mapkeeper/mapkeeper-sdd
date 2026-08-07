import { render, screen } from '@testing-library/react';
import { SeoPlatformResultCard } from '@/components/SeoPlatformResultCard/SeoPlatformResultCard';
import type { LocalSeoContent } from '@/services/contracts/seo';

const drafts: LocalSeoContent[] = [
  {
    draftId: '44444444-4444-4444-8444-444444444441',
    platform: 'google',
    draftText: 'Google용 매장 소개글',
    keywords: ['만두전골', '가족외식'],
    contentRules: ['team-defined-google-rule'],
  },
  {
    draftId: '44444444-4444-4444-8444-444444444442',
    platform: 'naver',
    draftText: 'Naver용 매장 소개글',
    keywords: ['만두전골 맛집'],
    contentRules: ['team-defined-naver-rule'],
  },
  {
    draftId: '44444444-4444-4444-8444-444444444443',
    platform: 'kakao',
    draftText: 'Kakao용 매장 소개글',
    keywords: ['가족외식'],
    contentRules: ['team-defined-kakao-rule'],
  },
];

describe('SeoPlatformResultCard', () => {
  test.each([
    ['google', 'Google'],
    ['naver', 'Naver'],
    ['kakao', 'Kakao'],
  ] as const)('%s 플랫폼 라벨, 문구, 키워드, 콘텐츠 규칙을 읽기 전용으로 표시한다', (platform, label) => {
    const draft = drafts.find((item) => item.platform === platform);
    expect(draft).toBeDefined();
    render(<SeoPlatformResultCard draft={draft as LocalSeoContent} />);

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByText(draft?.draftText ?? '')).toBeInTheDocument();
    expect(screen.getByText(`#${draft?.keywords[0] ?? ''}`)).toBeInTheDocument();
    expect(screen.getByText(draft?.contentRules[0] ?? '')).toBeInTheDocument();
  });

  test('선택, 수정, 거절 컨트롤을 렌더링하지 않는다', () => {
    render(<SeoPlatformResultCard draft={drafts[0] as LocalSeoContent} />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
