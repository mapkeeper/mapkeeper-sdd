import { z } from 'zod';
import {
  identifierSchema,
  nonEmptyTextSchema,
  platformSchema,
  platformTaskStatusSchema,
  syncJobStatusSchema,
} from '@/services/contracts/common';

const retryableErrorCodes = new Set(['API_TIMEOUT', 'RATE_LIMITED', 'PLATFORM_SERVER_ERROR']);
const platformErrorCodeSchema = z.enum([
  'API_TIMEOUT',
  'RATE_LIMITED',
  'PLATFORM_SERVER_ERROR',
  'AUTHENTICATION_ERROR',
  'PERMISSION_DENIED',
  'PLATFORM_VALIDATION_ERROR',
]);

const platformTaskErrorSchema = z.strictObject({
  code: platformErrorCodeSchema,
  message: z.string(),
  retryable: z.boolean(),
  platform: platformSchema,
}).refine(({ code, retryable }) => retryable === retryableErrorCodes.has(code), {
  message: 'retryable does not match the platform error code',
});

const platformTaskSchema = z.strictObject({
  platform: platformSchema,
  status: platformTaskStatusSchema,
  attemptCount: z.number().int().min(0).max(3),
  error: platformTaskErrorSchema.nullable(),
}).refine(({ error, platform }) => error === null || error.platform === platform, {
  message: 'error platform must match task platform',
});

export const syncJobResponseSchema = z.strictObject({
  syncJobId: identifierSchema,
  status: syncJobStatusSchema,
  platformTasks: z.array(platformTaskSchema).length(3),
}).refine(({ platformTasks }) => new Set(platformTasks.map(({ platform }) => platform)).size === 3, {
  message: 'platformTasks must contain each supported platform exactly once',
});

export const retrySyncJobResponseSchema = z.strictObject({
  syncJobId: identifierSchema,
  status: syncJobStatusSchema,
  retryingPlatforms: z.array(platformSchema).min(1).max(3),
  statusUrl: nonEmptyTextSchema,
}).refine(({ retryingPlatforms }) => new Set(retryingPlatforms).size === retryingPlatforms.length, {
  message: 'retryingPlatforms must not contain duplicates',
});
