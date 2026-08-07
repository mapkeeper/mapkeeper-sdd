import { z } from 'zod';
import { hhmmSchema, isoDateSchema, proposalStatusSchema, trimmedText, uuidSchema } from './common';

const businessHoursValueSchema = z.strictObject({
  open: hhmmSchema,
  close: hhmmSchema,
});

const temporaryClosureValueSchema = z
  .strictObject({
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: 'endDate must not be before startDate',
    path: ['endDate'],
  });

const representativeMenuNameValueSchema = trimmedText(1, 50);

// `changes` is a discriminated union of exactly the three allowed structured values
// (API Contract §4 "허용 변경 값"); no other field is accepted.
export const proposalChangeSchema = z.discriminatedUnion('field', [
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
    currentValue: representativeMenuNameValueSchema,
    proposedValue: representativeMenuNameValueSchema,
  }),
]);
export type ProposalChange = z.infer<typeof proposalChangeSchema>;

// PATCH replaces the whole change list and the same `field` cannot appear twice
// (API Contract §4 "수정·거절·승인").
export const proposalChangeListSchema = z
  .array(proposalChangeSchema)
  .refine((changes) => new Set(changes.map((change) => change.field)).size === changes.length, {
    message: 'the same field cannot appear twice in changes',
  });
export type ProposalChangeList = z.infer<typeof proposalChangeListSchema>;

export const storeChangeProposalDataSchema = z.strictObject({
  proposalId: uuidSchema,
  recognizedTextMasked: trimmedText(1, 500),
  changes: proposalChangeListSchema,
  status: proposalStatusSchema,
});
export type StoreChangeProposalData = z.infer<typeof storeChangeProposalDataSchema>;

export const createStoreChangeRequestSchema = z.strictObject({
  storeProfileId: uuidSchema,
  recognizedText: trimmedText(1, 500),
  locale: z.string().trim().min(1),
});
export type CreateStoreChangeRequest = z.infer<typeof createStoreChangeRequestSchema>;

export const createStoreChangeResponseSchema = storeChangeProposalDataSchema;
export type CreateStoreChangeResponse = z.infer<typeof createStoreChangeResponseSchema>;

export const patchStoreChangeRequestSchema = z.strictObject({
  changes: proposalChangeListSchema,
});
export type PatchStoreChangeRequest = z.infer<typeof patchStoreChangeRequestSchema>;

export const patchStoreChangeResponseSchema = storeChangeProposalDataSchema;
export type PatchStoreChangeResponse = z.infer<typeof patchStoreChangeResponseSchema>;

export const rejectStoreChangeResponseSchema = storeChangeProposalDataSchema;
export type RejectStoreChangeResponse = z.infer<typeof rejectStoreChangeResponseSchema>;

export const storeChangeApprovalResponseSchema = z.strictObject({
  proposalId: uuidSchema,
  proposalStatus: z.literal('APPROVED'),
  syncJobId: uuidSchema,
  status: z.literal('PENDING'),
  statusUrl: z.string().trim().min(1),
});
export type StoreChangeApprovalResponse = z.infer<typeof storeChangeApprovalResponseSchema>;
