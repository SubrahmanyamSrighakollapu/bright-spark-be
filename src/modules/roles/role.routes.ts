import { Router } from 'express';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { createRoleSchema, listRolesSchema, roleIdSchema, updateRoleSchema } from './role.schemas.js';

interface RoleRow extends RowDataPacket {
  id: number; code: string; name: string; description: string | null; role_category: 'SYSTEM' | 'NETWORK' | 'EMPLOYEE';
  is_system: number; is_active: number; assigned_user_count: number; permissions: string | null; created_at: Date; updated_at: Date;
}

const roleSelect = `SELECT r.*, COUNT(DISTINCT ur.user_id) AS assigned_user_count,
  GROUP_CONCAT(DISTINCT p.code ORDER BY p.code) AS permissions
  FROM roles r LEFT JOIN user_roles ur ON ur.role_id = r.id
  LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id`;

function mapRole(row: RoleRow) {
  return { id: row.id, code: row.code, name: row.name, description: row.description, category: row.role_category,
    isSystem: Boolean(row.is_system), isActive: Boolean(row.is_active), assignedUserCount: Number(row.assigned_user_count),
    permissions: row.permissions ? row.permissions.split(',') : [], createdAt: row.created_at, updatedAt: row.updated_at };
}

async function ensurePermissions(connection: PoolConnection, codes: string[]) {
  const uniqueCodes = [...new Set(codes)];
  const [rows] = await connection.query<(RowDataPacket & { id: number; code: string })[]>(
    'SELECT id, code FROM permissions WHERE code IN (?)', [uniqueCodes],
  );
  if (rows.length !== uniqueCodes.length) {
    const found = new Set(rows.map((row) => row.code));
    throw new ApiError(422, 'UNKNOWN_PERMISSION', 'One or more permission codes are invalid', { codes: uniqueCodes.filter((code) => !found.has(code)) });
  }
  return rows;
}

export const roleRouter = Router();
roleRouter.use(authenticate);

roleRouter.get('/permissions', requirePermission('ROLE_READ'), asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<RowDataPacket[]>('SELECT code, module, action, description FROM permissions ORDER BY module, action');
  return sendSuccess(response, rows);
}));

roleRouter.get('/', requirePermission('ROLE_READ'), validate(listRolesSchema, 'query'), asyncHandler(async (request, response) => {
  const query = listRolesSchema.parse(request.query);
  const clauses: string[] = [];
  const values: unknown[] = [];
  if (query.category) { clauses.push('r.role_category = ?'); values.push(query.category); }
  if (!query.includeInactive) clauses.push('r.is_active = TRUE');
  const [rows] = await pool.query<RoleRow[]>(`${roleSelect} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} GROUP BY r.id ORDER BY r.role_category, r.name`, values);
  return sendSuccess(response, rows.map(mapRole));
}));

roleRouter.post('/', requirePermission('ROLE_CREATE'), validate(createRoleSchema), asyncHandler(async (request, response) => {
  const input = createRoleSchema.parse(request.body);
  const id = await withTransaction(async (connection) => {
    const permissions = await ensurePermissions(connection, input.permissionCodes);
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO roles (code, name, description, role_category, is_system, is_active, created_by)
       VALUES (?, ?, ?, 'EMPLOYEE', FALSE, TRUE, ?)`,
      [input.code, input.name, input.description ?? null, request.auth!.userId],
    );
    for (const permission of permissions) await connection.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [result.insertId, permission.id]);
    return result.insertId;
  });
  const [rows] = await pool.query<RoleRow[]>(`${roleSelect} WHERE r.id = ? GROUP BY r.id`, [id]);
  return sendSuccess(response, mapRole(rows[0]!), 201);
}));

roleRouter.patch('/:id', requirePermission('ROLE_UPDATE'), validate(roleIdSchema, 'params'), validate(updateRoleSchema), asyncHandler(async (request, response) => {
  const id = Number(request.params.id);
  const input = updateRoleSchema.parse(request.body);
  await withTransaction(async (connection) => {
    const [roles] = await connection.query<(RowDataPacket & { is_system: number; role_category: string })[]>('SELECT is_system, role_category FROM roles WHERE id = ? FOR UPDATE', [id]);
    const role = roles[0];
    if (!role) throw new ApiError(404, 'ROLE_NOT_FOUND', 'Role was not found');
    if (role.is_system || role.role_category !== 'EMPLOYEE') throw new ApiError(409, 'SYSTEM_ROLE_PROTECTED', 'System and network roles cannot be modified through employee role management');
    const fields: string[] = []; const values: unknown[] = [];
    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.isActive !== undefined) { fields.push('is_active = ?'); values.push(input.isActive); }
    if (fields.length) await connection.query(`UPDATE roles SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    if (input.permissionCodes) {
      const permissions = await ensurePermissions(connection, input.permissionCodes);
      await connection.execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
      for (const permission of permissions) await connection.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [id, permission.id]);
    }
  });
  const [rows] = await pool.query<RoleRow[]>(`${roleSelect} WHERE r.id = ? GROUP BY r.id`, [id]);
  return sendSuccess(response, mapRole(rows[0]!));
}));
