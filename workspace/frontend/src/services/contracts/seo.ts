import { z } from 'zod';
import { PLATFORMS, contentGenerationStatusSchema, platformSchema, trimmedText, uniqueArray, uuidSchema } from './common';

const seedKeywordSchema = trimmedText(1, 30);
const seedKeywordsSchema = z.array(seedKeywordSchema).min(1).max(5);

const sourceReviewIdsSchema = uniqueArray(
  z.array(uuidSchema).max(10),
  'sourceReviewIds must not contain duplicates',
);

// The part of the create/regenerate request that the user edits directly (API Contract
// §5). Shared so the UI, the create request, and the regenerate request enforce the same
// 500/5x30 limits from a single source of truth.
export const seoCommonInputSchema = z.strictObject({
  briefText: trimmedText(1, 500),
  seedKeywords: seedKeywordsSchema,
});
export type SeoCommonInput = z.infer<typeof seoCommonInputSchema>;

export const createSeoGenerationRequestSchema = z.strictObject({
  storeProfileId: uuidSchema,
  ...seoCommonInputSchema.shape,
  sourceReviewIds: sourceReviewIdsSchema.optional(),
});
export type CreateSeoGenerationRequest = z.infer<typeof createSeoGenerationRequestSchema>;

// Regenerate re-sends the common input only; it never carries `storeProfileId` or
// per-draft fields (API Contract §5 "재생성·거절·승인").
export const regenerateSeoGenerationRequestSchema = z.strictObject({
  ...seoCommonInputSchema.shape,
  sourceReviewIds: sourceReviewIdsSchema.optional(),
});
export type RegenerateSeoGenerationRequest = z.infer<typeof regenerateSeoGenerationRequestSchema>;

const draftKeywordsSchema = z.array(trimmedText(1, 30)).min(1).max(10);

export const localSeoContentSchema = z.strictObject({
  draftId: uuidSchema,
  platform: platformSchema,
  draftText: trimmedText(1, 750),
  keywords: draftKeywordsSchema,
  contentRules: z.array(z.string()),
});
export type LocalSeoContent = z.infer<typeof localSeoContentSchema>;

function coversExactlyEachPlatformOnce(drafts: readonly { platform: string }[]): boolean {
  const platforms = drafts.map((draft) => draft.platform);
  return (
    platforms.length === PLATFORMS.length &&
    new Set(platforms).size === PLATFORMS.length &&
    PLATFORMS.every((platform) => platforms.includes(platform))
  );
}

// Every Generation response carries exactly one Google, one Naver, and one Kakao
// result — never a duplicate or missing platform (API Contract §5, Data Model
// `UNIQUE(contentGenerationId, platform)`).
export const contentGenerationDataSchema = z
  .strictObject({
    generationId: uuidSchema,
    status: contentGenerationStatusSchema,
    revision: z.number().int().min(1),
    drafts: z.array(localSeoContentSchema),
  })
  .refine((data) => coversExactlyEachPlatformOnce(data.drafts), {
    message: 'drafts must cover exactly google, naver, and kakao once each',
    path: ['drafts'],
  });
export type ContentGenerationData = z.infer<typeof contentGenerationDataSchema>;

export const createSeoGenerationResponseSchema = contentGenerationDataSchema;
export type CreateSeoGenerationResponse = z.infer<typeof createSeoGenerationResponseSchema>;

export const regenerateSeoGenerationResponseSchema = contentGenerationDataSchema;
export type RegenerateSeoGenerationResponse = z.infer<typeof regenerateSeoGenerationResponseSchema>;

export const rejectSeoGenerationResponseSchema = contentGenerationDataSchema;
export type RejectSeoGenerationResponse = z.infer<typeof rejectSeoGenerationResponseSchema>;

export const approveSeoGenerationResponseSchema = z.strictObject({
  generationId: uuidSchema,
  generationStatus: z.literal('APPROVED'),
  approvedPlatforms: uniqueArray(
    z.array(platformSchema).length(PLATFORMS.length),
    'approvedPlatforms must not repeat a platform',
  ).refine((platforms) => PLATFORMS.every((platform) => platforms.includes(platform)), {
    message: 'approvedPlatforms must include google, naver, and kakao',
  }),
  syncJobId: uuidSchema,
  status: z.literal('PENDING'),
  statusUrl: z.string().trim().min(1),
});
export type ApproveSeoGenerationResponse = z.infer<typeof approveSeoGenerationResponseSchema>;
