import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { createEmployeeSchema, listEmployeesSchema } from './employee.schemas.js';

interface EmployeeRow extends RowDataPacket {
  id: string; user_id: string; employee_code: string; full_name: string; email: string; mobile: string | null;
  user_status: string; department_code: string; designation: string | null; manager_user_id: string | null;
  joining_date: string | null; employment_status: string; role_id: number; role_code: string; role_name: string;
  created_at: Date; updated_at: Date;
}

function mapEmployee(row: EmployeeRow) {
  return { id: row.id, userId: row.user_id, employeeCode: row.employee_code, fullName: row.full_name, email: row.email,
    mobile: row.mobile, accountStatus: row.user_status, departmentCode: row.department_code, designation: row.designation,
    managerUserId: row.manager_user_id, joiningDate: row.joining_date, employmentStatus: row.employment_status,
    role: { id: row.role_id, code: row.role_code, name: row.role_name }, createdAt: row.created_at, updatedAt: row.updated_at };
}

const employeeSelect = `SELECT ep.*, u.full_name, u.email, u.mobile, u.status AS user_status,
  r.id AS role_id, r.code AS role_code, r.name AS role_name
  FROM employee_profiles ep JOIN users u ON u.id = ep.user_id
  JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id`;

export const employeeRouter = Router();
employeeRouter.use(authenticate);

employeeRouter.get('/', requirePermission('EMPLOYEE_READ'), validate(listEmployeesSchema, 'query'), asyncHandler(async (request, response) => {
  const query = listEmployeesSchema.parse(request.query);
  const clauses = ['u.deleted_at IS NULL', "r.role_category = 'EMPLOYEE'"];
  const values: unknown[] = [];
  if (query.search) { clauses.push('(ep.employee_code LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)'); const term = `%${query.search}%`; values.push(term, term, term); }
  if (query.departmentCode) { clauses.push('ep.department_code = ?'); values.push(query.departmentCode); }
  if (query.roleId) { clauses.push('r.id = ?'); values.push(query.roleId); }
  if (query.status) { clauses.push('ep.employment_status = ?'); values.push(query.status); }
  const where = `WHERE ${clauses.join(' AND ')}`;
  const [counts] = await pool.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(DISTINCT ep.id) AS total ${employeeSelect.slice(employeeSelect.indexOf('FROM '))} ${where}`, values);
  const offset = (query.page - 1) * query.pageSize;
  const [rows] = await pool.query<EmployeeRow[]>(`${employeeSelect} ${where} ORDER BY ep.created_at DESC LIMIT ? OFFSET ?`, [...values, query.pageSize, offset]);
  const totalItems = Number(counts[0]?.total ?? 0);
  return sendSuccess(response, { items: rows.map(mapEmployee), pagination: { page: query.page, pageSize: query.pageSize, totalItems, totalPages: Math.ceil(totalItems / query.pageSize) } });
}));

employeeRouter.post('/', requirePermission('EMPLOYEE_CREATE'), validate(createEmployeeSchema), asyncHandler(async (request, response) => {
  const input = createEmployeeSchema.parse(request.body);
  const employeeId = randomUUID(); const userId = randomUUID();
  const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);
  await withTransaction(async (connection) => {
    const [roles] = await connection.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM roles WHERE id = ? AND role_category = 'EMPLOYEE' AND is_active = TRUE FOR UPDATE", [input.roleId],
    );
    if (!roles[0]) throw new ApiError(422, 'INVALID_EMPLOYEE_ROLE', 'The selected role is not an active employee role');
    const [departments] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM master_data WHERE category = 'EMPLOYEE_DEPARTMENT' AND code = ? AND is_active = TRUE", [input.departmentCode],
    );
    if (!departments[0]) throw new ApiError(422, 'INVALID_DEPARTMENT', 'The selected employee department is invalid or inactive');
    const [platforms] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM parties WHERE party_type = 'PLATFORM' LIMIT 1");
    if (!platforms[0]) throw new ApiError(409, 'PLATFORM_NOT_CONFIGURED', 'The platform party must be seeded before creating employees');
    await connection.execute(`INSERT INTO users (id, party_id, email, mobile, full_name, password_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`, [userId, platforms[0].id, input.email.toLowerCase(), input.mobile ?? null, input.fullName, passwordHash]);
    await connection.execute('INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)', [userId, input.roleId, request.auth!.userId]);
    await connection.execute(`INSERT INTO employee_profiles
      (id, user_id, employee_code, department_code, designation, manager_user_id, joining_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [employeeId, userId, input.employeeCode, input.departmentCode, input.designation ?? null, input.managerUserId ?? null, input.joiningDate ?? null, request.auth!.userId]);
    await connection.execute(`INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, outcome, after_data)
      VALUES (?, 'EMPLOYEE_CREATED', 'EMPLOYEE', ?, 'SUCCESS', ?)`, [request.auth!.userId, employeeId, JSON.stringify({ userId, employeeCode: input.employeeCode, roleId: input.roleId })]);
  });
  const [rows] = await pool.query<EmployeeRow[]>(`${employeeSelect} WHERE ep.id = ?`, [employeeId]);
  return sendSuccess(response, mapEmployee(rows[0]!), 201);
}));
