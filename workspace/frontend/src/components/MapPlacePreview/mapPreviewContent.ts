import type { Platform, ProposalField } from '@/types/domain';
import googleLogo from '@/assets/platforms/google.svg';
import naverLogo from '@/assets/platforms/naver.svg';
import kakaoLogo from '@/assets/platforms/kakao.svg';

export type PreviewPlatformStatus = 'SUCCESS' | 'FAIL' | 'PENDING' | 'PROCESSING' | 'RETRYING';
export type PreviewMode = 'before' | 'after';

export interface PreviewPlatform {
  id: Platform;
  status: PreviewPlatformStatus;
}

export const MAP_PREVIEW_DISCLAIMER = '미리보기 · 실제 지도 화면과 다를 수 있습니다';
export const MAP_PREVIEW_FALLBACK_STORE_NAME = '내 매장';

export const PREVIEW_FIELD_LABELS: Record<ProposalField, string> = {
  businessHours: '영업시간',
  temporaryClosure: '임시 휴무',
  representativeMenuName: '대표 메뉴',
  parkingInfo: '주차 정보',
};

export const PREVIEW_STATUS_LABELS: Record<PreviewPlatformStatus, string> = {
  SUCCESS: '반영 완료',
  FAIL: '반영 실패',
  PENDING: '대기 중',
  PROCESSING: '반영 중',
  RETRYING: '재시도 중',
};

/** Top search treatment: floating pill, floating panel with a search button, flush top bar. */
export type PreviewSearchChrome = 'pill' | 'panel' | 'bar';
/** Map control cluster: separate circles, one grouped column, separate squares. */
export type PreviewControlShape = 'round' | 'column' | 'square';
/** Place sheet action row: icon circles, rounded squares, full-width buttons. */
export type PreviewActionShape = 'circle' | 'squircle' | 'bar';
/** Place sheet info rows: label over value, label beside value, separated blocks. */
export type PreviewRowLayout = 'stacked' | 'split' | 'block';
/** Map marker silhouette drawn on the SVG surface. */
export type PreviewMarkerShape = 'teardrop' | 'balloon' | 'droplet';
/** Decorative trailing control in the sheet heading. */
export type PreviewHeadingAffordance = 'none' | 'more' | 'close';

interface PlatformSkin {
  appName: string;
  tabLabel: string;
  logo: string;
  actions: string[];
  sections: string[];
  searchChrome: PreviewSearchChrome;
  controlShape: PreviewControlShape;
  actionShape: PreviewActionShape;
  rowLayout: PreviewRowLayout;
  markerShape: PreviewMarkerShape;
  headingAffordance: PreviewHeadingAffordance;
}

// Decorative chrome only: action and section labels mirror each app's place
// detail layout and are hidden from assistive technology. The layout variants
// keep each platform structurally distinct, not merely recolored.
export const PLATFORM_SKINS: Record<Platform, PlatformSkin> = {
  google: {
    appName: 'Google 지도',
    tabLabel: '구글',
    logo: googleLogo,
    actions: ['경로', '저장', '공유'],
    sections: ['개요', '메뉴', '정보'],
    searchChrome: 'pill',
    controlShape: 'round',
    actionShape: 'circle',
    rowLayout: 'stacked',
    markerShape: 'teardrop',
    headingAffordance: 'none',
  },
  naver: {
    appName: '네이버 지도',
    tabLabel: '네이버',
    logo: naverLogo,
    actions: ['저장', '길찾기', '공유'],
    sections: ['홈', '메뉴', '정보'],
    searchChrome: 'panel',
    controlShape: 'column',
    actionShape: 'squircle',
    rowLayout: 'split',
    markerShape: 'balloon',
    headingAffordance: 'more',
  },
  kakao: {
    appName: '카카오맵',
    tabLabel: '카카오',
    logo: kakaoLogo,
    actions: ['길찾기', '공유'],
    sections: ['정보', '메뉴'],
    searchChrome: 'bar',
    controlShape: 'square',
    actionShape: 'bar',
    rowLayout: 'block',
    markerShape: 'droplet',
    headingAffordance: 'close',
  },
};

/** Sheet subtitle derived from the real change set; never an invented place attribute. */
export function sheetMetaMessage(showProposed: boolean, changeCount: number): string {
  return showProposed ? `이번에 업데이트된 정보 ${changeCount}개` : '변경 전 정보';
}

export function notAppliedMessage(status: PreviewPlatformStatus): string {
  if (status === 'FAIL') return '이 플랫폼은 반영에 실패해 변경 전 정보가 그대로 보여요.';
  return '이 플랫폼은 아직 반영 중이에요. 반영이 끝나면 변경된 정보를 보여드려요.';
}
