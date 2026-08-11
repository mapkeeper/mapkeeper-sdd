import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { VoicePanel } from '@/components/VoicePanel/VoicePanel';
import { SeoDraftCard } from '@/components/SeoDraftCard/SeoDraftCard';
import { SyncStatusDashboard } from '@/components/SyncStatus/SyncStatus';
import { successSyncJobFixture } from '@/mocks/fixtures/syncJobFixtures';

describe('접근성 회귀', () => {
  test('UC1 음성 입력은 키보드, live region, 큰 터치 영역을 제공한다', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VoicePanel state="IDLE" recognizedText="" onStart={vi.fn()} onManualSubmit={vi.fn()} />,
    );
    const button = screen.getByRole('button', { name: '음성 인식 시작' });
    await user.tab();
    expect(button).toHaveFocus();
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(Number.parseFloat(getComputedStyle(button).minHeight)).toBeGreaterThanOrEqual(56);
    expect((await axe(container)).violations).toEqual([]);
  });

  test('UC2 플랫폼 카드는 접근 가능한 이름, 키보드 편집, 충분한 대비와 터치 영역을 갖는다', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SeoDraftCard
        draft={{ draftId: 'draft-001', platform: 'google', draftText: '구글 소개글', contentRules: ['정확한 정보'], status: 'DRAFT' }}
        selected
        onSelectionChange={vi.fn()}
        onSave={vi.fn()}
        onReject={vi.fn()}
      />,
    );
    const edit = screen.getByRole('button', { name: 'Google 문구 수정' });
    edit.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('textbox', { name: 'Google SEO 문구' })).toBeInTheDocument();
    expect(Number.parseFloat(getComputedStyle(screen.getByRole('button', { name: 'Google 수정 저장' })).minHeight)).toBeGreaterThanOrEqual(56);
    expect((await axe(container)).violations).toEqual([]);
  });

  test('동기화 현황은 스크린리더 진행률과 reduced-motion 규칙을 제공한다', async () => {
    const { container } = render(
      <SyncStatusDashboard syncJobId="job-001" initialJob={successSyncJobFixture} autoPoll={false} />,
    );
    expect(screen.getByLabelText('동기화 진행률')).toHaveAttribute('value', '3');
    expect(screen.getByLabelText('플랫폼 동기화 현황')).toHaveAttribute('data-reduced-motion-safe', 'true');
    expect((await axe(container)).violations).toEqual([]);
  });
});
