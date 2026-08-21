import type { Platform } from '@/types/domain';

export interface PlatformConnection {
  id: Platform;
  name: string;
  logo: string;
  status: 'connected' | 'attention';
}

export type NotificationCategory = 'review' | 'sync' | 'promo';

export type NotificationPrefs = Record<NotificationCategory, boolean>;

/** Where tapping a notification takes the owner to see what it is about. */
export type NotificationTarget = 'REVIEW' | 'SEO' | 'HISTORY';

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  time: string;
  unread: boolean;
  target: NotificationTarget;
}

export type HistoryEntryType = 'STORE_CHANGE' | 'SEO';

export interface HistoryEntry {
  id: string;
  type: HistoryEntryType;
  title: string;
  detail: string;
  time: string;
}
