import type { Platform } from '@/services/contracts/common';

// UI-only local state, not part of any v0.2 API contract shape.
export type VoiceUiState = 'IDLE' | 'LISTENING' | 'RECOGNIZED' | 'FAILED';

export interface StoreProfile {
  id: string;
  storeName: string;
  publicAddress: string;
  businessHours: string;
  representativeMenuName: string;
  representativePhone: string;
  platformAccountRefs: Partial<Record<Platform, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface SourceReview {
  id: string;
  storeProfileId: string;
  bodyMasked: string;
  createdAt: string;
}

export interface ReviewSummary {
  summary: string;
  keywords: string[];
  reviewCount: number;
}
