import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';

export const providerRouter = Router();
providerRouter.use(authenticate);

interface ProviderRow extends RowDataPacket {
  id: string; code: string; name: string; provider_type: string; environment: string; status: string; base_url: string | null; configuration: string | null; created_at: Date; updated_at: Date;
}

interface RoutingRow extends RowDataPacket {
  id: string; service_type: string; payment_mode: string | null; provider_id: string; fallback_provider_id: string | null; priority: number; is_active: number; provider_name?: string; fallback_name?: string;
}

interface WebhookRow extends RowDataPacket {
  id: string; name: string; url: string; subscribed_events: string; is_active: number; provider_id: string | null; created_at: Date;
}

// 1. GET /providers - List all providers
providerRouter.get('/', requirePermission('PROVIDER_READ'), asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<ProviderRow[]>('SELECT * FROM providers ORDER BY name ASC');
  const items = rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    providerType: r.provider_type,
    environment: r.environment,
    status: r.status,
    baseUrl: r.base_url,
    configuration: r.configuration ? (typeof r.configuration === 'string' ? JSON.parse(r.configuration) : r.configuration) : null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
  return sendSuccess(response, items);
}));

// 2. POST /providers - Create provider
const createProviderSchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(160),
  providerType: z.enum(['KYC', 'PAY_IN', 'PAY_OUT', 'NOTIFICATION', 'SETTLEMENT', 'MULTI_SERVICE']).default('MULTI_SERVICE'),
  environment: z.enum(['SANDBOX', 'PRODUCTION']).default('SANDBOX'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'DEGRADED', 'MAINTENANCE']).default('ACTIVE'),
  baseUrl: z.string().trim().optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
});

providerRouter.post('/', requirePermission('PROVIDER_WRITE'), asyncHandler(async (request, response) => {
  const input = createProviderSchema.parse(request.body);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO providers (id, code, name, provider_type, environment, status, base_url, configuration)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), provider_type = VALUES(provider_type), environment = VALUES(environment), status = VALUES(status), base_url = VALUES(base_url), configuration = VALUES(configuration)`,
    [id, input.code.toUpperCase(), input.name, input.providerType, input.environment, input.status, input.baseUrl || null, input.configuration ? JSON.stringify(input.configuration) : null]
  );
  const [rows] = await pool.query<ProviderRow[]>('SELECT * FROM providers WHERE code = ?', [input.code.toUpperCase()]);
  const r = rows[0]!;
  return sendSuccess(response, {
    id: r.id,
    code: r.code,
    name: r.name,
    providerType: r.provider_type,
    environment: r.environment,
    status: r.status,
    baseUrl: r.base_url,
    configuration: r.configuration ? (typeof r.configuration === 'string' ? JSON.parse(r.configuration) : r.configuration) : null,
  }, 201);
}));

// 3. PATCH /providers/:id - Update provider
const updateProviderSchema = createProviderSchema.partial();

providerRouter.patch('/:id', requirePermission('PROVIDER_WRITE'), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const input = updateProviderSchema.parse(request.body);
  const fields: string[] = [];
  const values: unknown[] = [];

  if (input.name) { fields.push('name = ?'); values.push(input.name); }
  if (input.providerType) { fields.push('provider_type = ?'); values.push(input.providerType); }
  if (input.environment) { fields.push('environment = ?'); values.push(input.environment); }
  if (input.status) { fields.push('status = ?'); values.push(input.status); }
  if (input.baseUrl !== undefined) { fields.push('base_url = ?'); values.push(input.baseUrl || null); }
  if (input.configuration) { fields.push('configuration = ?'); values.push(JSON.stringify(input.configuration)); }

  if (fields.length > 0) {
    await pool.query(`UPDATE providers SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  }

  const [rows] = await pool.query<ProviderRow[]>('SELECT * FROM providers WHERE id = ?', [id]);
  if (!rows[0]) throw new ApiError(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  const r = rows[0];
  return sendSuccess(response, {
    id: r.id,
    code: r.code,
    name: r.name,
    providerType: r.provider_type,
    environment: r.environment,
    status: r.status,
    baseUrl: r.base_url,
    configuration: r.configuration ? (typeof r.configuration === 'string' ? JSON.parse(r.configuration) : r.configuration) : null,
  });
}));

// 4. GET /providers/routing - Routing Rules
providerRouter.get('/routing', requirePermission('PROVIDER_READ'), asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<RoutingRow[]>(`
    SELECT r.*, p1.name AS provider_name, p2.name AS fallback_name
    FROM routing_rules r
    LEFT JOIN providers p1 ON p1.id = r.provider_id
    LEFT JOIN providers p2 ON p2.id = r.fallback_provider_id
    ORDER BY r.priority ASC
  `);
  return sendSuccess(response, rows.map((r) => ({
    id: r.id,
    serviceType: r.service_type,
    paymentMode: r.payment_mode,
    providerId: r.provider_id,
    providerName: r.provider_name || 'Default Provider',
    fallbackProviderId: r.fallback_provider_id,
    fallbackName: r.fallback_name || null,
    priority: r.priority,
    isActive: Boolean(r.is_active),
  })));
}));

// 5. POST /providers/routing - Set routing rule
const routingSchema = z.object({
  serviceType: z.string().trim().min(2).max(50),
  paymentMode: z.string().trim().optional(),
  providerId: z.string().trim(),
  fallbackProviderId: z.string().trim().optional(),
  priority: z.number().int().default(100),
  isActive: z.boolean().default(true),
});

providerRouter.post('/routing', requirePermission('PROVIDER_WRITE'), asyncHandler(async (request, response) => {
  const input = routingSchema.parse(request.body);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO routing_rules (id, service_type, payment_mode, provider_id, fallback_provider_id, priority, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, input.serviceType, input.paymentMode || null, input.providerId, input.fallbackProviderId || null, input.priority, input.isActive]
  );
  return sendSuccess(response, { id, ...input }, 201);
}));

// 6. GET /providers/webhooks - List Webhook endpoints
providerRouter.get('/webhooks', requirePermission('PROVIDER_READ'), asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<WebhookRow[]>('SELECT * FROM webhook_endpoints ORDER BY created_at DESC');
  return sendSuccess(response, rows.map((r) => ({
    id: r.id,
    name: r.name,
    url: r.url,
    subscribedEvents: r.subscribed_events,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
  })));
}));

// 7. POST /providers/webhooks - Add webhook endpoint
const webhookSchema = z.object({
  name: z.string().trim().min(2).max(160),
  url: z.string().trim().url(),
  subscribedEvents: z.string().trim().default('*'),
  signingSecret: z.string().trim().default('whsec_demo_secret'),
  isActive: z.boolean().default(true),
});

providerRouter.post('/webhooks', requirePermission('PROVIDER_WRITE'), asyncHandler(async (request, response) => {
  const input = webhookSchema.parse(request.body);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO webhook_endpoints (id, name, url, signing_secret_reference, subscribed_events, is_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, input.name, input.url, input.signingSecret, input.subscribedEvents, input.isActive]
  );
  return sendSuccess(response, { id, ...input }, 201);
}));
