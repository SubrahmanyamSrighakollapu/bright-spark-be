import { describe, expect, it } from 'vitest';
import { commissionSchema, configSchema, gatewaySchema, methodSchema, optionSchema, planSchema } from '../src/modules/configuration/configuration.routes.js';

describe('administration configuration schemas', () => {
  it('accepts valid gateway, method, option, and plan payloads', () => {
    expect(gatewaySchema.parse({ gatewayName: 'Razorpay' }).isActive).toBe(true);
    expect(methodSchema.parse({ methodName: 'Bank Transfer', methodCode: 'BANK_TRANSFER' }).methodCode).toBe('BANK_TRANSFER');
    expect(optionSchema.safeParse({ methodId: crypto.randomUUID(), optionName: 'IMPS', optionCode: 'IMPS' }).success).toBe(true);
    expect(planSchema.parse({ planName: 'Retailer Plan', planPrice: '499', planDescription: 'Retailer services' }).planPrice).toBe(499);
  });

  it('requires UUID references and positive commission rates', () => {
    expect(configSchema.safeParse({ planId: 'bad', gatewayId: 'bad', roleId: 1 }).success).toBe(false);
    expect(commissionSchema.safeParse({ planConfigId: crypto.randomUUID(), methodId: crypto.randomUUID(), commissionRate: 0 }).success).toBe(false);
  });

  it('rejects employee-style non-numeric role identifiers at the contract boundary', () => {
    expect(configSchema.safeParse({ planId: crypto.randomUUID(), gatewayId: crypto.randomUUID(), roleId: 'employee' }).success).toBe(false);
  });
});
