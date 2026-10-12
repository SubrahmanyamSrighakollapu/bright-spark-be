import { describe, expect, it } from 'vitest';
import {
  listAuditLogsSchema,
  auditLogIdSchema,
  exportAuditLogsSchema,
  actionCatalogSchema,
} from '../src/modules/audit-logs/audit-log.schemas.js';

describe('audit-log.schemas', () => {
  describe('listAuditLogsSchema defaults & filters', () => {
    it('applies defaults for empty input', () => {
      const parsed = listAuditLogsSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(20);
      }
    });

    it('coerces numeric page and pageSize', () => {
      const parsed = listAuditLogsSchema.safeParse({ page: '3', pageSize: '50' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(3);
        expect(parsed.data.pageSize).toBe(50);
      }
    });

    it('rejects page=0', () => {
      const parsed = listAuditLogsSchema.safeParse({ page: 0 });
      expect(parsed.success).toBe(false);
    });

    it('rejects pageSize=0', () => {
      const parsed = listAuditLogsSchema.safeParse({ pageSize: 0 });
      expect(parsed.success).toBe(false);
    });

    it('rejects pageSize above 500', () => {
      const parsed = listAuditLogsSchema.safeParse({ pageSize: 501 });
      expect(parsed.success).toBe(false);
    });

    it('accepts valid partial filters with all fields', () => {
      const parsed = listAuditLogsSchema.safeParse({
        actorUserId: 'usr_001',
        outcome: 'SUCCESS',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-01-31T23:59:59Z',
        resourceId: 'res_42',
        ipAddress: '10.0.0.1',
        actorRole: 'ADMIN',
        keyword: 'wallet',
        page: 2,
        pageSize: 100,
      });
      expect(parsed.success).toBe(true);
    });

    it('rejects outcome enum with BAD_VALUE', () => {
      const parsed = listAuditLogsSchema.safeParse({ outcome: 'BAD_VALUE' });
      expect(parsed.success).toBe(false);
    });

    it('accepts action as a single string and transforms to array', () => {
      const parsed = listAuditLogsSchema.safeParse({ action: 'WALLET_CREDIT' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.action).toEqual(['WALLET_CREDIT']);
      }
    });

    it('accepts action as string array', () => {
      const parsed = listAuditLogsSchema.safeParse({ action: ['WALLET_CREDIT', 'USER_STATUS_UPDATED'] });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.action).toEqual(['WALLET_CREDIT', 'USER_STATUS_UPDATED']);
      }
    });

    it('rejects keyword longer than 100 characters', () => {
      const longKeyword = 'a'.repeat(101);
      const parsed = listAuditLogsSchema.safeParse({ keyword: longKeyword });
      expect(parsed.success).toBe(false);
    });

    it('accepts keyword at exactly 100 characters', () => {
      const okKeyword = 'a'.repeat(100);
      const parsed = listAuditLogsSchema.safeParse({ keyword: okKeyword });
      expect(parsed.success).toBe(true);
    });
  });

  describe('auditLogIdSchema', () => {
    it('rejects empty id string', () => {
      const parsed = auditLogIdSchema.safeParse({ id: '' });
      expect(parsed.success).toBe(false);
    });

    it('accepts a good id value', () => {
      const parsed = auditLogIdSchema.safeParse({ id: '123' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.id).toBe('123');
      }
    });

    it('accepts uuid-like id', () => {
      const parsed = auditLogIdSchema.safeParse({ id: '550e8400-e29b-41d4-a716-446655440000' });
      expect(parsed.success).toBe(true);
    });
  });

  describe('exportAuditLogsSchema', () => {
    it('does not require page/pageSize, accepts filters alone', () => {
      const parsed = exportAuditLogsSchema.safeParse({
        actorUserId: 'usr_001',
        outcome: 'FAILURE',
        startDate: '2026-01-01',
      });
      expect(parsed.success).toBe(true);
    });

    it('accepts empty object (all filters optional)', () => {
      const parsed = exportAuditLogsSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });
  });

  describe('actionCatalogSchema', () => {
    it('passes for empty object', () => {
      const parsed = actionCatalogSchema.safeParse({});
      expect(parsed.success).toBe(true);
    });

    it('passes for undefined/missing input', () => {
      const parsed = actionCatalogSchema.safeParse(undefined);
      expect(parsed.success).toBe(true);
    });
  });
});
