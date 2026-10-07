import { z } from 'zod';

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  role: z.string().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  approvalStatus: z.string().optional(),
  search: z.string().optional(),
  searchQuery: z.string().optional(),
  parentPartyId: z.string().optional(),
  distributorId: z.string().optional(),
});

export const createUserSchema = z.object({
  role: z.enum(['MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER']),
  fullName: z.string().min(2).max(160),
  email: z.string().email(),
  mobile: z.string().min(10).max(15),
  displayName: z.string().min(2).max(160),
  legalName: z.string().optional(),
  parentPartyId: z.string().optional(),
  password: z.string().min(6).optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'PENDING', 'SUSPENDED', 'INACTIVE', 'DISABLED', 'BLOCKED']),
  reason: z.string().optional(),
});

export const userIdSchema = z.object({
  id: z.string().min(1),
});

export const walletCreditDebitSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  remarks: z.string().optional(),
  referenceNumber: z.string().optional(),
  reason: z.string().optional(),
});

export const walletHoldSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0'),
  action: z.enum(['HOLD', 'RELEASE']),
  remarks: z.string().optional(),
  reason: z.string().optional(),
});
