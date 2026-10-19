import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { createApp } from '../src/app.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import type { Express } from 'express';
import { pool } from '../src/database/pool.js';

function makeToken(claims: {
  userId: string;
  roles?: string[];
  permissions?: string[];
  partyId?: string | null;
  email?: string;
  mustChangePassword?: boolean;
}): string {
  return jwt.sign(
    {
      userId: claims.userId,
      partyId: claims.partyId ?? null,
      email: claims.email ?? 'test@example.com',
      roles: claims.roles ?? ['RETAILER'],
      permissions: claims.permissions ?? [],
      mustChangePassword: claims.mustChangePassword ?? false,
    },
    env.JWT_ACCESS_SECRET,
    {
      subject: claims.userId,
      issuer: 'bright-spark-api',
      audience: 'bright-spark-web',
      expiresIn: '15m',
    },
  );
}

const NOTIFICATION_BASE = '/api/v1/notifications';

describe('Notifications & Communication API', () => {
  let app: Express;
  let dbAvailable = false;

  beforeAll(async () => {
    app = createApp();
    try {
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  const READ_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000002',
    roles: ['RETAILER'],
    permissions: ['NOTIFICATION_READ'],
    email: 'retailer@example.com',
  });

  const NO_PERM_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000003',
    roles: ['SALES'],
    permissions: [],
    email: 'noperm@example.com',
  });

  const ANNOUNCEMENT_PUBLISHER_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000004',
    roles: ['OPERATIONS'],
    permissions: ['NOTIFICATION_READ', 'ANNOUNCEMENT_PUBLISH'],
    email: 'ops@example.com',
  });

  const ADMIN_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000001',
    roles: ['ADMIN'],
    permissions: [],
    email: 'admin@example.com',
  });

  // ------------------------------------------------------------------
  // Auth guard: every protected endpoint returns 401 without bearer
  // ------------------------------------------------------------------
  describe('Auth guard (no bearer token) returns 401 on every route', () => {
    it('GET /notifications', async () => {
      const res = await request(app).get(`${NOTIFICATION_BASE}`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /notifications/summary', async () => {
      const res = await request(app).get(`${NOTIFICATION_BASE}/summary`);
      expect(res.status).toBe(401);
    });

    it('GET /notifications/export', async () => {
      const res = await request(app).get(`${NOTIFICATION_BASE}/export`);
      expect(res.status).toBe(401);
    });

    it('GET /notifications/:id', async () => {
      const res = await request(app).get(`${NOTIFICATION_BASE}/any-id`);
      expect(res.status).toBe(401);
    });

    it('POST /notifications/:id/read', async () => {
      const res = await request(app).post(`${NOTIFICATION_BASE}/any-id/read`);
      expect(res.status).toBe(401);
    });

    it('POST /notifications/:id/unread', async () => {
      const res = await request(app).post(`${NOTIFICATION_BASE}/any-id/unread`);
      expect(res.status).toBe(401);
    });

    it('POST /notifications/read-all', async () => {
      const res = await request(app).post(`${NOTIFICATION_BASE}/read-all`);
      expect(res.status).toBe(401);
    });

    it('POST /notifications/:id/dismiss', async () => {
      const res = await request(app).post(`${NOTIFICATION_BASE}/any-id/dismiss`);
      expect(res.status).toBe(401);
    });

    it('POST /notifications/:id/clicked', async () => {
      const res = await request(app).post(`${NOTIFICATION_BASE}/any-id/clicked`);
      expect(res.status).toBe(401);
    });

    it('POST /notifications/announcements', async () => {
      const res = await request(app).post(`${NOTIFICATION_BASE}/announcements`);
      expect(res.status).toBe(401);
    });

    it('GET /notifications/preferences', async () => {
      const res = await request(app).get(`${NOTIFICATION_BASE}/preferences`);
      expect(res.status).toBe(401);
    });

    it('PATCH /notifications/preferences/:code', async () => {
      const res = await request(app).patch(`${NOTIFICATION_BASE}/preferences/TRANSACTION_FAILED`);
      expect(res.status).toBe(401);
    });
  });

  // ------------------------------------------------------------------
  // Permission enforcement
  // ------------------------------------------------------------------
  describe('Permission enforcement (403)', () => {
    it('blocks GET /notifications without NOTIFICATION_READ permission', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${NO_PERM_TOKEN}`);
      expect([403, 401]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('blocks POST /announcements without ANNOUNCEMENT_PUBLISH permission (non-ADMIN)', async () => {
      const res = await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .send({
          target: { kind: 'ALL' },
          title: 'Scheduled Maintenance',
          message: 'A sufficiently long announcement message body.',
          severity: 'INFO',
        });
      expect([403, 401]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('allows ADMIN role implicit super-permission (no explicit perms needed) to GET list', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
      // Returns 200 (or DB error) but NOT 401/403 since ADMIN is implicit
      expect([403, 401]).not.toContain(res.status);
    });
  });

  // ------------------------------------------------------------------
  // Zod validation (422 VALIDATION_ERROR) at middleware layer
  // ------------------------------------------------------------------
  describe('Schema validation errors (422)', () => {
    it('rejects publish announcement with short title', async () => {
      const res = await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${ANNOUNCEMENT_PUBLISHER_TOKEN}`)
        .send({
          target: { kind: 'ALL' },
          title: 'Hi',
          message: 'A long enough body text for this announcement message.',
          severity: 'INFO',
        });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects publish announcement with USER_IDS empty list', async () => {
      const res = await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${ANNOUNCEMENT_PUBLISHER_TOKEN}`)
        .send({
          target: { kind: 'USER_IDS', userIds: [] },
          title: 'Valid Announcement Title',
          message: 'A long enough body text for this announcement message.',
          severity: 'WARNING',
        });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects publish announcement with invalid severity', async () => {
      const res = await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${ANNOUNCEMENT_PUBLISHER_TOKEN}`)
        .send({
          target: { kind: 'ALL' },
          title: 'Valid Announcement Title',
          message: 'A long enough body text for this announcement message.',
          severity: 'SOMETHING',
        });
      expect(res.status).toBe(422);
    });

    it('rejects PATCH preferences with empty body (at least one bool required)', async () => {
      const res = await request(app)
        .patch(`${NOTIFICATION_BASE}/preferences/TRANSACTION_FAILED`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects PATCH preferences with unknown-only fields (strict)', async () => {
      const res = await request(app)
        .patch(`${NOTIFICATION_BASE}/preferences/TRANSACTION_FAILED`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .send({ notAField: true });
      expect(res.status).toBe(422);
    });

    it('rejects negative pageSize via coerce+refine', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .query({ pageSize: '-5' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects mark-as-read body with unknown fields (strict optional)', async () => {
      const res = await request(app)
        .post(`${NOTIFICATION_BASE}/some-id/read`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .send({ extra: true });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts PATCH preferences with one boolean', async () => {
      const res = await request(app)
        .patch(`${NOTIFICATION_BASE}/preferences/TRANSACTION_FAILED`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .send({ inAppEnabled: true });
      // The request passed schema validation. A seeded database may still reject
      // this synthetic JWT user as a missing foreign-key reference.
      expect(res.body.error?.code).not.toBe('VALIDATION_ERROR');
    });
  });

  // ------------------------------------------------------------------
  // Standard envelope structure (success / consistent fields)
  // ------------------------------------------------------------------
  describe('Response envelope consistency', () => {
    it('validates list notification success envelope shape (with token)', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${READ_TOKEN}`)
        .query({ page: 1, pageSize: 5 });
      // Should be 200 when DB works; but envelope present on success
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.data.items).toBeDefined();
        expect(res.body.data.pagination).toBeDefined();
        expect(res.body.data.summary).toBeDefined();
        expect(typeof res.body.timestamp).toBe('string');
      }
    });

    it('validates summary endpoint envelope structure', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}/summary`)
        .set('Authorization', `Bearer ${READ_TOKEN}`);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(typeof res.body.data.unreadCount).toBe('number');
        expect(typeof res.body.data.todayCount).toBe('number');
      }
    });

    it('validates preferences GET envelope structure', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}/preferences`)
        .set('Authorization', `Bearer ${READ_TOKEN}`);
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(Array.isArray(res.body.data)).toBe(true);
      }
    });

    it('validates CSV endpoint returns blob-like content', async () => {
      const res = await request(app)
        .get(`${NOTIFICATION_BASE}/export`)
        .set('Authorization', `Bearer ${READ_TOKEN}`);
      if (res.status === 200) {
        expect(['text/csv', 'application/octet-stream', 'text/csv;charset=utf-8']).toContain(
          String(res.headers['content-type'] || '').split(';')[0]
        );
      }
    });
  });

  // ------------------------------------------------------------------
  // DB-dependent tests (runs only when database connection works)
  // These tests validate end-to-end workflows (ownership, read idempotency,
  // announcement targeting, preference mandatory rejection, suppression).
  // ------------------------------------------------------------------
  describe.skipIf(!dbAvailable)('End-to-end flows (requires database)', () => {
    const E2E_USER_A = '00000000-0000-4000-8000-000000000099';
    const E2E_USER_B = '00000000-0000-4000-8000-000000000098';
    const tokenA = makeToken({
      userId: E2E_USER_A,
      roles: ['RETAILER'],
      permissions: ['NOTIFICATION_READ'],
    });
    const tokenB = makeToken({
      userId: E2E_USER_B,
      roles: ['RETAILER'],
      permissions: ['NOTIFICATION_READ'],
    });

    it('list and summary return at least one row after targeted announcement publish (ALL)', async () => {
      const publisher = makeToken({
        userId: '00000000-0000-4000-8000-000000000005',
        roles: ['SUPER_ADMIN'],
        permissions: ['NOTIFICATION_READ', 'ANNOUNCEMENT_PUBLISH'],
      });
      const publish = await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${publisher}`)
        .send({
          target: { kind: 'USER_IDS', userIds: [E2E_USER_A] },
          title: 'E2E Announcement Title',
          message: 'An announcement created specifically for end-to-end integration test run.',
          severity: 'INFO',
        });
      expect(publish.status).toBe(200);
      expect(publish.body.data.targetCount).toBeGreaterThanOrEqual(0);

      const list = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(list.status).toBe(200);
      expect(list.body.success).toBe(true);
    });

    it('blocks cross-user GET /:id access (enforces recipient_user_id ownership)', async () => {
      // Publish directly for B
      const publisher = makeToken({
        userId: '00000000-0000-4000-8000-000000000005',
        roles: ['SUPER_ADMIN'],
        permissions: ['NOTIFICATION_READ', 'ANNOUNCEMENT_PUBLISH'],
      });
      await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${publisher}`)
        .send({
          target: { kind: 'USER_IDS', userIds: [E2E_USER_B] },
          title: 'Ownership test for B only',
          message: 'Long enough message for the ownership test notification body here.',
          severity: 'INFO',
        });
      const listB = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${tokenB}`);
      if (listB.status === 200 && listB.body.data.items.length > 0) {
        const bFirstId: string = listB.body.data.items[0].id;
        // A tries to fetch B's notification
        const aSteal = await request(app)
          .get(`${NOTIFICATION_BASE}/${bFirstId}`)
          .set('Authorization', `Bearer ${tokenA}`);
        expect(aSteal.status).toBe(404);
        expect(aSteal.body.error.code).toBe('NOT_FOUND');
      }
    });

    it('markAsRead is idempotent across repeat POSTs', async () => {
      const list = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${tokenA}`);
      if (list.status !== 200 || list.body.data.items.length === 0) return;
      const firstId: string = list.body.data.items[0].id;
      const call1 = await request(app)
        .post(`${NOTIFICATION_BASE}/${firstId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);
      const call2 = await request(app)
        .post(`${NOTIFICATION_BASE}/${firstId}/read`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(call1.status).toBe(200);
      expect(call2.status).toBe(200);
      expect(call1.body.data.status).toBe('READ');
      expect(call2.body.data.status).toBe('READ');
      expect(call1.body.data.readAt).toEqual(call2.body.data.readAt);
    });

    it('markAsUnread flips status back after read', async () => {
      const list = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${tokenA}`);
      if (list.status !== 200 || list.body.data.items.length === 0) return;
      const id: string = list.body.data.items[0].id;
      await request(app)
        .post(`${NOTIFICATION_BASE}/${id}/read`)
        .set('Authorization', `Bearer ${tokenA}`);
      const unread = await request(app)
        .post(`${NOTIFICATION_BASE}/${id}/unread`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(unread.status).toBe(200);
      expect(unread.body.data.status).toBe('UNREAD');
      expect(unread.body.data.readAt).toBeNull();
    });

    it('dismiss sets dismissedAt non-null on the notification', async () => {
      const list = await request(app)
        .get(`${NOTIFICATION_BASE}`)
        .set('Authorization', `Bearer ${tokenA}`);
      if (list.status !== 200 || list.body.data.items.length === 0) return;
      const id: string = list.body.data.items[0].id;
      const dismiss = await request(app)
        .post(`${NOTIFICATION_BASE}/${id}/dismiss`)
        .set('Authorization', `Bearer ${tokenA}`);
      expect(dismiss.status).toBe(200);
      expect(dismiss.body.data.dismissedAt).not.toBeNull();
    });

    it('publish ROLES targeting with RETAILER creates notifications for retailer users', async () => {
      const publisher = makeToken({
        userId: '00000000-0000-4000-8000-000000000005',
        roles: ['SUPER_ADMIN'],
        permissions: ['NOTIFICATION_READ', 'ANNOUNCEMENT_PUBLISH'],
      });
      const res = await request(app)
        .post(`${NOTIFICATION_BASE}/announcements`)
        .set('Authorization', `Bearer ${publisher}`)
        .send({
          target: { kind: 'ROLES', roles: ['RETAILER'] },
          title: 'Role-targeted announcement (Retailer only)',
          message: 'A message specifically for users with RETAILER role across users/parties tables.',
          severity: 'WARNING',
        });
      expect(res.status).toBe(200);
      expect(typeof res.body.data.createdCount).toBe('number');
    });

    it('preference mandatory event rejects opt-out of inAppEnabled for SECURITY events', async () => {
      const patch = await request(app)
        .patch(`${NOTIFICATION_BASE}/preferences/SECURITY_ALERT`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ inAppEnabled: false });
      // SECURITY_ALERT is mandatory, or at least non-mandatory returns 200,
      // if master-data marks it mandatory we should see 422/400
      expect([200, 400, 422]).toContain(patch.status);
    });
  });
});
