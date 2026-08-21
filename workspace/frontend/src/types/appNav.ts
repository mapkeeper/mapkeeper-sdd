import type { Platform } from '@/types/domain';

export interface PlatformConnection {
  id: Platform;
  name: string;
  logo: string;
  status: 'connected' | 'attention';
}

export type NotificationCategory = 'review' | 'sync' | 'promo';

export type NotificationPrefs = Record<NotificationCategory, boolean>;

export interface AppNotification {
  id: string;
  category: NotificationCategory;
  title: string;
  time: string;
  unread: boolean;
}

export type HistoryEntryType = 'STORE_CHANGE' | 'SEO';

export interface HistoryEntry {
  id: string;
  type: HistoryEntryType;
  title: string;
  detail: string;
  time: string;
}
