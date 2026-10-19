import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';

const integration = process.env.RUN_DB_INTEGRATION === 'true' ? describe : describe.skip;

integration('administration configuration CRUD integration', () => {
  const app = createApp();
  let token = '';
  const created: Array<[string, string]> = [];
  const auth = () => ({ Authorization: `Bearer ${token}` });

  afterAll(async () => {
    for (const [resource, id] of [...created].reverse()) {
      await request(app).delete(`/api/v1/configuration/${resource}/${id}`).set(auth());
    }
  });

  it('creates, lists, updates, and deletes every connected resource', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ identifier: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    token = login.body.data.accessToken;
    const stamp = Date.now().toString(36).toUpperCase();

    const create = async (resource: string, body: object) => {
      const response = await request(app).post(`/api/v1/configuration/${resource}`).set(auth()).send(body);
      expect(response.status, `${resource} create: ${JSON.stringify(response.body)}`).toBe(201);
      created.push([resource, response.body.data.id]);
      return response.body.data;
    };
    const update = async (resource: string, id: string, body: object) => {
      const response = await request(app).put(`/api/v1/configuration/${resource}/${id}`).set(auth()).send(body);
      expect(response.status, `${resource} update: ${JSON.stringify(response.body)}`).toBe(200);
      return response.body.data;
    };

    const gateway = await create('gateways', { gatewayName: `Integration Gateway ${stamp}`, isActive: true });
    expect((await update('gateways', gateway.id, { gatewayName: `Updated Gateway ${stamp}`, isActive: true })).gatewayName).toBe(`Updated Gateway ${stamp}`);
    const method = await create('methods', { methodName: `Integration Method ${stamp}`, methodCode: `METHOD_${stamp}`, isActive: true });
    expect((await update('methods', method.id, { methodName: `Updated Method ${stamp}`, methodCode: `METHOD_${stamp}`, isActive: true })).methodName).toBe(`Updated Method ${stamp}`);
    const option = await create('options', { methodId: method.id, optionName: `Integration Option ${stamp}`, optionCode: `OPTION_${stamp}`, isActive: true });
    expect((await update('options', option.id, { methodId: method.id, optionName: `Updated Option ${stamp}`, optionCode: `OPTION_${stamp}`, isActive: true })).optionName).toBe(`Updated Option ${stamp}`);
    const mapping = await create('mappings', { gatewayId: gateway.id, methodId: method.id, isActive: true });
    expect((await update('mappings', mapping.id, { gatewayId: gateway.id, methodId: method.id, isActive: false })).isActive).toBe(0);
    const plan = await create('plans', { planName: `Integration Plan ${stamp}`, planPrice: 499, planDescription: 'Integration test plan', isActive: true });
    expect((await update('plans', plan.id, { planName: `Updated Plan ${stamp}`, planPrice: 599, planDescription: 'Updated integration test plan', isActive: true })).planPrice).toBe(599);

    const roles = await request(app).get('/api/v1/roles').set(auth());
    const role = roles.body.data.find((item: { category: string; isActive: boolean }) => item.isActive && ['SYSTEM', 'NETWORK'].includes(item.category));
    expect(role).toBeTruthy();
    const config = await create('plan-configurations', { planId: plan.id, gatewayId: gateway.id, roleId: role.id, isActive: true });
    expect(String((await update('plan-configurations', config.id, { planId: plan.id, gatewayId: gateway.id, roleId: role.id, isActive: false })).roleId)).toBe(String(role.id));
    const commission = await create('commissions', { planConfigId: config.id, methodId: method.id, methodOptionId: option.id, commissionRate: 1.25, isActive: true });
    expect((await update('commissions', commission.id, { planConfigId: config.id, methodId: method.id, methodOptionId: option.id, commissionRate: 1.5, isActive: true })).commissionRate).toBe(1.5);

    for (const resource of ['gateways', 'methods', 'options', 'mappings', 'plans', 'plan-configurations', 'commissions']) {
      const response = await request(app).get(`/api/v1/configuration/${resource}`).set(auth());
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    }

    const retailerLogin = await request(app).post('/api/v1/auth/login').send({
      identifier: 'retailer@brightspark.com',
      password: 'Demo@123456',
    });
    expect(retailerLogin.status).toBe(200);
    const retailerAuth = { Authorization: `Bearer ${retailerLogin.body.data.accessToken}` };
    const routingOptions = await request(app).get('/api/v1/configuration/payment-routing-options').set(retailerAuth);
    expect(routingOptions.status).toBe(200);
    expect(routingOptions.body.data).toEqual(expect.objectContaining({
      gateways: expect.any(Array), methods: expect.any(Array), options: expect.any(Array), mappings: expect.any(Array),
    }));
    const adminCatalogue = await request(app).get('/api/v1/configuration/gateways').set(retailerAuth);
    expect(adminCatalogue.status).toBe(403);
  });
});
