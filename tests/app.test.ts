import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

describe('API shell', () => {
  const app = createApp();

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
    expect(Object.keys(response.body.paths)).toHaveLength(21);
    const operationCount = Object.values(response.body.paths as Record<string, object>)
      .reduce((count, pathItem) => count + Object.keys(pathItem).filter((key) => ['get', 'post', 'put', 'patch', 'delete'].includes(key)).length, 0);
    expect(operationCount).toBe(26);
    expect(response.body.paths['/api/v1/parties'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/master-data/item/{id}'].patch.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/roles'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/employees'].post.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/employees/{id}'].put.requestBody).toBeTruthy();
    expect(response.body.paths['/api/v1/employees/{id}/reset-password'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(response.body.paths['/api/v1/auth/change-password'].post.security).toEqual([{ bearerAuth: [] }]);
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

  it('protects role and employee management routes', async () => {
    const [roles, employees] = await Promise.all([
      request(app).get('/api/v1/roles'),
      request(app).get('/api/v1/employees'),
    ]);
    expect(roles.status).toBe(401);
    expect(employees.status).toBe(401);
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
