import { z } from 'zod';
import {
  identifierSchema,
  nonEmptyTextSchema,
  proposalStatusSchema,
  syncJobStatusSchema,
} from '@/services/contracts/common';

const hourMinuteSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const businessHoursValueSchema = z.strictObject({
  open: hourMinuteSchema,
  close: hourMinuteSchema,
});
const temporaryClosureValueSchema = z.strictObject({
  startDate: z.iso.date(),
  endDate: z.iso.date(),
}).refine(({ startDate, endDate }) => endDate >= startDate, {
  message: 'endDate must be on or after startDate',
});

const proposalChangeSchema = z.discriminatedUnion('field', [
  z.strictObject({
    field: z.literal('businessHours'),
    currentValue: businessHoursValueSchema,
    proposedValue: businessHoursValueSchema,
  }),
  z.strictObject({
    field: z.literal('temporaryClosure'),
    currentValue: temporaryClosureValueSchema.nullable(),
    proposedValue: temporaryClosureValueSchema,
  }),
  z.strictObject({
    field: z.literal('representativeMenuName'),
    currentValue: nonEmptyTextSchema.max(50),
    proposedValue: nonEmptyTextSchema.max(50),
  }),
]);

export const storeChangeProposalResponseSchema = z.strictObject({
  proposalId: identifierSchema,
  recognizedTextMasked: nonEmptyTextSchema.max(500),
  changes: z.array(proposalChangeSchema).min(1),
  status: proposalStatusSchema,
});

export const storeChangeApprovalResponseSchema = z.strictObject({
  proposalId: identifierSchema,
  proposalStatus: z.literal('APPROVED'),
  syncJobId: identifierSchema,
  status: syncJobStatusSchema,
  statusUrl: nonEmptyTextSchema,
});

export type RawStoreChangeProposal = z.infer<typeof storeChangeProposalResponseSchema>;
