import { z } from 'zod';
import {
  contentStatusSchema,
  identifierSchema,
  nonEmptyTextSchema,
  platformSchema,
  syncJobStatusSchema,
} from '@/services/contracts/common';

const requiredPlatforms = new Set(['google', 'naver', 'kakao']);
const hasAllPlatforms = (platforms: readonly string[]): boolean =>
  platforms.length === requiredPlatforms.size && platforms.every((platform) => requiredPlatforms.has(platform));

const seoDraftSchema = z.strictObject({
  draftId: identifierSchema,
  platform: platformSchema,
  draftText: nonEmptyTextSchema.max(750),
  keywords: z.array(nonEmptyTextSchema.max(30)).min(1).max(10),
  contentRules: z.array(nonEmptyTextSchema),
});

export const seoGenerationResponseSchema = z.strictObject({
  generationId: identifierSchema,
  status: contentStatusSchema,
  revision: z.number().int().min(1),
  drafts: z.array(seoDraftSchema).length(3),
}).refine(({ drafts }) => hasAllPlatforms(drafts.map(({ platform }) => platform)), {
  message: 'drafts must contain each supported platform exactly once',
});

export const seoApprovalResponseSchema = z.strictObject({
  generationId: identifierSchema,
  generationStatus: z.literal('APPROVED'),
  approvedPlatforms: z.array(platformSchema).length(3),
  syncJobId: identifierSchema,
  status: syncJobStatusSchema,
  statusUrl: nonEmptyTextSchema,
}).refine(({ approvedPlatforms }) => hasAllPlatforms(approvedPlatforms), {
  message: 'approvedPlatforms must contain each supported platform exactly once',
});
