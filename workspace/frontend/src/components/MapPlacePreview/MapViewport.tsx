import type { ReactNode } from 'react';
import { CaretLeft, MagnifyingGlass, NavigationArrow, StackSimple } from '@phosphor-icons/react';
import type { Platform } from '@/types/domain';
import { PLATFORM_SKINS } from './mapPreviewContent';

// Decorative map geometry only. Roads, blocks, parks and the marker are
// abstract shapes: no place names, addresses or coordinates are drawn.
const MINOR_ROADS = ['M-6 58H366', 'M92 -6V226', 'M-6 206L110 128L230 148L366 96'];
const MAJOR_ROADS = ['M-6 150H366', 'M250 -6V92C250 138 268 170 306 190L366 216'];
const BLOCKS = [
  [16, 18, 54, 26], [110, 16, 48, 28], [228, 18, 44, 24],
  [16, 74, 56, 32], [104, 78, 28, 24], [268, 66, 60, 30],
  [278, 112, 54, 26], [30, 162, 50, 20], [140, 160, 60, 18], [214, 168, 46, 16],
] as const;

function MapSurface() {
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
      <path className="map-surface__pin" d="M180 78c-9.4 0-17 7.6-17 17 0 12.4 17 33 17 33s17-20.6 17-33c0-9.4-7.6-17-17-17z" />
      <circle className="map-surface__pin-dot" cx="180" cy="95" r="6" />
    </svg>
  );
}

interface MapViewportProps {
  platform: Platform;
  storeName: string;
  children: ReactNode;
}

/**
 * Reconstructed map app viewport: drawn map surface plus search and control
 * chrome, with the place sheet overlapping it. Nothing here is an external map
 * embed and no place data beyond the real store name is rendered.
 */
export function MapViewport({ platform, storeName, children }: MapViewportProps) {
  const skin = PLATFORM_SKINS[platform];
  return (
    <div className="map-viewport" data-platform={platform}>
      <div className="map-viewport__screen">
        <div className="map-viewport__surface" aria-hidden="true">
          <MapSurface />
        </div>
        <div className="map-viewport__chrome" aria-hidden="true">
          <div className="map-viewport__search">
            <CaretLeft weight="bold" />
            <MagnifyingGlass />
            <span className="map-viewport__query">{storeName}</span>
            <img className="map-viewport__avatar" src={skin.logo} alt="" />
          </div>
          <div className="map-viewport__controls">
            <span><StackSimple /></span>
            <span><NavigationArrow weight="fill" /></span>
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}
