import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import jwt from 'jsonwebtoken';
import { env } from '../src/config/env.js';

describe('API shell', () => {
  const app = createApp();

  it('uses a restricted configured trusted-proxy policy', () => {
    expect(app.get('trust proxy')).toBe(env.TRUST_PROXY);
    expect(app.get('trust proxy')).not.toBe(true);
    const trustProxy = app.get('trust proxy fn') as (address: string, hop: number) => boolean;
    expect(trustProxy('127.0.0.1', 0)).toBe(true);
    expect(trustProxy('203.0.113.10', 0)).toBe(false);
  });

  it('returns liveness without requiring the database', async () => {
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.status).toBe('ok');
    expect(response.headers['x-request-id']).toBeTruthy();
  });

  it('returns the standard not-found error envelope', async () => {
    const response = await request(app).get('/not-a-route');
    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('ROUTE_NOT_FOUND');
  });

  it('serves a complete OpenAPI document in the test environment', async () => {
    const response = await request(app).get('/api-docs.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.1.0');
    const pathCount = Object.keys(response.body.paths).length;
    expect(pathCount).toBeGreaterThanOrEqual(42);
    const operationCount = Object.values(response.body.paths as Record<string, object>)
      .reduce((count, pathItem) => count + Object.keys(pathItem).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
    expect(operationCount).toBeGreaterThanOrEqual(47);
    expect(response.body.paths['/api/v1/parties'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/master-data/item/{id}'].patch.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/roles'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/employees'].post.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/employees/{id}'].put.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/employees/{id}/reset-password'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/auth/change-password'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/audit-logs'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/login-history'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/login-history/session/{sessionId}/location'].patch.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/reports/transactions'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/reports/balance/export.csv'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/payout-charge-rules'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/payout-charge-rules/resolve'].get.parameters).toHaveLength(2);
    expect(response.body.paths['/api/v1/payout-charge-rules/{id}'].put.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/configuration/gateways'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/configuration/payment-routing-options'].get.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/configuration/plan-configurations/{id}'].put.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/configuration/commissions/{id}'].delete.security).toEqual([{ bearerAuth: [] }]);
  });

  it('answers PATCH preflight requests with all frontend headers', async () => {
    const response = await request(app)
      .options('/api/v1/employees/00000000-0000-4000-8000-000000000000/status')
      .set('Origin', 'http://192.168.1.25:3000')
      .set('Access-Control-Request-Method', 'PATCH')
      .set('Access-Control-Request-Headers', 'authorization,content-type,x-client-platform,x-request-id');
    expect(response.status).toBe(200);
    expect(response.headers['access-control-allow-origin']).toBe('http://192.168.1.25:3000');
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    expect(response.headers['access-control-allow-headers'].toLowerCase()).toContain('x-client-platform');
  });

  it('allows a temporary-password session to reach password change but blocks normal APIs', async () => {
    const accessToken = jwt.sign({ partyId: null, email: 'temp@example.com', roles: ['RETAILER'],
      permissions: ['USER_READ'], mustChangePassword: true }, env.JWT_ACCESS_SECRET,
      { subject: '00000000-0000-4000-8000-000000000001', issuer: 'bright-spark-api', audience: 'bright-spark-web', expiresIn: '5m' });
    const [changePassword, protectedApi] = await Promise.all([
      request(app).post('/api/v1/auth/change-password').set('Authorization', `Bearer ${accessToken}`).send({}),
      request(app).get('/api/v1/users').set('Authorization', `Bearer ${accessToken}`),
    ]);
    expect(changePassword.status).toBe(422);
    expect(changePassword.body.error.code).toBe('VALIDATION_ERROR');
    expect(protectedApi.status).toBe(403);
    expect(protectedApi.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });

  it('protects role and employee management routes', async () => {
    const [roles, employees] = await Promise.all([
      request(app).get('/api/v1/roles'),
      request(app).get('/api/v1/employees'),
    ]);
    expect(roles.status).toBe(401);
    expect(employees.status).toBe(401);
  });

  it('protects payout charge configuration and resolution routes', async () => {
    const [rules, resolution] = await Promise.all([
      request(app).get('/api/v1/payout-charge-rules'),
      request(app).get('/api/v1/payout-charge-rules/resolve?payoutMode=IMPS&amount=1000'),
    ]);
    expect(rules.status).toBe(401);
    expect(resolution.status).toBe(401);
  });

  it('protects all administration configuration resources', async () => {
    const resources = ['gateways', 'methods', 'options', 'mappings', 'plans', 'plan-configurations', 'commissions'];
    const responses = await Promise.all(resources.map((resource) => request(app).get(`/api/v1/configuration/${resource}`)));
    expect(responses.every((response) => response.status === 401 && response.body.error.code === 'AUTHENTICATION_REQUIRED')).toBe(true);
  });

  it('rejects protected routes without a bearer token', async () => {
    const response = await request(app).get('/api/v1/parties');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('validates login payloads before touching the database', async () => {
    const response = await request(app).post('/api/v1/auth/login').send({ identifier: 'x', password: 'x' });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
