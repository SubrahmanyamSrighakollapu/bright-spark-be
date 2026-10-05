import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';

const categoryParams = z.object({ category: z.string().trim().min(2).max(50).regex(/^[A-Z0-9_]+$/) });
const idParams = z.object({ id: z.string().uuid() });
const listQuery = z.object({ includeInactive: z.coerce.boolean().default(false) });
const createSchema = z.object({
  code: z.string().trim().min(1).max(100).regex(/^[A-Z0-9_-]+$/),
  label: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  configuration: z.record(z.string(), z.unknown()).optional(),
  sortOrder: z.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});
const updateSchema = createSchema.partial().extend({ versionReason: z.string().trim().min(3).max(500) });

interface MasterRow extends RowDataPacket {
  id: string; category: string; code: string; label: string; description: string | null;
  configuration: unknown; sort_order: number; is_active: number; created_at: Date; updated_at: Date;
}

function mapRow(row: MasterRow) {
  return { id: row.id, category: row.category, code: row.code, label: row.label, description: row.description, configuration: row.configuration, sortOrder: row.sort_order, isActive: Boolean(row.is_active), createdAt: row.created_at, updatedAt: row.updated_at };
}

export const masterDataRouter = Router();
masterDataRouter.use(authenticate);

masterDataRouter.get('/:category', requirePermission('MASTER_DATA_READ'), validate(categoryParams, 'params'), validate(listQuery, 'query'), asyncHandler(async (request, response) => {
  const { category } = categoryParams.parse(request.params);
  const { includeInactive } = listQuery.parse(request.query);
  const [rows] = await pool.query<MasterRow[]>(
    `SELECT * FROM master_data WHERE category = ? ${includeInactive ? '' : 'AND is_active = TRUE'} ORDER BY sort_order, label`, [category],
  );
  return sendSuccess(response, rows.map(mapRow));
}));

masterDataRouter.post('/:category', requirePermission('MASTER_DATA_WRITE'), validate(categoryParams, 'params'), validate(createSchema), asyncHandler(async (request, response) => {
  const { category } = categoryParams.parse(request.params);
  const input = createSchema.parse(request.body);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO master_data (id, category, code, label, description, configuration, sort_order, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, category, input.code, input.label, input.description ?? null, input.configuration ? JSON.stringify(input.configuration) : null, input.sortOrder, input.isActive, request.auth!.userId],
  );
  const [rows] = await pool.query<MasterRow[]>('SELECT * FROM master_data WHERE id = ?', [id]);
  return sendSuccess(response, mapRow(rows[0]!), 201);
}));

masterDataRouter.patch('/item/:id', requirePermission('MASTER_DATA_WRITE'), validate(idParams, 'params'), validate(updateSchema), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const input = updateSchema.parse(request.body);
  const fields: string[] = [];
  const values: unknown[] = [];
  const mapping = { code: 'code', label: 'label', description: 'description', configuration: 'configuration', sortOrder: 'sort_order', isActive: 'is_active' } as const;
  for (const [key, column] of Object.entries(mapping)) {
    const value = input[key as keyof typeof mapping];
    if (value !== undefined) { fields.push(`${column} = ?`); values.push(key === 'configuration' ? JSON.stringify(value) : value); }
  }
  if (!fields.length) throw new ApiError(422, 'NO_CHANGES', 'At least one field must be updated');
  const [result] = await pool.query<ResultSetHeader>(`UPDATE master_data SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
  if (result.affectedRows !== 1) throw new ApiError(404, 'MASTER_DATA_NOT_FOUND', 'Master-data item was not found');
  const [rows] = await pool.query<MasterRow[]>('SELECT * FROM master_data WHERE id = ?', [id]);
  return sendSuccess(response, mapRow(rows[0]!));
}));
