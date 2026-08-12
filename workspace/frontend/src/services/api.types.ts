import type {
  EnvelopeStatus,
  ErrorCode,
  ProposalChange,
  SeoDraft,
  StoreChangeProposal,
  Platform,
  ReviewSummary,
  SourceReview,
  SyncJobStatus,
} from '@/types/domain';

export interface ValidationDetail {
  field: string;
  reason: string;
}

export interface ApiErrorBody {
  code: ErrorCode;
  message: string;
  details?: ValidationDetail[];
  retryable?: boolean;
}

export interface ApiEnvelope<T> {
  success: boolean;
  status: EnvelopeStatus;
  data: T | null;
  error: ApiErrorBody | null;
  timestamp: string;
}

export interface CreateStoreChangeRequest {
  storeProfileId: string;
  recognizedText: string;
  locale: string;
}
export type CreateStoreChangeResponse = StoreChangeProposal & { recognizedTextMasked: string };
export interface PatchStoreChangeRequest { changes: ProposalChange[] }
export type PatchStoreChangeResponse = StoreChangeProposal;
export interface StoreChangeApprovalResponse {
  proposalId: string;
  syncJobId: string;
  statusUrl: string;
}

export interface CreateSeoGenerationRequest {
  storeProfileId: string;
  briefText: string;
  seedKeywords: string[];
  sourceReviewIds: string[];
}
export interface CreateSeoGenerationResponse { generationId: string; drafts: SeoDraft[] }
export interface GetReviewSummaryResponse extends ReviewSummary {
  storeProfileId: string;
  sourceReviews: SourceReview[];
}
export interface SeoApprovalResponse {
  generationId: string;
  generationStatus: 'APPROVED';
  approvedPlatforms: Platform[];
  syncJobId: string;
  status: SyncJobStatus;
  statusUrl: string;
}
export type PlatformTaskErrorCode =
  | 'API_TIMEOUT'
  | 'RATE_LIMITED'
  | 'PLATFORM_SERVER_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'PERMISSION_DENIED'
  | 'PLATFORM_VALIDATION_ERROR';
export interface PlatformTaskError {
  code: PlatformTaskErrorCode;
  message: string;
  retryable: boolean;
  platform: Platform;
}
export interface PlatformTaskResponse {
  platform: Platform;
  status: Exclude<SyncJobStatus, 'PARTIAL_SUCCESS'>;
  attemptCount: number;
  error: PlatformTaskError | null;
}
export interface GetSyncJobResponse {
  syncJobId: string;
  status: SyncJobStatus;
  platformTasks: PlatformTaskResponse[];
}
export interface RetrySyncJobResponse { syncJobId: string; retryingPlatforms: Platform[] }

export interface ApiResult<T> {
  data: T;
  status: EnvelopeStatus;
  timestamp: string;
  requestId: string | null;
  warning: ApiErrorBody | null;
}
