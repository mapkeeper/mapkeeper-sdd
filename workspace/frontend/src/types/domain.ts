export const PLATFORMS = ['google', 'naver', 'kakao'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PROPOSAL_FIELDS = [
  'businessHours',
  'temporaryClosure',
  'representativeMenuName',
] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

export type VoiceUiState = 'IDLE' | 'LISTENING' | 'RECOGNIZED' | 'FAILED';
export type ProposalStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';
export type ContentStatus = 'DRAFT' | 'APPROVED' | 'REJECTED';
export type SyncJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PARTIAL_SUCCESS'
  | 'SUCCESS'
  | 'FAILED'
  | 'RETRYING';
export type PlatformTaskStatus = 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'FAILED' | 'RETRYING';
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'INVALID_STATE'
  | 'API_TIMEOUT'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'INTERNAL_SERVER_ERROR';
export type EnvelopeStatus = 'SUCCESS' | 'PROCESSING' | 'PARTIAL_SUCCESS' | 'FAILED';

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

export interface ProposalChange {
  field: ProposalField;
  currentValue: string;
  proposedValue: string;
}

export interface StoreChangeProposal {
  proposalId: string;
  recognizedTextMasked?: string;
  changes: ProposalChange[];
  status: ProposalStatus;
}

export interface SeoDraft {
  draftId: string;
  platform: Platform;
  draftText: string;
  contentRules: string[];
  status?: ContentStatus;
}

export interface SyncSummary {
  total: number;
  succeeded: number;
  failed: number;
  retrying: number;
}

export interface SyncJob {
  syncJobId: string;
  status: SyncJobStatus;
  platforms: Record<Platform, PlatformTaskStatus>;
  summary: SyncSummary;
}
