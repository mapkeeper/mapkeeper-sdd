import { z } from 'zod';
import { platformSchema, platformSyncTaskStatusSchema, platformTaskErrorSchema, syncJobStatusSchema, uniqueArray, uuidSchema } from './common';

// `attemptCount` mirrors the DB CHECK(attemptCount BETWEEN 0 AND 3) constraint
// (Data Model §2 `PlatformSyncTask`).
export const platformSyncTaskSchema = z.strictObject({
  platform: platformSchema,
  status: platformSyncTaskStatusSchema,
  attemptCount: z.number().int().min(0).max(3),
  error: platformTaskErrorSchema.nullable(),
});
export type PlatformSyncTask = z.infer<typeof platformSyncTaskSchema>;
export type PlatformSyncTaskStatus = PlatformSyncTask['status'];

// `PARTIAL_SUCCESS` is valid only on the job-level `status`; PlatformSyncTaskStatus
// never allows it (API Contract §2, Data Model §1).
export const syncJobDataSchema = z
  .strictObject({
    syncJobId: uuidSchema,
    status: syncJobStatusSchema,
    platformTasks: z.array(platformSyncTaskSchema),
  })
  .refine((data) => new Set(data.platformTasks.map((task) => task.platform)).size === data.platformTasks.length, {
    message: 'platformTasks must not repeat a platform',
    path: ['platformTasks'],
  });
export type SyncJobData = z.infer<typeof syncJobDataSchema>;

export const getSyncJobResponseSchema = syncJobDataSchema;
export type GetSyncJobResponse = z.infer<typeof getSyncJobResponseSchema>;

export const retrySyncJobResponseSchema = z.strictObject({
  syncJobId: uuidSchema,
  status: z.literal('RETRYING'),
  retryingPlatforms: uniqueArray(
    z.array(platformSchema).min(1),
    'retryingPlatforms must not repeat a platform',
  ),
  statusUrl: z.string().trim().min(1),
});
export type RetrySyncJobResponse = z.infer<typeof retrySyncJobResponseSchema>;
