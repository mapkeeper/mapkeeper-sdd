import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MapPlacePreview } from '@/components/MapPlacePreview/MapPlacePreview';
import type { ProposalChange } from '@/types/domain';

const allFieldChanges: ProposalChange[] = [
  { field: 'businessHours', currentValue: '09:00-21:00', proposedValue: '10:00-22:00' },
  { field: 'temporaryClosure', currentValue: '', proposedValue: '2026-09-20~2026-09-21' },
  { field: 'representativeMenuName', currentValue: '만두전골', proposedValue: '김치찌개' },
  { field: 'parkingInfo', currentValue: '주차 불가', proposedValue: '건물 뒤 2대 주차 가능' },
];

const allSuccess = [
  { id: 'google', status: 'SUCCESS' },
  { id: 'naver', status: 'SUCCESS' },
  { id: 'kakao', status: 'PENDING' },
] as const;

describe('MapPlacePreview', () => {
  test('네 가지 UC1 필드를 플랫폼 장소 카드에 실제 변경값으로 표시한다', () => {
    render(<MapPlacePreview platforms={[...allSuccess]} changes={allFieldChanges} />);

    const card = screen.getByRole('article', { name: 'Google 지도 장소 정보 미리보기' });
    for (const label of ['영업시간', '임시 휴무', '대표 메뉴', '주차 정보']) {
      expect(within(card).getByText(label)).toBeInTheDocument();
    }
    for (const change of allFieldChanges) {
      expect(within(card).getByText(change.proposedValue)).toBeInTheDocument();
    }
    expect(within(card).getAllByText('변경됨')).toHaveLength(4);
    expect(within(card).getByRole('heading', { name: '내 매장' })).toBeInTheDocument();
    expect(within(card).getByText('이번에 업데이트된 정보 4개')).toBeInTheDocument();
    expect(card).not.toHaveTextContent(/리뷰|별점|주소/);
    expect(within(card).queryAllByRole('img')).toHaveLength(0);
  });

  test('지도 뷰포트는 지도 표면과 검색 크롬 위에 장소 시트를 겹쳐 보여준다', () => {
    const { container } = render(<MapPlacePreview platforms={[...allSuccess]} changes={allFieldChanges} storeName="행복분식" />);

    const viewport = container.querySelector<HTMLElement>('.map-viewport');
    expect(viewport).toHaveAttribute('data-platform', 'google');

    // Drawn map geometry and app chrome are decorative and hidden from assistive tech.
    const surface = viewport?.querySelector('.map-viewport__surface');
    expect(surface).toHaveAttribute('aria-hidden', 'true');
    expect(surface?.querySelectorAll('.map-surface__road path').length).toBeGreaterThan(2);
    expect(surface?.querySelectorAll('.map-surface__pin')).toHaveLength(1);
    expect(viewport?.querySelector('.map-viewport__chrome')).toHaveAttribute('aria-hidden', 'true');

    // The search chrome only repeats the real store name; no address or coordinates.
    expect(viewport?.querySelector('.map-viewport__query')).toHaveTextContent('행복분식');
    expect(viewport).not.toHaveTextContent(/리뷰|별점|주소|위도|경도/);

    const card = screen.getByRole('article', { name: 'Google 지도 장소 정보 미리보기' });
    expect(viewport).toContainElement(card);
    expect(within(card).getByText('경로')).toBeInTheDocument();
    expect(within(card).getByText('개요')).toBeInTheDocument();
  });

  test('Before에서는 현재 값을 보여주고 비어 있으면 정보 없음으로 안내한다', async () => {
    const user = userEvent.setup();
    render(<MapPlacePreview platforms={[...allSuccess]} changes={allFieldChanges} storeName="행복분식" />);

    await user.click(screen.getByRole('button', { name: 'Before · 변경 전' }));
    expect(screen.getByRole('button', { name: 'Before · 변경 전' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('변경 전 정보')).toBeInTheDocument();
    expect(screen.queryByText('이번에 업데이트된 정보 4개')).not.toBeInTheDocument();
    expect(screen.getByText('만두전골')).toBeInTheDocument();
    expect(screen.getByText('등록된 정보 없음')).toBeInTheDocument();
    expect(screen.queryByText('김치찌개')).not.toBeInTheDocument();
  });

  test('플랫폼 탭은 Home·End 키로 이동하고 대기 중 플랫폼은 미반영으로 안내한다', async () => {
    const user = userEvent.setup();
    render(<MapPlacePreview platforms={[...allSuccess]} changes={allFieldChanges} initialPlatform="naver" />);

    const naverTab = screen.getByRole('tab', { name: /네이버/ });
    expect(naverTab).toHaveAttribute('tabindex', '0');
    await user.type(naverTab, '{End}');
    const kakaoTab = screen.getByRole('tab', { name: /카카오/ });
    expect(kakaoTab).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName(/카카오/);
    expect(screen.getByRole('article', { name: '카카오맵 장소 정보 미리보기' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('아직 반영 중이에요');
    expect(screen.queryByText('김치찌개')).not.toBeInTheDocument();

    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /구글/ })).toHaveFocus();
    expect(screen.getByText('김치찌개')).toBeInTheDocument();
  });
});
