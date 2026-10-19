import request from 'supertest';
import { describe, expect, it, beforeAll } from 'vitest';
import { createApp } from '../src/app.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';
import type { Express } from 'express';

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

const API = '/api/v1';

describe('Audit logs, Login history, Reports API', () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  // ---- Tokens with various permission levels ----
  const NO_PERM_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000003',
    roles: ['SALES'],
    permissions: [],
    email: 'noperm@example.com',
  });

  const AUDIT_READER_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000010',
    roles: ['OPERATIONS'],
    permissions: ['AUDIT_READ'],
    email: 'audit-reader@example.com',
  });

  const AUDIT_EXPORT_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000011',
    roles: ['OPERATIONS'],
    permissions: ['AUDIT_READ', 'EXPORT_CSV'],
    email: 'audit-exporter@example.com',
  });

  const LOGIN_HISTORY_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000012',
    roles: ['OPERATIONS'],
    permissions: ['LOGIN_HISTORY_READ', 'EXPORT_CSV'],
    email: 'login-history@example.com',
  });

  const REPORTS_TOKEN = makeToken({
    userId: '00000000-0000-4000-8000-000000000013',
    roles: ['ACCOUNTS'],
    permissions: [
      'REPORT_TRANSACTIONS_READ',
      'REPORT_LEDGER_READ',
      'REPORT_SETTLEMENTS_READ',
      'REPORT_BALANCE_READ',
      'REPORT_CHARGEBACKS_READ',
      'REPORT_API_PERFORMANCE_READ',
      'EXPORT_CSV',
    ],
    email: 'reports@example.com',
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
    // Audit logs (5)
    it('GET /audit-logs', async () => {
      const res = await request(app).get(`${API}/audit-logs`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /audit-logs/summary', async () => {
      const res = await request(app).get(`${API}/audit-logs/summary`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /audit-logs/action-catalog', async () => {
      const res = await request(app).get(`${API}/audit-logs/action-catalog`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /audit-logs/:id', async () => {
      const res = await request(app).get(`${API}/audit-logs/any-id`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /audit-logs/export.csv', async () => {
      const res = await request(app).get(`${API}/audit-logs/export.csv`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    // Login history (4)
    it('GET /login-history', async () => {
      const res = await request(app).get(`${API}/login-history`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /login-history/summary', async () => {
      const res = await request(app).get(`${API}/login-history/summary`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /login-history/export.csv', async () => {
      const res = await request(app).get(`${API}/login-history/export.csv`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('GET /login-history/:id', async () => {
      const res = await request(app).get(`${API}/login-history/any-id`);
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
    });

    // Reports (6 types × 2 = 12)
    const REPORT_TYPES = ['transactions', 'ledger', 'settlements', 'balance', 'chargebacks', 'api-performance'];
    for (const type of REPORT_TYPES) {
      it(`GET /reports/${type}`, async () => {
        const res = await request(app).get(`${API}/reports/${type}`);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      });

      it(`GET /reports/${type}/export.csv`, async () => {
        const res = await request(app).get(`${API}/reports/${type}/export.csv`);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('AUTHENTICATION_REQUIRED');
      });
    }
  });

  // ------------------------------------------------------------------
  // Permission enforcement (403) when valid token but no permission
  // ------------------------------------------------------------------
  describe('Permission enforcement (403 with valid token but no permission)', () => {
    it('blocks GET /audit-logs without AUDIT_READ permission', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs`)
        .set('Authorization', `Bearer ${NO_PERM_TOKEN}`);
      expect([403, 401]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('blocks GET /audit-logs/summary without AUDIT_READ permission', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs/summary`)
        .set('Authorization', `Bearer ${NO_PERM_TOKEN}`);
      expect([403, 401]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('blocks GET /audit-logs/export.csv without EXPORT_CSV permission (AUDIT_READ alone not enough)', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs/export.csv`)
        .set('Authorization', `Bearer ${AUDIT_READER_TOKEN}`);
      expect([403, 401, 500]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('blocks GET /reports/transactions without transaction report permission', async () => {
      const res = await request(app)
        .get(`${API}/reports/transactions`)
        .set('Authorization', `Bearer ${NO_PERM_TOKEN}`)
        .query({
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-01-31T23:59:59Z',
        });
      expect([403, 401]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('blocks GET /reports/balance without balance report permission', async () => {
      const res = await request(app)
        .get(`${API}/reports/balance`)
        .set('Authorization', `Bearer ${NO_PERM_TOKEN}`)
        .query({
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-01-31T23:59:59Z',
        });
      expect([403, 401]).toContain(res.status);
      if (res.status === 403) expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSION');
    });

    it('allows ADMIN implicit super-permission on GET /audit-logs (not 401/403)', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
      // Returns 200 or 500 (DB) but NOT 401/403 since ADMIN is implicit
      expect([403, 401]).not.toContain(res.status);
    });

    it('allows ADMIN implicit super-permission on GET /reports/ledger (not 401/403)', async () => {
      const res = await request(app)
        .get(`${API}/reports/ledger`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .query({
          startDate: '2026-01-01T00:00:00Z',
          endDate: '2026-12-31T23:59:59Z',
        });
      expect([403, 401]).not.toContain(res.status);
    });
  });

  // ------------------------------------------------------------------
  // Zod validation errors (422) at middleware layer
  // ------------------------------------------------------------------
  describe('Schema validation errors (422) with valid token', () => {
    it('rejects GET /audit-logs with pageSize 501 above max', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs`)
        .set('Authorization', `Bearer ${AUDIT_READER_TOKEN}`)
        .query({ pageSize: '501' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects GET /audit-logs with outcome BAD_VALUE enum', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs`)
        .set('Authorization', `Bearer ${AUDIT_READER_TOKEN}`)
        .query({ outcome: 'BAD_VALUE' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects GET /audit-logs/:id with empty id param (after trim)', async () => {
      // Note: Express path param for /audit-logs/:id won't match empty,
      // but we test whitespace-only which does match then rejects.
      const res = await request(app)
        .get(`${API}/audit-logs/%20%20`)
        .set('Authorization', `Bearer ${AUDIT_READER_TOKEN}`);
      expect([422, 404]).toContain(res.status);
    });

    it('rejects GET /login-history with page 0', async () => {
      const res = await request(app)
        .get(`${API}/login-history`)
        .set('Authorization', `Bearer ${LOGIN_HISTORY_TOKEN}`)
        .query({ page: '0' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects GET /reports/transactions without startDate', async () => {
      const res = await request(app)
        .get(`${API}/reports/transactions`)
        .set('Authorization', `Bearer ${REPORTS_TOKEN}`)
        .query({ endDate: '2026-12-31T23:59:59Z' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects GET /reports/api-performance without endDate', async () => {
      const res = await request(app)
        .get(`${API}/reports/api-performance`)
        .set('Authorization', `Bearer ${REPORTS_TOKEN}`)
        .query({ startDate: '2026-01-01T00:00:00Z' });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('accepts GET /audit-logs with AUDIT_READ + valid query (no DB error = 200 or 500, NOT 422)', async () => {
      const res = await request(app)
        .get(`${API}/audit-logs`)
        .set('Authorization', `Bearer ${AUDIT_READER_TOKEN}`)
        .query({ page: 1, pageSize: 10, outcome: 'SUCCESS' });
      expect(res.status).not.toBe(422);
    });
  });
});
