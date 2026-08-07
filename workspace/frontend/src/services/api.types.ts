// Stable, named re-export surface over the strict v0.2 contract types (Todo 5): every
// type here is inferred from a Zod schema in `@/services/contracts/*`, never redeclared.
export type { ApiEnvelope, ApiError, ApiStatus, ParsedApiResult } from '@/services/contracts/common';
export type {
  CreateStoreChangeRequest,
  CreateStoreChangeResponse,
  PatchStoreChangeRequest,
  PatchStoreChangeResponse,
  RejectStoreChangeResponse,
  StoreChangeApprovalResponse,
  StoreChangeProposalData,
  ProposalChange,
} from '@/services/contracts/storeChange';
export type {
  ContentGenerationData,
  CreateSeoGenerationRequest,
  RegenerateSeoGenerationRequest,
  ApproveSeoGenerationResponse,
  LocalSeoContent,
} from '@/services/contracts/seo';
export type { GetSyncJobResponse, RetrySyncJobResponse, PlatformSyncTask } from '@/services/contracts/syncJob';
