import { describe, expect, it } from 'vitest';
import { categorySchema, productSchema } from '../src/modules/service-categories/service-category.routes.js';

describe('service catalogue schemas', () => {
  it('accepts valid category and product configuration', () => {
    expect(categorySchema.parse({ code: 'MOBILE_RECHARGE', name: 'Mobile Recharge' }).pricingMode).toBe('BOTH');
    expect(productSchema.parse({ code: 'MR_199', name: 'Recharge 199', price: 199 }).status).toBe('ACTIVE');
  });

  it('rejects invalid codes and non-positive product prices', () => {
    expect(categorySchema.safeParse({ code: 'bad code', name: 'Invalid' }).success).toBe(false);
    expect(productSchema.safeParse({ code: 'INVALID', name: 'Invalid', price: 0 }).success).toBe(false);
  });
});
