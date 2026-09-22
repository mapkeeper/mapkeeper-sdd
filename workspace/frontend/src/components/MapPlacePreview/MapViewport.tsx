import type { ReactNode } from 'react';
import {
  CaretLeft, Compass, CrosshairSimple, GpsFix, MagnifyingGlass, Minus,
  NavigationArrow, Plus, StackSimple, X, type Icon,
} from '@phosphor-icons/react';
import type { Platform } from '@/types/domain';
import { PLATFORM_SKINS, type PreviewMarkerShape } from './mapPreviewContent';

// Decorative map geometry only. Roads, blocks, parks and the marker are
// abstract shapes: no place names, addresses or coordinates are drawn.
const MINOR_ROADS = ['M-6 58H366', 'M92 -6V226', 'M-6 206L110 128L230 148L366 96'];
const MAJOR_ROADS = ['M-6 150H366', 'M250 -6V92C250 138 268 170 306 190L366 216'];
const BLOCKS = [
  [16, 18, 54, 26], [110, 16, 48, 28], [228, 18, 44, 24],
  [16, 74, 56, 32], [104, 78, 28, 24], [268, 66, 60, 30],
  [278, 112, 54, 26], [30, 162, 50, 20], [140, 160, 60, 18], [214, 168, 46, 16],
] as const;

// Each app draws its own marker silhouette: Google's narrow teardrop, Naver's
// rounded speech-balloon, Kakao's round-headed droplet.
const MARKER_PATHS: Record<PreviewMarkerShape, string> = {
  teardrop: 'M180 74c-10 0-18 8-18 18 0 13 18 34 18 34s18-21 18-34c0-10-8-18-18-18z',
  balloon: 'M164 70h32a13 13 0 0 1 13 13v17a13 13 0 0 1-13 13h-9l-7 13-7-13h-9a13 13 0 0 1-13-13V83a13 13 0 0 1 13-13z',
  droplet: 'M180 68a20 20 0 0 1 20 20c0 9-6 15-13 21l-7 19-7-19c-7-6-13-12-13-21a20 20 0 0 1 20-20z',
};
const MARKER_DOT: Record<PreviewMarkerShape, { cy: number; r: number }> = {
  teardrop: { cy: 92, r: 6 },
  balloon: { cy: 92, r: 5.5 },
  droplet: { cy: 88, r: 7 },
};

function MapSurface({ marker }: { marker: PreviewMarkerShape }) {
  const dot = MARKER_DOT[marker];
  return (
    <svg className="map-surface" viewBox="0 0 360 220" preserveAspectRatio="xMidYMid slice" focusable="false">
      <rect className="map-surface__land" x="0" y="0" width="360" height="220" />
      <path className="map-surface__water" d="M296 0H360v56c-28-6-54-26-64-56z" />
      <rect className="map-surface__park" x="12" y="108" width="64" height="36" rx="8" />
      <rect className="map-surface__park" x="300" y="160" width="60" height="44" rx="10" />
      {BLOCKS.map(([x, y, width, height]) => (
        <rect key={`${x}-${y}`} className="map-surface__block" x={x} y={y} width={width} height={height} rx="3" />
      ))}
      <g className="map-surface__casing" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {MAJOR_ROADS.map((d) => <path key={d} d={d} strokeWidth="17" />)}
        {MINOR_ROADS.map((d) => <path key={d} d={d} strokeWidth="11" />)}
      </g>
      <g className="map-surface__road" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {MAJOR_ROADS.map((d) => <path key={d} className="map-surface__road--major" d={d} strokeWidth="13" />)}
        {MINOR_ROADS.map((d) => <path key={d} d={d} strokeWidth="8" />)}
      </g>
      <ellipse className="map-surface__pin-shadow" cx="180" cy="130" rx="10" ry="3.4" />
      <path className="map-surface__pin" data-marker={marker} d={MARKER_PATHS[marker]} />
      <circle className="map-surface__pin-dot" cx="180" cy={dot.cy} r={dot.r} />
    </svg>
  );
}

// Map control clusters differ per app: Google floats two circles, Naver groups
// its controls into one hairline-divided column, Kakao stacks square buttons.
const CONTROL_ICONS: Record<Platform, Icon[]> = {
  google: [StackSimple, NavigationArrow],
  naver: [StackSimple, Compass, CrosshairSimple],
  kakao: [Plus, Minus, GpsFix],
};

function MapControls({ platform }: { platform: Platform }) {
  const { controlShape } = PLATFORM_SKINS[platform];
  return (
    <div className="map-viewport__controls" data-controls={controlShape}>
      {CONTROL_ICONS[platform].map((ControlIcon, index) => (
        <span key={index} className="map-viewport__control">
          <ControlIcon weight={controlShape === 'round' && index === 1 ? 'fill' : 'regular'} />
        </span>
      ))}
    </div>
  );
}

interface ChromeProps {
  platform: Platform;
  storeName: string;
}

/** Google: one floating rounded-pill search field with an account avatar. */
function GoogleSearch({ platform, storeName }: ChromeProps) {
  return (
    <div className="map-viewport__search" data-search="pill">
      <CaretLeft weight="bold" />
      <span className="map-viewport__query">{storeName}</span>
      <X />
      <img className="map-viewport__avatar" src={PLATFORM_SKINS[platform].logo} alt="" />
    </div>
  );
}

/** Naver: a square back chip beside a floating panel with a filled search button. */
function NaverSearch({ storeName }: ChromeProps) {
  return (
    <div className="map-viewport__searchbar">
      <span className="map-viewport__back"><CaretLeft weight="bold" /></span>
      <div className="map-viewport__search" data-search="panel">
        <span className="map-viewport__query">{storeName}</span>
        <span className="map-viewport__search-button"><MagnifyingGlass weight="bold" /></span>
      </div>
    </div>
  );
}

/** Kakao: a flush top bar pinned to the screen edge, with a trailing search icon. */
function KakaoSearch({ storeName }: ChromeProps) {
  return (
    <div className="map-viewport__search" data-search="bar">
      <CaretLeft weight="bold" />
      <span className="map-viewport__query">{storeName}</span>
      <X />
      <span className="map-viewport__search-button"><MagnifyingGlass weight="bold" /></span>
    </div>
  );
}

const SEARCH_CHROME: Record<Platform, (props: ChromeProps) => ReactNode> = {
  google: GoogleSearch,
  naver: NaverSearch,
  kakao: KakaoSearch,
};

interface MapViewportProps {
  platform: Platform;
  storeName: string;
  children: ReactNode;
}

/**
 * Reconstructed map app viewport: drawn map surface plus platform-specific
 * search and control chrome, with the place sheet overlapping it. Nothing here
 * is an external map embed and no place data beyond the real store name is
 * rendered.
 */
export function MapViewport({ platform, storeName, children }: MapViewportProps) {
  const skin = PLATFORM_SKINS[platform];
  const SearchChrome = SEARCH_CHROME[platform];
  return (
    <div className="map-viewport" data-platform={platform}>
      <div className="map-viewport__screen">
        <div className="map-viewport__surface" aria-hidden="true">
          <MapSurface marker={skin.markerShape} />
        </div>
        <div className="map-viewport__chrome" data-chrome={skin.searchChrome} aria-hidden="true">
          <SearchChrome platform={platform} storeName={storeName} />
          <MapControls platform={platform} />
          {skin.searchChrome === 'pill' ? (
            <img className="map-viewport__attribution" src={skin.logo} alt="" />
          ) : null}
          {skin.searchChrome === 'bar' ? <span className="map-viewport__scale" /> : null}
        </div>
      </div>
      {children}
    </div>
  );
}
