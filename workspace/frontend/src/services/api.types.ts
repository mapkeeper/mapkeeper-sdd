import type {
  EnvelopeStatus,
  ErrorCode,
  ProposalChange,
  SeoDraft,
  StoreChangeProposal,
  SyncJob,
  Platform,
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
  sourceReviewIds: string[];
}
export interface CreateSeoGenerationResponse { generationId: string; drafts: SeoDraft[] }
export interface PatchSeoDraftRequest { draftText: string }
export interface PatchSeoDraftResponse { draftId: string; status: 'DRAFT'; draftText: string }
export interface ApproveSeoGenerationRequest { draftIds: string[] }
export interface SeoApprovalResponse { generationId: string; syncJobId: string; statusUrl: string }
export type GetSyncJobResponse = SyncJob;
export interface RetrySyncJobResponse { syncJobId: string; retryingPlatforms: Platform[] }

export interface ApiResult<T> {
  data: T;
  status: EnvelopeStatus;
  timestamp: string;
  requestId: string | null;
  warning: ApiErrorBody | null;
}
