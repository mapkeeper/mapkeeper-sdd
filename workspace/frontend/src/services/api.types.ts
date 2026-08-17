import type {
  EnvelopeStatus,
  ErrorCode,
  PlatformTaskError,
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
  retryable?: boolean | null;
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
export interface BusinessHoursValue { open: string; close: string }
export interface TemporaryClosureValue { startDate: string; endDate: string }
export type ProposalChangeRequest =
  | { field: 'businessHours'; currentValue: BusinessHoursValue; proposedValue: BusinessHoursValue }
  | { field: 'temporaryClosure'; currentValue: TemporaryClosureValue | null; proposedValue: TemporaryClosureValue }
  | { field: 'representativeMenuName'; currentValue: string; proposedValue: string };
export interface PatchStoreChangeRequest { changes: ProposalChangeRequest[] }
export type PatchStoreChangeResponse = StoreChangeProposal;
export interface StoreChangeApprovalResponse {
  proposalId: string;
  proposalStatus: 'APPROVED';
  syncJobId: string;
  status: SyncJobStatus;
  statusUrl: string;
}

export interface CreateSeoGenerationRequest {
  storeProfileId: string;
  purpose: 'INTRODUCTION' | 'NEWS';
  briefText: string;
  seedKeywords: string[];
  sourceReviewIds: string[];
}
export interface CreateSeoGenerationResponse {
  generationId: string;
  status: 'DRAFT' | 'APPROVED' | 'REJECTED';
  revision: number;
  drafts: SeoDraft[];
}
export type RegenerateSeoGenerationRequest = Omit<CreateSeoGenerationRequest, 'storeProfileId'>;
export type RegenerateSeoGenerationResponse = CreateSeoGenerationResponse;
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
export type { PlatformTaskError } from '@/types/domain';
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
export interface RetrySyncJobResponse {
  syncJobId: string;
  status: SyncJobStatus;
  retryingPlatforms: Platform[];
  statusUrl: string;
}

export interface ApiResult<T> {
  data: T;
  status: EnvelopeStatus;
  timestamp: string;
  requestId: string | null;
  warning: ApiErrorBody | null;
}
