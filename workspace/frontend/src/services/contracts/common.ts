import { z } from 'zod';

export const PLATFORMS = ['google', 'naver', 'kakao'] as const;
export const platformSchema = z.enum(PLATFORMS);
export type Platform = z.infer<typeof platformSchema>;

export const proposalStatusSchema = z.enum(['DRAFT', 'APPROVED', 'REJECTED']);
export type ProposalStatus = z.infer<typeof proposalStatusSchema>;

export const contentGenerationStatusSchema = z.enum(['DRAFT', 'APPROVED', 'REJECTED']);
export type ContentGenerationStatus = z.infer<typeof contentGenerationStatusSchema>;

export const syncJobStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'PARTIAL_SUCCESS',
  'SUCCESS',
  'FAILED',
  'RETRYING',
]);
export type SyncJobStatus = z.infer<typeof syncJobStatusSchema>;

export const platformSyncTaskStatusSchema = z.enum(['PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'RETRYING']);
export type PlatformSyncTaskStatus = z.infer<typeof platformSyncTaskStatusSchema>;

// Top-level API status is intentionally narrower than any domain status: PARTIAL_SUCCESS
// belongs only to SyncJobStatus and must never appear here (API Contract §1-2).
export const apiStatusSchema = z.enum(['SUCCESS', 'PROCESSING', 'FAILED']);
export type ApiStatus = z.infer<typeof apiStatusSchema>;

export const uuidSchema = z.uuid();
export const isoTimestampSchema = z.iso.datetime();
export const isoDateSchema = z.iso.date();
export const hhmmSchema = z.iso.time({ precision: -1 });

export const idempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);

export function trimmedText(min: number, max: number) {
  return z.string().trim().min(min).max(max);
}

function unique<T>(items: readonly T[]): boolean {
  return new Set(items).size === items.length;
}

export function uniqueArray<S extends z.ZodTypeAny>(arraySchema: z.ZodArray<S>, message: string) {
  return arraySchema.refine(unique, { message });
}

// Common API errors (`error`) and platform-task errors (`platformTasks[].error`) are
// disjoint code namespaces (API Contract §1, §7) so a value from one can never satisfy
// the other schema.
const API_ERROR_CODES = [
  'MALFORMED_REQUEST',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'INVALID_STATE',
  'STALE_PROPOSAL',
  'IDEMPOTENCY_CONFLICT',
  'NO_RETRYABLE_TASKS',
  'REQUEST_RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
] as const;
export const apiErrorCodeSchema = z.enum(API_ERROR_CODES);
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>;

const PLATFORM_TASK_ERROR_CODES = [
  'API_TIMEOUT',
  'RATE_LIMITED',
  'PLATFORM_SERVER_ERROR',
  'AUTHENTICATION_ERROR',
  'PERMISSION_DENIED',
  'PLATFORM_VALIDATION_ERROR',
] as const;
export const platformTaskErrorCodeSchema = z.enum(PLATFORM_TASK_ERROR_CODES);
export type PlatformTaskErrorCode = z.infer<typeof platformTaskErrorCodeSchema>;

export const validationDetailSchema = z.strictObject({
  field: z.string(),
  reason: z.string(),
});
export type ValidationDetail = z.infer<typeof validationDetailSchema>;

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.array(validationDetailSchema).optional(),
  retryable: z.boolean().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

export const platformTaskErrorSchema = z.strictObject({
  code: platformTaskErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  platform: platformSchema,
});
export type PlatformTaskError = z.infer<typeof platformTaskErrorSchema>;

export function apiEnvelopeSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.strictObject({
    success: z.boolean(),
    status: apiStatusSchema,
    data: dataSchema.nullable(),
    error: apiErrorSchema.nullable(),
    timestamp: isoTimestampSchema,
  });
}

// A concrete (non-generic) envelope shape used to validate the outer envelope - unknown
// keys, the SUCCESS|PROCESSING|FAILED-only status, and the error shape - independently
// of the caller's data schema. Keeping this non-generic avoids TypeScript's inference
// limits on nesting a generic schema factory inside another generic function.
export const apiEnvelopeShapeSchema = apiEnvelopeSchema(z.unknown());
export type ApiEnvelopeShape = z.infer<typeof apiEnvelopeShapeSchema>;

export interface ParsedApiResult<T> {
  data: T;
  status: ApiStatus;
  timestamp: string;
  requestId: string | null;
  warning: ApiError | null;
}
