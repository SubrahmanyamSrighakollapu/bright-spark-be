import { z } from 'zod';

export const partyTypeSchema = z.enum(['MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER', 'EMPLOYEE']);
export const accountStatusSchema = z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED']);
export const approvalStatusSchema = z.enum(['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED']);

export const listPartiesSchema = z.object({
  type: partyTypeSchema.optional(),
  parentPartyId: z.string().uuid().optional(),
  status: accountStatusSchema.optional(),
  approvalStatus: approvalStatusSchema.optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createPartySchema = z.object({
  partyType: partyTypeSchema,
  code: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_-]+$/),
  displayName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional(),
  email: z.string().email().max(254).optional(),
  mobile: z.string().regex(/^[6-9]\d{9}$/).optional(),
  parentPartyId: z.string().uuid().optional(),
});

export const partyIdSchema = z.object({ id: z.string().uuid() });

export const updatePartyStatusSchema = z.object({
  accountStatus: accountStatusSchema,
  reason: z.string().trim().min(3).max(1000),
  version: z.number().int().positive(),
});

export const reviewPartySchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reasonCode: z.string().trim().max(50).optional(),
  remarks: z.string().trim().min(3).max(1000),
  version: z.number().int().positive(),
});
