/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';
import { writeAuditLog, contextFromAuth } from '../../shared/audit.js';

export const configurationRouter = Router();
configurationRouter.use(authenticate);
const write = requirePermission('MASTER_DATA_WRITE');
const read = requirePermission('MASTER_DATA_READ');
const idSchema = z.string().uuid();
export const gatewaySchema = z.object({ gatewayName: z.string().trim().min(2).max(160), isActive: z.boolean().default(true) });
export const methodSchema = z.object({ methodName: z.string().trim().min(2).max(160), methodCode: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/), isActive: z.boolean().default(true) });
export const optionSchema = z.object({ methodId: z.string().uuid(), optionName: z.string().trim().min(2).max(160), optionCode: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/), isActive: z.boolean().default(true) });
export const mappingSchema = z.object({ gatewayId: z.string().uuid(), methodId: z.string().uuid(), isActive: z.boolean().default(true) });
export const planSchema = z.object({ planName: z.string().trim().min(2).max(160), planPrice: z.coerce.number().min(0), planDescription: z.string().trim().min(2).max(1000), isActive: z.boolean().default(true) });
export const configSchema = z.object({ planId: z.string().uuid(), gatewayId: z.string().uuid(), roleId: z.coerce.number().int().positive(), isActive: z.boolean().default(true) });
export const commissionSchema = z.object({ planConfigId: z.string().uuid(), methodId: z.string().uuid(), methodOptionId: z.string().uuid().nullable().optional(), commissionRate: z.coerce.number().positive(), isActive: z.boolean().default(true) });

const resources = {
  gateways: { table: 'payment_gateways', schema: gatewaySchema, columns: ['gateway_name', 'is_active'], values: (v: any) => [v.gatewayName, v.isActive], select: 'id, gateway_name AS gatewayName, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt' },
  methods: { table: 'payment_methods', schema: methodSchema, columns: ['method_name', 'method_code', 'is_active'], values: (v: any) => [v.methodName, v.methodCode, v.isActive], select: 'id, method_name AS methodName, method_code AS methodCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt' },
  options: { table: 'payment_method_options', schema: optionSchema, columns: ['method_id', 'option_name', 'option_code', 'is_active'], values: (v: any) => [v.methodId, v.optionName, v.optionCode, v.isActive], select: 'id, method_id AS methodId, option_name AS optionName, option_code AS optionCode, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt' },
  mappings: { table: 'gateway_method_mappings', schema: mappingSchema, columns: ['gateway_id', 'method_id', 'is_active'], values: (v: any) => [v.gatewayId, v.methodId, v.isActive], select: 'id, gateway_id AS gatewayId, method_id AS methodId, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt' },
  plans: { table: 'pricing_plans', schema: planSchema, columns: ['name', 'price', 'description', 'is_active', 'code', 'version', 'status'], values: (v: any) => [v.planName, v.planPrice, v.planDescription, v.isActive, `PLAN_${randomUUID().slice(0, 8).toUpperCase()}`, 1, v.isActive ? 'ACTIVE' : 'DRAFT'], updateColumns: ['name', 'price', 'description', 'is_active', 'status'], updateValues: (v: any) => [v.planName, v.planPrice, v.planDescription, v.isActive, v.isActive ? 'ACTIVE' : 'DRAFT'], tracksActor: false, select: "id, name AS planName, CAST(price AS DOUBLE) AS planPrice, COALESCE(description, '') AS planDescription, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt" },
  'plan-configurations': { table: 'plan_gateway_role_configs', schema: configSchema, columns: ['plan_id', 'gateway_id', 'role_id', 'is_active'], values: (v: any) => [v.planId, v.gatewayId, v.roleId, v.isActive], select: 'id, plan_id AS planId, gateway_id AS gatewayId, role_id AS roleId, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt' },
  commissions: { table: 'plan_commissions', schema: commissionSchema, columns: ['plan_config_id', 'method_id', 'method_option_id', 'commission_rate', 'is_active'], values: (v: any) => [v.planConfigId, v.methodId, v.methodOptionId ?? null, v.commissionRate, v.isActive], select: 'id, plan_config_id AS planConfigId, method_id AS methodId, method_option_id AS methodOptionId, CAST(commission_rate AS DOUBLE) AS commissionRate, is_active AS isActive, created_at AS createdAt, updated_at AS updatedAt' },
} as const;

