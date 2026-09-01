export const PLATFORMS = ['google', 'naver', 'kakao'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PROPOSAL_FIELDS = [
  'businessHours',
  'temporaryClosure',
  'representativeMenuName',
  'parkingInfo',
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
  | 'MALFORMED_REQUEST'
  | 'VALIDATION_ERROR'
  | 'RESOURCE_NOT_FOUND'
  | 'INVALID_STATE'
  | 'STALE_PROPOSAL'
  | 'IDEMPOTENCY_CONFLICT'
  | 'NO_RETRYABLE_TASKS'
  | 'REQUEST_RATE_LIMITED'
  | 'API_TIMEOUT'
  | 'PERMISSION_DENIED'
  | 'RATE_LIMITED'
  | 'PLATFORM_SERVER_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PLATFORM_VALIDATION_ERROR'
  | 'INTERNAL_SERVER_ERROR';
export type EnvelopeStatus = 'SUCCESS' | 'PROCESSING' | 'FAILED';

/**
 * Why one store-change request was refused.
 *
 * The error code says which contract rule broke; this says what the owner has to
 * change about what they said. Without it the screen can only ever show the same
 * retry box, so "몇 시인지 말씀해 주세요" and "메뉴를 하나만 말씀해 주세요" looked
 * identical to the person who had to act on them.
 */
export const PROPOSAL_FAILURE_REASONS = [
  'AMBIGUOUS_TIME',
  'AMBIGUOUS_DATE',
  'UNREADABLE_DATE_RANGE',
  'INVALID_DATE',
  'MULTIPLE_MENU_CANDIDATES',
  'UNSUPPORTED_FIELD',
  'NO_CHANGE_FOUND',
  'NO_EFFECTIVE_CHANGE',
] as const;
export type ProposalFailureReason = (typeof PROPOSAL_FAILURE_REASONS)[number];

export interface ProposalFailure {
  reason: ProposalFailureReason;
  message: string;
  guidance: string;
  retry: string;
  examples: string[];
  /** The submitted sentence, masked - what the retry box is refilled with. */
  recognizedTextMasked: string | null;
}

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
  /** Field labels the request named that the proposal does not cover. */
  unmappedRequests: string[];
}

export interface SeoDraft {
  draftId: string;
  platform: Platform;
  draftText: string;
  keywords: string[];
  contentRules: string[];
  status?: ContentStatus;
}

export interface PlatformTaskError {
  code: Extract<
    ErrorCode,
    | 'API_TIMEOUT'
    | 'RATE_LIMITED'
    | 'PLATFORM_SERVER_ERROR'
    | 'AUTHENTICATION_ERROR'
    | 'PERMISSION_DENIED'
    | 'PLATFORM_VALIDATION_ERROR'
  >;
  message: string;
  retryable: boolean;
  platform: Platform;
}

export interface PlatformTaskDetail {
  status: PlatformTaskStatus;
  attemptCount: number;
  error: PlatformTaskError | null;
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
  platformDetails: Record<Platform, PlatformTaskDetail>;
  summary: SyncSummary;
}
