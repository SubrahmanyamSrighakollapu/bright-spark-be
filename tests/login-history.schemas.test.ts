import { describe, expect, it } from 'vitest';
import {
  listSchema,
  byIdSchema,
  exportSchema,
  LOGIN_HISTORY_RESULTS,
  updateLocationSchema,
} from '../src/modules/login-history/login-history.schemas.js';

describe('login-history.schemas', () => {
  describe('updateLocationSchema', () => {
    it('preserves explicit browser failure reasons', () => {
      for (const locationStatus of ['DENIED', 'TIMEOUT', 'UNSUPPORTED', 'ERROR', 'UNAVAILABLE']) {
        expect(updateLocationSchema.safeParse({ locationStatus }).success).toBe(true);
      }
    });

    it('requires a complete granted coordinate reading', () => {
      expect(updateLocationSchema.safeParse({ locationStatus: 'GRANTED' }).success).toBe(false);
      expect(updateLocationSchema.safeParse({
        locationStatus: 'GRANTED', latitude: 12.9716, longitude: 77.5946,
        locationAccuracy: 10, locationCapturedAt: '2026-10-11T10:00:00.000Z',
      }).success).toBe(true);
    });
  });
  describe('listSchema defaults & filters', () => {
    it('applies defaults for empty input', () => {
      const parsed = listSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(20);
      }
    });

    it('coerces numeric page and pageSize', () => {
      const parsed = listSchema.safeParse({ page: '5', pageSize: '25' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(5);
        expect(parsed.data.pageSize).toBe(25);
      }
    });

    it('rejects page=0', () => {
      expect(listSchema.safeParse({ page: 0 }).success).toBe(false);
    });

    it('rejects pageSize=0', () => {
      expect(listSchema.safeParse({ pageSize: 0 }).success).toBe(false);
    });

    it('rejects pageSize above 500', () => {
      expect(listSchema.safeParse({ pageSize: 501 }).success).toBe(false);
    });

    it('accepts userId as empty array', () => {
      const parsed = listSchema.safeParse({ userId: [] });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.userId).toEqual([]);
      }
    });

    it('accepts userId array of strings', () => {
      const parsed = listSchema.safeParse({
        userId: ['usr_001', 'usr_002', 'usr_003'],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.userId).toEqual(['usr_001', 'usr_002', 'usr_003']);
      }
    });

    it('rejects result array with X_VALUE_BAD', () => {
      const parsed = listSchema.safeParse({ result: ['X_VALUE_BAD'] });
      expect(parsed.success).toBe(false);
    });

    it('accepts all valid LOGIN_HISTORY_RESULTS values', () => {
      const parsed = listSchema.safeParse({ result: [...LOGIN_HISTORY_RESULTS] });
      expect(parsed.success).toBe(true);
    });

    it('rejects empty-string items inside userId array', () => {
      const parsed = listSchema.safeParse({ userId: ['usr_001', ''] });
      expect(parsed.success).toBe(false);
    });

    it('rejects keyword longer than 100 characters', () => {
      const longKeyword = 'x'.repeat(101);
      const parsed = listSchema.safeParse({ keyword: longKeyword });
      expect(parsed.success).toBe(false);
    });

    it('accepts keyword at max length (100 trimmed)', () => {
      const okKeyword = 'k'.repeat(100);
      const parsed = listSchema.safeParse({ keyword: okKeyword });
      expect(parsed.success).toBe(true);
    });

    it('accepts complete filter set with dates and ip', () => {
      const parsed = listSchema.safeParse({
        userId: ['usr_001'],
        result: ['SUCCESS', 'FAILED'],
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
        ip: '192.168.1.10',
        keyword: 'login',
        page: 2,
        pageSize: 50,
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe('byIdSchema', () => {
    it('rejects empty id', () => {
      const parsed = byIdSchema.safeParse({ id: '' });
      expect(parsed.success).toBe(false);
    });

    it('accepts a good non-empty id', () => {
      const parsed = byIdSchema.safeParse({ id: 'good' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toBe('good');
      }
    });

    it('trims whitespace from id', () => {
      const parsed = byIdSchema.safeParse({ id: '  padded  ' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toBe('padded');
      }
    });
  });

  describe('exportSchema', () => {
    it('does not require page/pageSize, accepts filters only', () => {
      const parsed = exportSchema.safeParse({
        userId: ['usr_001'],
        result: ['SUCCESS'],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect('page' in parsed.data).toBe(false);
        expect('pageSize' in parsed.data).toBe(false);
      }
    });

    it('accepts empty object (all fields optional)', () => {
      const parsed = exportSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });
  });
});
