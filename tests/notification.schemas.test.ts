import { describe, expect, it } from 'vitest';
import {
  listNotificationsSchema,
  targetSchema,
  publishAnnouncementSchema,
  updatePreferenceSchema,
} from '../src/modules/notifications/notification.schemas.js';

describe('notification.schemas', () => {
  describe('listNotificationsSchema defaults & filters', () => {
    it('applies defaults for empty input', () => {
      const parsed = listNotificationsSchema.safeParse({});
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(1);
        expect(parsed.data.pageSize).toBe(20);
        expect(parsed.data.category).toBe('ALL');
        expect(parsed.data.severity).toBe('ALL');
        expect(parsed.data.status).toBe('ALL');
        expect(parsed.data.actionRequired).toBe('ALL');
        expect(parsed.data.excludeDismissed).toBe('false');
      }
    });

    it('coerces numeric page and pageSize', () => {
      const parsed = listNotificationsSchema.safeParse({ page: '2', pageSize: '50' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.page).toBe(2);
        expect(parsed.data.pageSize).toBe(50);
      }
    });

    it('rejects pageSize above 500', () => {
      const parsed = listNotificationsSchema.safeParse({ pageSize: 501 });
      expect(parsed.success).toBe(false);
    });
  });

  describe('targetSchema discriminated union', () => {
    it('accepts ALL', () => {
      expect(targetSchema.safeParse({ kind: 'ALL' }).success).toBe(true);
    });

    it('accepts USER_IDS with non-empty list', () => {
      expect(
        targetSchema.safeParse({ kind: 'USER_IDS', userIds: ['usr_001'] }).success,
      ).toBe(true);
    });

    it('rejects USER_IDS with empty userIds', () => {
      expect(targetSchema.safeParse({ kind: 'USER_IDS', userIds: [] }).success).toBe(false);
    });

    it('rejects USER_IDS with more than 5000 ids', () => {
      const ids = Array.from({ length: 5001 }, (_, i) => String(i));
      expect(targetSchema.safeParse({ kind: 'USER_IDS', userIds: ids }).success).toBe(false);
    });

    it('accepts ROLES with non-empty roles', () => {
      expect(
        targetSchema.safeParse({ kind: 'ROLES', roles: ['ADMIN'] }).success,
      ).toBe(true);
    });

    it('rejects ROLES with empty roles', () => {
      expect(targetSchema.safeParse({ kind: 'ROLES', roles: [] }).success).toBe(false);
    });

    it('accepts HIERARCHY with ownerUserId', () => {
      expect(
        targetSchema.safeParse({ kind: 'HIERARCHY', ownerUserId: 'usr_top' }).success,
      ).toBe(true);
    });

    it('rejects HIERARCHY without ownerUserId', () => {
      expect(
        targetSchema.safeParse({ kind: 'HIERARCHY' }).success,
      ).toBe(false);
    });

    it('rejects unknown kind', () => {
      expect(targetSchema.safeParse({ kind: 'RANDOM' }).success).toBe(false);
    });
  });

  describe('publishAnnouncementSchema', () => {
    it('accepts complete payload with ALL target', () => {
      const result = publishAnnouncementSchema.safeParse({
        target: { kind: 'ALL' },
        title: 'System Maintenance',
        message: 'Scheduled maintenance on Sunday morning from 02:00 to 04:00 IST.',
        severity: 'INFO',
      });
      expect(result.success).toBe(true);
    });

    it('rejects short title', () => {
      const result = publishAnnouncementSchema.safeParse({
        target: { kind: 'ALL' },
        title: 'Hi',
        message: 'Message long enough to pass validation check.',
        severity: 'INFO',
      });
      expect(result.success).toBe(false);
    });

    it('rejects short message', () => {
      const result = publishAnnouncementSchema.safeParse({
        target: { kind: 'ALL' },
        title: 'Valid long enough title',
        message: 'Too short',
        severity: 'INFO',
      });
      expect(result.success).toBe(false);
    });

    it('rejects USER_IDS target with empty userIds list', () => {
      const result = publishAnnouncementSchema.safeParse({
        target: { kind: 'USER_IDS', userIds: [] },
        title: 'Maintenance',
        message: 'This is definitely a long enough body text for validation.',
        severity: 'WARNING',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updatePreferenceSchema', () => {
    it('accepts a single boolean toggle', () => {
      expect(
        updatePreferenceSchema.safeParse({ inAppEnabled: false }).success,
      ).toBe(true);
      expect(
        updatePreferenceSchema.safeParse({ emailEnabled: true }).success,
      ).toBe(true);
    });

    it('accepts multiple toggles', () => {
      expect(
        updatePreferenceSchema.safeParse({ inAppEnabled: true, pushEnabled: false }).success,
      ).toBe(true);
    });

    it('rejects object with no boolean toggles', () => {
      expect(updatePreferenceSchema.safeParse({}).success).toBe(false);
    });
  });
});
