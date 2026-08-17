import { z } from 'zod';

export const platformSchema = z.enum(['google', 'naver', 'kakao']);
export const envelopeStatusSchema = z.enum(['SUCCESS', 'PROCESSING', 'FAILED']);
export const proposalStatusSchema = z.enum(['DRAFT', 'APPROVED', 'REJECTED']);
export const contentStatusSchema = z.enum(['DRAFT', 'APPROVED', 'REJECTED']);
export const syncJobStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'PARTIAL_SUCCESS',
  'SUCCESS',
  'FAILED',
  'RETRYING',
]);
export const platformTaskStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'SUCCESS',
  'FAILED',
  'RETRYING',
]);

export const apiErrorCodeSchema = z.enum([
  'MALFORMED_REQUEST',
  'VALIDATION_ERROR',
  'RESOURCE_NOT_FOUND',
  'INVALID_STATE',
  'STALE_PROPOSAL',
  'IDEMPOTENCY_CONFLICT',
  'NO_RETRYABLE_TASKS',
  'REQUEST_RATE_LIMITED',
  'INTERNAL_SERVER_ERROR',
]);

export const validationDetailSchema = z.strictObject({
  field: z.string(),
  reason: z.string(),
});

export const apiErrorSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string(),
  details: z.array(validationDetailSchema).default([]),
  retryable: z.boolean().nullable().default(null),
});

export const apiEnvelopeSchema = z.strictObject({
  success: z.boolean(),
  status: envelopeStatusSchema,
  data: z.unknown().nullable(),
  error: apiErrorSchema.nullable(),
  timestamp: z.iso.datetime({ offset: true }),
}).superRefine((value, context) => {
  const validSuccess = value.success && value.data !== null && value.error === null;
  const validFailure = !value.success && value.data === null && value.error !== null;
  if (!validSuccess && !validFailure) {
    context.addIssue({ code: 'custom', message: 'invalid API envelope result shape' });
  }
});

export const identifierSchema = z.string().trim().min(1);
export const nonEmptyTextSchema = z.string().trim().min(1);
