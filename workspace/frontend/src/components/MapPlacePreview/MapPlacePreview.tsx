import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { Platform, ProposalChange } from '@/types/domain';
import { MapViewport } from './MapViewport';
import { PlaceDetailCard } from './PlaceDetailCard';
import {
  MAP_PREVIEW_DISCLAIMER,
  MAP_PREVIEW_FALLBACK_STORE_NAME,
  notAppliedMessage,
  PLATFORM_SKINS,
  PREVIEW_STATUS_LABELS,
  type PreviewMode,
  type PreviewPlatform,
} from './mapPreviewContent';
import './MapPlacePreview.css';

export interface MapPlacePreviewProps {
  platforms: PreviewPlatform[];
  changes: ProposalChange[];
  initialPlatform?: Platform;
  storeName?: string | undefined;
}

export function MapPlacePreview({ platforms, changes, initialPlatform, storeName }: MapPlacePreviewProps) {
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<Platform, HTMLButtonElement | null>>>({});
  const [selectedId, setSelectedId] = useState<Platform | undefined>(initialPlatform ?? platforms[0]?.id);
  const [mode, setMode] = useState<PreviewMode>('after');

  const selected = platforms.find(({ id }) => id === selectedId) ?? platforms[0];
  if (!selected || changes.length === 0) return null;

  const isApplied = selected.status === 'SUCCESS';
  const showProposed = mode === 'after' && isApplied;
  const displayName = storeName?.trim() || MAP_PREVIEW_FALLBACK_STORE_NAME;

  const selectByOffset = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = platforms.findIndex(({ id }) => id === selected.id);
    const targets: Record<string, number> = {
      ArrowRight: (index + 1) % platforms.length,
      ArrowLeft: (index - 1 + platforms.length) % platforms.length,
      Home: 0,
      End: platforms.length - 1,
    };
    const nextIndex = targets[event.key];
    const nextId = nextIndex === undefined ? undefined : platforms[nextIndex]?.id;
    if (!nextId) return;
    event.preventDefault();
    setSelectedId(nextId);
    tabRefs.current[nextId]?.focus();
  };

  return (
    <div className="map-preview" role="region" aria-labelledby={`${baseId}-title`}>
      <div className="map-preview__header">
        <h3 id={`${baseId}-title`}>지도 화면 미리보기</h3>
        <p className="map-preview__disclaimer">{MAP_PREVIEW_DISCLAIMER}</p>
      </div>

      <div className="map-preview__platforms" role="tablist" aria-label="미리볼 지도 플랫폼">
        {platforms.map(({ id, status }) => {
          const isSelected = id === selected.id;
          return (
            <button
              key={id}
              ref={(element) => { tabRefs.current[id] = element; }}
              id={`${baseId}-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${baseId}-panel`}
              tabIndex={isSelected ? 0 : -1}
              className="map-preview__platform"
              data-status={status.toLowerCase()}
              onClick={() => setSelectedId(id)}
              onKeyDown={selectByOffset}
            >
              <img src={PLATFORM_SKINS[id].logo} alt="" aria-hidden="true" />
              <span>{PLATFORM_SKINS[id].tabLabel}</span>
              <small>{PREVIEW_STATUS_LABELS[status]}</small>
            </button>
          );
        })}
      </div>

      <div className="map-preview__modes" role="group" aria-label="변경 전후 보기">
        <button type="button" className="map-preview__mode" aria-pressed={mode === 'before'} onClick={() => setMode('before')}>Before · 변경 전</button>
        <button type="button" className="map-preview__mode" aria-pressed={mode === 'after'} onClick={() => setMode('after')}>After · 변경 후</button>
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${selected.id}`} className="map-preview__panel">
        {mode === 'after' && !isApplied ? <p className="map-preview__notice" role="status">{notAppliedMessage(selected.status)}</p> : null}
        <MapViewport platform={selected.id} storeName={displayName}>
          <PlaceDetailCard platform={selected.id} storeName={displayName} changes={changes} showProposed={showProposed} />
        </MapViewport>
      </div>
    </div>
  );
}
