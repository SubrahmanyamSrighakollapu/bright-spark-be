import { z } from 'zod';

export const payoutModeSchema = z.enum(['IMPS', 'NEFT', 'RTGS', 'UPI']);
const money = z.coerce.number().finite().min(0).max(9999999999999.99);

const payoutChargeBodySchema = z.object({
  payoutMode: payoutModeSchema,
  minAmount: money,
  maxAmount: money,
  flatCharge: money,
});

export const createPayoutChargeSchema = payoutChargeBodySchema.refine(
  (value) => value.maxAmount > value.minAmount,
  { path: ['maxAmount'], message: 'Maximum amount must be greater than minimum amount' },
);

export const updatePayoutChargeSchema = payoutChargeBodySchema.extend({
  version: z.coerce.number().int().positive(),
}).refine(
  (value) => value.maxAmount > value.minAmount,
  { path: ['maxAmount'], message: 'Maximum amount must be greater than minimum amount' },
);

export const payoutChargeIdSchema = z.object({ id: z.string().uuid() });
export const resolvePayoutChargeSchema = z.object({ payoutMode: payoutModeSchema, amount: money.positive() });
