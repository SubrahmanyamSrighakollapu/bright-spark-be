import { describe, expect, it } from 'vitest';
import {
  createPayoutChargeSchema,
  resolvePayoutChargeSchema,
  updatePayoutChargeSchema,
} from '../src/modules/payout-charges/payout-charge.schemas.js';

describe('payout charge schemas', () => {
  it('accepts valid flat-charge ranges and coerces form values', () => {
    expect(createPayoutChargeSchema.parse({ payoutMode: 'IMPS', minAmount: '1', maxAmount: '25000', flatCharge: '5' }))
      .toEqual({ payoutMode: 'IMPS', minAmount: 1, maxAmount: 25000, flatCharge: 5 });
  });

  it('rejects reversed and zero-width ranges', () => {
    expect(() => createPayoutChargeSchema.parse({ payoutMode: 'NEFT', minAmount: 100, maxAmount: 100, flatCharge: 3 }))
      .toThrow('Maximum amount must be greater than minimum amount');
  });

  it('requires a positive optimistic-lock version when updating', () => {
    expect(() => updatePayoutChargeSchema.parse({ payoutMode: 'UPI', minAmount: 1, maxAmount: 1000, flatCharge: 2, version: 0 }))
      .toThrow();
  });

  it('requires a supported mode and positive settlement amount for resolution', () => {
    expect(resolvePayoutChargeSchema.parse({ payoutMode: 'RTGS', amount: '200000' })).toEqual({ payoutMode: 'RTGS', amount: 200000 });
    expect(() => resolvePayoutChargeSchema.parse({ payoutMode: 'CASH', amount: 100 })).toThrow();
    expect(() => resolvePayoutChargeSchema.parse({ payoutMode: 'IMPS', amount: 0 })).toThrow();
  });
});
