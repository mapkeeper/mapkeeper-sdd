import {
  BookmarkSimple, CalendarX, Car, Clock, ForkKnife, NavigationArrow, ShareNetwork, type Icon,
} from '@phosphor-icons/react';
import type { Platform, ProposalChange, ProposalField } from '@/types/domain';
import { PLATFORM_SKINS, PREVIEW_FIELD_LABELS, sheetMetaMessage } from './mapPreviewContent';

const fieldIcons: Record<ProposalField, Icon> = {
  businessHours: Clock,
  temporaryClosure: CalendarX,
  representativeMenuName: ForkKnife,
  parkingInfo: Car,
};

// Decorative action chrome; labels come from each app's place detail screen.
const actionIcons: Record<string, Icon> = {
  경로: NavigationArrow,
  길찾기: NavigationArrow,
  저장: BookmarkSimple,
  공유: ShareNetwork,
};

interface PlaceDetailCardProps {
  platform: Platform;
  storeName: string;
  changes: ProposalChange[];
  showProposed: boolean;
}

export function PlaceDetailCard({ platform, storeName, changes, showProposed }: PlaceDetailCardProps) {
  const skin = PLATFORM_SKINS[platform];
  return (
    <article className="place-card" data-platform={platform} aria-label={`${skin.appName} 장소 정보 미리보기`}>
      <div className="place-card__grabber" aria-hidden="true" />
      <div className="place-card__heading">
        <h3 className="place-card__title">{storeName}</h3>
        <p className="place-card__meta">{sheetMetaMessage(showProposed, changes.length)}</p>
      </div>
      <div className="place-card__actions" aria-hidden="true">
        {skin.actions.map((action, index) => {
          const ActionIcon = actionIcons[action] ?? NavigationArrow;
          return (
            <span key={action} className={index === 0 ? 'place-card__action is-primary' : 'place-card__action'}>
              <ActionIcon weight={index === 0 ? 'fill' : 'regular'} />
              <em>{action}</em>
            </span>
          );
        })}
      </div>
      <div className="place-card__sections" aria-hidden="true">
        {skin.sections.map((section, index) => <span key={section} className={index === 0 ? 'is-active' : undefined}>{section}</span>)}
      </div>
      <dl className="place-card__rows">
        {changes.map((change) => {
          const FieldIcon = fieldIcons[change.field];
          const value = showProposed ? change.proposedValue : change.currentValue;
          return (
            <div key={change.field} className={showProposed ? 'place-card__row is-changed' : 'place-card__row'}>
              <FieldIcon aria-hidden />
              <dt>{PREVIEW_FIELD_LABELS[change.field]}</dt>
              <dd>
                <span>{value || '등록된 정보 없음'}</span>
                {showProposed ? <em className="place-card__badge">변경됨</em> : null}
              </dd>
            </div>
          );
        })}
      </dl>
    </article>
  );
}
