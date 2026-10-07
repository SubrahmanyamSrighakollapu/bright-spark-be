import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';

export const planRouter = Router();
planRouter.use(authenticate);

interface PlanRow extends RowDataPacket {
  id: string; code: string; name: string; version: number; status: string; created_at: Date;
}

const defaultPlans = [
  {
    id: 'plan_std',
    code: 'DEFAULT_RETAILER',
    name: 'Standard Retailer Plan',
    description: 'Default commission plan for standard retail partners',
    version: 1,
    status: 'ACTIVE',
    commissionType: 'SLAB',
    defaultMargin: '0.40%',
    assignedRetailersCount: 12,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'plan_gold',
    code: 'GOLD_COMMISSION',
    name: 'Gold Retailer Plan',
    description: 'High volume commission plan with 0.60% UPI margin',
    version: 1,
    status: 'ACTIVE',
    commissionType: 'FLAT',
    defaultMargin: '0.60%',
    assignedRetailersCount: 5,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'plan_plat',
    code: 'PLATINUM_COMMISSION',
    name: 'Platinum Partner Plan',
    description: 'VIP distributor plan with maximum payout commission rates',
    version: 1,
    status: 'ACTIVE',
    commissionType: 'FLAT',
    defaultMargin: '0.80%',
    assignedRetailersCount: 2,
    createdAt: new Date().toISOString(),
  },
];

// 1. GET /plans - List all plans
planRouter.get('/', asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<PlanRow[]>('SELECT * FROM pricing_plans ORDER BY created_at DESC');

  if (rows.length === 0) {
    return sendSuccess(response, defaultPlans);
  }

  return sendSuccess(response, rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    description: `${r.name} commission plan configuration`,
    version: r.version,
    status: r.status,
    commissionType: 'SLAB',
    defaultMargin: '0.50%',
    assignedRetailersCount: 4,
    createdAt: r.created_at,
  })));
}));