configurationRouter.use('/plan-configurations', asyncHandler(async (request, _response, next) => {
  if (!['POST', 'PUT'].includes(request.method)) return next();
  const roleId = z.coerce.number().int().positive().parse(request.body?.roleId);
  const [roles] = await pool.query<RowDataPacket[]>("SELECT id FROM roles WHERE id = ? AND role_category IN ('SYSTEM','NETWORK') AND is_active = TRUE", [roleId]);
  if (!roles[0]) throw new ApiError(422, 'ROLE_NOT_ELIGIBLE', 'Only active system or network roles can be used in plan configuration');
  next();
}));

configurationRouter.get('/payment-routing-options', asyncHandler(async (_request, response) => {
  const [gateways] = await pool.query<RowDataPacket[]>('SELECT id, gateway_name AS gatewayName FROM payment_gateways WHERE is_active = TRUE ORDER BY gateway_name');
  const [methods] = await pool.query<RowDataPacket[]>('SELECT id, method_name AS methodName, method_code AS methodCode FROM payment_methods WHERE is_active = TRUE ORDER BY method_name');
  const [options] = await pool.query<RowDataPacket[]>('SELECT id, method_id AS methodId, option_name AS optionName, option_code AS optionCode FROM payment_method_options WHERE is_active = TRUE ORDER BY option_name');
  const [mappings] = await pool.query<RowDataPacket[]>('SELECT id, gateway_id AS gatewayId, method_id AS methodId FROM gateway_method_mappings WHERE is_active = TRUE');
  return sendSuccess(response, { gateways, methods, options, mappings });
}));

for (const [path, spec] of Object.entries(resources)) {
  configurationRouter.get(`/${path}`, read, asyncHandler(async (_req, res) => { const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${spec.select} FROM ${spec.table} ORDER BY created_at DESC`); return sendSuccess(res, rows); }));
  configurationRouter.post(`/${path}`, write, asyncHandler(async (req, res) => { const input = spec.schema.parse(req.body) as any; const id = randomUUID(); const tracksActor = !('tracksActor' in spec) || spec.tracksActor !== false; const actorColumns = tracksActor ? ', created_by, updated_by' : ''; const actorPlaceholders = tracksActor ? ', ?, ?' : ''; const actorValues = tracksActor ? [req.auth!.userId, req.auth!.userId] : []; await pool.execute(`INSERT INTO ${spec.table} (id, ${spec.columns.join(', ')}${actorColumns}) VALUES (?, ${spec.columns.map(() => '?').join(', ')}${actorPlaceholders})`, [id, ...spec.values(input), ...actorValues]); await writeAuditLog({ action: 'CONFIGURATION_CREATED', resourceType: path.toUpperCase(), resourceId: id, afterData: input }, contextFromAuth(req.auth)); const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${spec.select} FROM ${spec.table} WHERE id = ?`, [id]); return sendSuccess(res, rows[0], 201); }));
  configurationRouter.put(`/${path}/:id`, write, asyncHandler(async (req, res) => { const id = idSchema.parse(req.params.id); const input = spec.schema.parse(req.body) as any; const columns = 'updateColumns' in spec ? spec.updateColumns : spec.columns; const values = 'updateValues' in spec ? spec.updateValues(input) : spec.values(input); const tracksActor = !('tracksActor' in spec) || spec.tracksActor !== false; const actorAssignment = tracksActor ? ', updated_by = ?' : ''; const actorValues = tracksActor ? [req.auth!.userId] : []; const [result] = await pool.execute<ResultSetHeader>(`UPDATE ${spec.table} SET ${columns.map((column) => `${column} = ?`).join(', ')}${actorAssignment} WHERE id = ?`, [...values, ...actorValues, id]); if (!result.affectedRows) throw new ApiError(404, 'CONFIGURATION_NOT_FOUND', 'Configuration record was not found'); await writeAuditLog({ action: 'CONFIGURATION_UPDATED', resourceType: path.toUpperCase(), resourceId: id, afterData: input }, contextFromAuth(req.auth)); const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${spec.select} FROM ${spec.table} WHERE id = ?`, [id]); return sendSuccess(res, rows[0]); }));
  configurationRouter.delete(`/${path}/:id`, write, asyncHandler(async (req, res) => { const id = idSchema.parse(req.params.id); const [result] = await pool.execute<ResultSetHeader>(`DELETE FROM ${spec.table} WHERE id = ?`, [id]); if (!result.affectedRows) throw new ApiError(404, 'CONFIGURATION_NOT_FOUND', 'Configuration record was not found'); await writeAuditLog({ action: 'CONFIGURATION_DELETED', resourceType: path.toUpperCase(), resourceId: id }, contextFromAuth(req.auth)); return sendSuccess(res, { deleted: true }); }));
}
