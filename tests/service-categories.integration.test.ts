import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { env } from '../src/config/env.js';

const integration = process.env.RUN_DB_INTEGRATION === 'true' ? describe : describe.skip;

integration('service category and product CRUD integration', () => {
  const app = createApp();

  it('persists and manages the full catalogue lifecycle', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({
      identifier: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
    });
    expect(login.status).toBe(200);
    const auth = { Authorization: `Bearer ${login.body.data.accessToken}` };
    const stamp = Date.now().toString(36).toUpperCase();

    const created = await request(app).post('/api/v1/service-categories').set(auth).send({
      code: `TEST_${stamp}`,
      name: `Test Category ${stamp}`,
      description: 'Integration test category',
      iconName: 'ShoppingBag',
      pricingMode: 'BOTH',
      status: 'ACTIVE',
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const categoryId = created.body.data.id;

    const updated = await request(app).put(`/api/v1/service-categories/${categoryId}`).set(auth).send({
      code: `TEST_${stamp}`,
      name: `Updated Category ${stamp}`,
      description: 'Updated integration test category',
      iconName: 'Receipt',
      pricingMode: 'PRESET_ONLY',
      status: 'ACTIVE',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe(`Updated Category ${stamp}`);

    const product = await request(app).post(`/api/v1/service-categories/${categoryId}/products`).set(auth).send({
      code: `TEST_PRODUCT_${stamp}`,
      name: 'Test Product',
      description: 'Integration test product',
      price: 125.5,
      status: 'ACTIVE',
    });
    expect(product.status, JSON.stringify(product.body)).toBe(201);
    const productId = product.body.data.products[0].id;

    const productUpdate = await request(app)
      .put(`/api/v1/service-categories/${categoryId}/products/${productId}`)
      .set(auth).send({
        code: `TEST_PRODUCT_${stamp}`,
        name: 'Updated Test Product',
        description: 'Updated integration test product',
        price: 199.75,
        badge: 'Popular',
        status: 'ACTIVE',
      });
    expect(productUpdate.status).toBe(200);
    expect(productUpdate.body.data.products[0].price).toBe(199.75);

    const productStatus = await request(app)
      .patch(`/api/v1/service-categories/${categoryId}/products/${productId}/status`)
      .set(auth).send({ status: 'INACTIVE' });
    expect(productStatus.status).toBe(200);
    expect(productStatus.body.data.products[0].status).toBe('INACTIVE');

    const active = await request(app).get('/api/v1/service-categories?activeOnly=true').set(auth);
    expect(active.status).toBe(200);
    expect(active.body.data.find((item: { id: string }) => item.id === categoryId).products).toHaveLength(0);

    const categoryStatus = await request(app)
      .patch(`/api/v1/service-categories/${categoryId}/status`)
      .set(auth).send({ status: 'INACTIVE' });
    expect(categoryStatus.status).toBe(200);
    expect(categoryStatus.body.data.status).toBe('INACTIVE');

    const productDeleted = await request(app)
      .delete(`/api/v1/service-categories/${categoryId}/products/${productId}`).set(auth);
    expect(productDeleted.status).toBe(200);
    expect(productDeleted.body.data.products).toHaveLength(0);

    const deleted = await request(app).delete(`/api/v1/service-categories/${categoryId}`).set(auth);
    expect(deleted.status).toBe(200);
  });
});