// 2. GET /plans/commissions - Get plan commissions (STATIC ROUTE BEFORE PARAM /:id)
planRouter.get('/commissions', asyncHandler(async (request, response) => {
  const planId = request.query.planId ? String(request.query.planId) : undefined;
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT * FROM master_data WHERE category = 'PLAN_COMMISSION_CONFIG' ${planId ? 'AND label = ?' : ''}`,
    planId ? [planId] : []
  );

  const defaultCommissions = [
    { serviceType: 'MOBILE_RECHARGE', commissionRate: 0.50, commissionType: 'PERCENTAGE' },
    { serviceType: 'DTH', commissionRate: 0.60, commissionType: 'PERCENTAGE' },
    { serviceType: 'BBPS', commissionRate: 1.50, commissionType: 'FLAT' },
    { serviceType: 'AEPS', commissionRate: 8.00, commissionType: 'FLAT' },
    { serviceType: 'PAYOUT', commissionRate: 3.50, commissionType: 'FLAT' },
  ];

  if (rows.length === 0) {
    return sendSuccess(response, defaultCommissions);
  }

  return sendSuccess(response, rows.map((r) => {
    return r.configuration ? (typeof r.configuration === 'string' ? JSON.parse(r.configuration) : r.configuration) : r;
  }));
}));

// 3. POST /plans/commissions - Configure commission slab
const planCommissionSchema = z.object({
  planId: z.string(),
  roleId: z.number().int().optional(),
  gatewayId: z.string().optional(),
  serviceType: z.string().default('RECHARGE'),
  commissionRate: z.number().default(0.50),
  commissionType: z.enum(['FLAT', 'PERCENTAGE']).default('PERCENTAGE'),
});

planRouter.post('/commissions', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const input = planCommissionSchema.parse(request.body);
  const commId = randomUUID();

  await pool.execute(
    `INSERT INTO master_data (id, category, code, label, description, configuration, is_active, created_by)
     VALUES (?, 'PLAN_COMMISSION_CONFIG', ?, ?, 'Plan Commission Config', ?, TRUE, ?)`,
    [commId, `${input.planId}_${input.serviceType}`, input.planId, JSON.stringify(input), request.auth!.userId]
  );

  return sendSuccess(response, { id: commId, ...input }, 201);
}));

// 4. User Plan Mapping Endpoints (manageUserPlans)
const userPlanMappingSchema = z.object({
  userId: z.string().uuid(),
  planId: z.string(),
  planStartDate: z.string().optional(),
  planEndDate: z.string().optional(),
  isActive: z.boolean().default(true),
});

planRouter.post('/user-plan-mapping', requirePermission('USER_WRITE'), asyncHandler(async (request, response) => {
  const input = userPlanMappingSchema.parse(request.body);
  const mappingId = randomUUID();

  await pool.execute(
    `INSERT INTO master_data (id, category, code, label, description, configuration, is_active, created_by)
     VALUES (?, 'USER_PLAN_MAPPING', ?, 'User Plan Mapping', ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE configuration = VALUES(configuration), is_active = VALUES(is_active)`,
    [mappingId, input.userId, `Plan: ${input.planId}`, JSON.stringify(input), input.isActive, request.auth!.userId]
  );

  return sendSuccess(response, { mappingId, ...input }, 201);
}));

// 5. GET /plans/user-mapping/:userId - Get mapped plan for a user
planRouter.get('/user-mapping/:userId', asyncHandler(async (request, response) => {
  const userId = request.params.userId as string;
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT * FROM master_data WHERE category = 'USER_PLAN_MAPPING' AND code = ?",
    [userId]
  );

  if (rows[0] && rows[0].configuration) {
    const config = typeof rows[0].configuration === 'string' ? JSON.parse(rows[0].configuration) : rows[0].configuration;
    return sendSuccess(response, config);
  }

  return sendSuccess(response, {
    userId,
    planId: 'plan_std',
    planCode: 'DEFAULT_RETAILER',
    planName: 'Standard Retailer Plan',
    isActive: true,
  });
}));

// 6. GET /plans/:id - Get single plan by ID
planRouter.get('/:id', asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const [rows] = await pool.query<PlanRow[]>('SELECT * FROM pricing_plans WHERE id = ? OR code = ?', [id, id]);
  if (!rows[0]) {
    const fallback = defaultPlans.find((p) => p.id === id || p.code === id);
    if (fallback) return sendSuccess(response, fallback);
    throw new ApiError(404, 'PLAN_NOT_FOUND', 'Plan not found');
  }
  const r = rows[0];
  return sendSuccess(response, {
    id: r.id,
    code: r.code,
    name: r.name,
    version: r.version,
    status: r.status,
    createdAt: r.created_at,
  });
}));

// 7. POST /plans - Create or update plan
const planSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(160),
  description: z.string().trim().optional(),
  version: z.number().int().default(1),
  status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'RETIRED']).default('ACTIVE'),
});

planRouter.post('/', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const input = planSchema.parse(request.body);
  const id = input.id || randomUUID();
  const dbStatus = input.status === 'INACTIVE' ? 'DRAFT' : input.status;

  await pool.execute(
    `INSERT INTO pricing_plans (id, code, name, version, status)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name = VALUES(name), version = VALUES(version), status = VALUES(status)`,
    [id, input.code.toUpperCase(), input.name, input.version, dbStatus]
  );

  return sendSuccess(response, {
    id,
    code: input.code.toUpperCase(),
    name: input.name,
    description: input.description,
    version: input.version,
    status: input.status,
    assignedRetailersCount: 0,
    createdAt: new Date().toISOString(),
  }, 201);
}));

// 8. PATCH /plans/:id/status - Toggle plan status
planRouter.patch('/:id/status', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'DRAFT', 'RETIRED']) }).parse(request.body);
  const dbStatus = status === 'INACTIVE' ? 'DRAFT' : status;

  await pool.query('UPDATE pricing_plans SET status = ? WHERE id = ?', [dbStatus, id]);
  const [rows] = await pool.query<PlanRow[]>('SELECT * FROM pricing_plans WHERE id = ?', [id]);

  if (!rows[0]) {
    throw new ApiError(404, 'PLAN_NOT_FOUND', 'Pricing plan not found');
  }

  const r = rows[0];
  return sendSuccess(response, {
    id: r.id,
    code: r.code,
    name: r.name,
    version: r.version,
    status: status,
    createdAt: r.created_at,
  });
}));

// 9. DELETE /plans/:id - Delete plan
planRouter.delete('/:id', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  await pool.execute('DELETE FROM pricing_plans WHERE id = ?', [id]);
  return sendSuccess(response, { deleted: true });
}));
