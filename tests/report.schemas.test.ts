import { describe, expect, it } from 'vitest';
import {
  reportType,
  REPORT_TYPES,
  commonDateRange,
  listByType,
  exportByType,
  reportTypeParamSchema,
} from '../src/modules/reports/report.schemas.js';

describe('report.schemas', () => {
  describe('reportType enum', () => {
    it('passes for all 6 valid report type values', () => {
      const validTypes = ['transactions', 'ledger', 'settlements', 'balance', 'chargebacks', 'api-performance'];
      for (const type of validTypes) {
        const parsed = reportType.safeParse(type);
        expect(parsed.success).toBe(true);
      }
      expect(REPORT_TYPES).toHaveLength(6);
    });

    it('rejects bad value foo', () => {
      const parsed = reportType.safeParse('foo');
      expect(parsed.success).toBe(false);
    });

    it('rejects case-mismatched TRANSACTIONS uppercase', () => {
      const parsed = reportType.safeParse('TRANSACTIONS');
      expect(parsed.success).toBe(false);
    });
  });

  describe('commonDateRange', () => {
    it('rejects when startDate is missing', () => {
      const parsed = commonDateRange.safeParse({
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects when endDate is missing', () => {
      const parsed = commonDateRange.safeParse({
        startDate: '2026-01-01T00:00:00Z',
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects invalid non-datetime string for startDate', () => {
      const parsed = commonDateRange.safeParse({
        startDate: 'not-a-date',
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(parsed.success).toBe(false);
    });

    it('applies page and pageSize defaults when both dates provided', () => {
      const parsed = commonDateRange.safeParse({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(20);
      }
    });

    it('rejects page=0', () => {
      expect(
        commonDateRange.safeParse({
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-12-31T23:59:59Z',
          page: 0,
        }).success,
      ).toBe(false);
    });

    it('rejects pageSize above 500', () => {
      expect(
        commonDateRange.safeParse({
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-12-31T23:59:59Z',
          pageSize: 501,
        }).success,
      ).toBe(false);
    });

    it('accepts valid page and pageSize', () => {
      const parsed = commonDateRange.safeParse({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
        page: 3,
        pageSize: 100,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(3);
        expect(parsed.data.pageSize).toBe(100);
      }
    });
  });

  describe('listByType (full merge with dates + optional filters)', () => {
    it('passes with startDate + endDate plus all optional filters', () => {
      const parsed = listByType.safeParse({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-06-30T23:59:59Z',
        role: 'RETAILER',
        userId: 'usr_001',
        status: 'SUCCESS',
        service: 'IMPS',
        transactionStatus: 'COMPLETED',
        chargebackStatus: 'OPEN',
        settlementCycle: 'CYCLE_2026_01',
        page: 2,
        pageSize: 50,
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts valid page/pageSize with date range only', () => {
      const parsed = listByType.safeParse({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        page: 1,
        pageSize: 500,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('exportByType (same as listByType minus page/pageSize)', () => {
    it('passes with startDate+endDate and filters, has no page/pageSize', () => {
      const parsed = exportByType.safeParse({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
        role: 'DISTRIBUTOR',
        status: 'SUCCESS',
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect((parsed.data as any).page).toBeUndefined();
        expect((parsed.data as any).pageSize).toBeUndefined();
      }
    });

    it('fails without startDate', () => {
      const parsed = exportByType.safeParse({
        endDate: '2026-12-31T23:59:59Z',
      });
      expect(parsed.success).toBe(false);
    });

    it('fails without endDate', () => {
      const parsed = exportByType.safeParse({
        startDate: '2026-01-01T00:00:00Z',
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('reportTypeParamSchema', () => {
    it('accepts any valid 6 report types as type param', () => {
      for (const type of REPORT_TYPES) {
        const parsed = reportTypeParamSchema.safeParse({ type });
        expect(parsed.success).toBe(true);
      }
    });

    it('rejects invalid type param', () => {
      const parsed = reportTypeParamSchema.safeParse({ type: 'bogus-report' });
      expect(parsed.success).toBe(false);
    });
  });
});
