import { z } from 'zod';
import { identifierSchema } from '@/services/contracts/common';

const sourceReviewSchema = z.strictObject({
  id: identifierSchema,
  storeProfileId: identifierSchema,
  bodyMasked: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
});

export const reviewSummaryResponseSchema = z.strictObject({
  storeProfileId: identifierSchema,
  reviewCount: z.number().int().min(0),
  summary: z.string(),
  keywords: z.array(z.string()),
  sourceReviews: z.array(sourceReviewSchema),
});
