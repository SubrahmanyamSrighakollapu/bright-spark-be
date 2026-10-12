import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../../config/env.js';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { writeAuditLog } from '../../shared/audit.js';
import { sendSuccess } from '../../shared/response.js';
import { createEmployeeSchema, employeeIdSchema, listEmployeesSchema, resetEmployeePasswordSchema, updateEmployeeSchema, updateEmployeeStatusSchema } from './employee.schemas.js';
import { revokeAllRefreshTokens } from '../auth/auth.repository.js';

interface EmployeeRow extends RowDataPacket {
  id: string; user_id: string; employee_code: string; full_name: string; email: string; mobile: string | null;
  user_status: string; department_code: string; designation: string | null; manager_user_id: string | null;
  joining_date: string | null; shift_code: 'MORNING' | 'EVENING' | 'NIGHT'; employment_status: string; role_id: number; role_code: string; role_name: string;
  created_at: Date; updated_at: Date;
}

function mapEmployee(row: EmployeeRow) {
  return { id: row.id, userId: row.user_id, employeeCode: row.employee_code, fullName: row.full_name, email: row.email,
    mobile: row.mobile, accountStatus: row.user_status, departmentCode: row.department_code, designation: row.designation,
    managerUserId: row.manager_user_id, joiningDate: row.joining_date, shiftCode: row.shift_code, employmentStatus: row.employment_status,
    role: { id: row.role_id, code: row.role_code, name: row.role_name }, createdAt: row.created_at, updatedAt: row.updated_at };
}

const employeeSelect = `SELECT ep.*, u.full_name, u.email, u.mobile, u.status AS user_status,
  r.id AS role_id, r.code AS role_code, r.name AS role_name
  FROM employee_profiles ep JOIN users u ON u.id = ep.user_id
  JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id`;

export const employeeRouter = Router();
employeeRouter.use(authenticate);

employeeRouter.get('/meta', requirePermission('EMPLOYEE_READ'), asyncHandler(async (_request, response) => {
  const [departments] = await pool.query<RowDataPacket[]>(
    "SELECT code, label, description FROM master_data WHERE category = 'EMPLOYEE_DEPARTMENT' AND is_active = TRUE ORDER BY sort_order ASC"
  );
  const [roles] = await pool.query<RowDataPacket[]>(
    "SELECT id, code, name, description FROM roles WHERE role_category = 'EMPLOYEE' AND is_active = TRUE ORDER BY id ASC"
  );
  return sendSuccess(response, {
    departments: departments.map(d => ({ code: d.code as string, label: d.label as string, description: d.description as string | null })),
    roles: roles.map(r => ({ id: r.id as number, code: r.code as string, name: r.name as string, description: r.description as string | null })),
  });
}));

employeeRouter.get('/:id', requirePermission('EMPLOYEE_READ'), validate(employeeIdSchema, 'params'), asyncHandler(async (request, response) => {
  const [rows] = await pool.query<EmployeeRow[]>(`${employeeSelect} WHERE ep.id = ? AND u.deleted_at IS NULL AND r.role_category = 'EMPLOYEE'`, [request.params.id]);
  if (!rows[0]) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Employee profile not found');
  return sendSuccess(response, mapEmployee(rows[0]));
}));

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
  const rawPassword = `QinStarEmp@${input.mobile.slice(-4)}`;
  const passwordHash = await bcrypt.hash(rawPassword, env.BCRYPT_ROUNDS);
  let employeeCode = '';
  let roleId = 0;
  await withTransaction(async (connection) => {
    // Check duplicate email or mobile
    const [existingUsers] = await connection.query<RowDataPacket[]>(
      'SELECT id FROM users WHERE (email = ? OR (mobile IS NOT NULL AND mobile = ?)) AND deleted_at IS NULL LIMIT 1',
      [input.email.toLowerCase(), input.mobile ?? '']
    );
    if (existingUsers[0]) {
      throw new ApiError(409, 'USER_EXISTS', 'An account with this email address or mobile number already exists');
    }
    const [departments] = await connection.query<RowDataPacket[]>(
      "SELECT id FROM master_data WHERE category = 'EMPLOYEE_DEPARTMENT' AND code = ? AND is_active = TRUE", [input.departmentCode],
    );
    if (!departments[0]) throw new ApiError(422, 'INVALID_DEPARTMENT', 'The selected employee department is invalid or inactive');
    const [roles] = await connection.query<(RowDataPacket & { id: number })[]>(
      "SELECT id FROM roles WHERE code = ? AND role_category = 'EMPLOYEE' AND is_active = TRUE LIMIT 1 FOR UPDATE", [input.departmentCode],
    );
    if (!roles[0]) throw new ApiError(422, 'DEPARTMENT_ROLE_NOT_CONFIGURED', 'The selected department does not have an active employee role');
    roleId = roles[0].id;
    const prefixes: Record<string, string> = { OPERATIONS: 'OPS', ACCOUNTS: 'ACC', KYC: 'KYC', SALES: 'SAL' };
    const prefix = `EMP_${prefixes[input.departmentCode] ?? input.departmentCode.slice(0, 3)}_`;
    const [lastCodes] = await connection.query<(RowDataPacket & { employee_code: string })[]>(
      'SELECT employee_code FROM employee_profiles WHERE employee_code LIKE ? ORDER BY employee_code DESC LIMIT 1 FOR UPDATE', [`${prefix}%`],
    );
    const lastNumber = Number.parseInt(lastCodes[0]?.employee_code.slice(prefix.length) ?? '0', 10) || 0;
    employeeCode = `${prefix}${String(lastNumber + 1).padStart(3, '0')}`;
    const [platforms] = await connection.query<(RowDataPacket & { id: string })[]>("SELECT id FROM parties WHERE party_type = 'PLATFORM' LIMIT 1");
    if (!platforms[0]) throw new ApiError(409, 'PLATFORM_NOT_CONFIGURED', 'The platform party must be seeded before creating employees');
    await connection.execute(`INSERT INTO users (id, party_id, email, mobile, full_name, password_hash, status, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', TRUE)`, [userId, platforms[0].id, input.email.toLowerCase(), input.mobile, input.fullName, passwordHash]);
    await connection.execute('INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)', [userId, roleId, request.auth!.userId]);
    await connection.execute(`INSERT INTO employee_profiles
      (id, user_id, employee_code, department_code, designation, manager_user_id, joining_date, shift_code, created_by)
      VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`, [employeeId, userId, employeeCode, input.departmentCode, input.managerUserId ?? null, input.joiningDate, input.shiftCode, request.auth!.userId]);
    await writeAuditLog(
      { action: 'EMPLOYEE_CREATED', resourceType: 'EMPLOYEE', resourceId: employeeId, outcome: 'SUCCESS', afterData: { employeeCode, roleId, departmentCode: input.departmentCode } },
      { actorUserId: request.auth!.userId, actorPartyId: request.auth!.partyId, requestId: request.requestId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
      connection
    );
  });
  const [rows] = await pool.query<EmployeeRow[]>(`${employeeSelect} WHERE ep.id = ?`, [employeeId]);
  return sendSuccess(response, mapEmployee(rows[0]!), 201);
}));

employeeRouter.put('/:id', requirePermission('EMPLOYEE_UPDATE'), validate(employeeIdSchema, 'params'), validate(updateEmployeeSchema), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const input = updateEmployeeSchema.parse(request.body);
  await withTransaction(async (connection) => {
    const [employees] = await connection.query<(RowDataPacket & { user_id: string })[]>('SELECT user_id FROM employee_profiles WHERE id = ? FOR UPDATE', [id]);
    if (!employees[0]) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Employee profile not found');
    const [roles] = await connection.query<RowDataPacket[]>("SELECT id FROM roles WHERE id = ? AND role_category = 'EMPLOYEE' AND is_active = TRUE", [input.roleId]);
    if (!roles[0]) throw new ApiError(422, 'INVALID_EMPLOYEE_ROLE', 'The selected role is not an active employee role');
    const [departments] = await connection.query<RowDataPacket[]>("SELECT id FROM master_data WHERE category = 'EMPLOYEE_DEPARTMENT' AND code = ? AND is_active = TRUE", [input.departmentCode]);
    if (!departments[0]) throw new ApiError(422, 'INVALID_DEPARTMENT', 'The selected employee department is invalid or inactive');
    const userId = employees[0].user_id;
    await connection.execute('UPDATE users SET full_name = ?, email = ?, mobile = ?, version = version + 1 WHERE id = ?', [input.fullName, input.email.toLowerCase(), input.mobile ?? null, userId]);
    await connection.execute(`UPDATE employee_profiles SET department_code = ?, designation = ?, manager_user_id = ?, joining_date = ?, shift_code = ? WHERE id = ?`,
      [input.departmentCode, input.designation ?? null, input.managerUserId ?? null, input.joiningDate ?? null, input.shiftCode, id]);
    await connection.execute('DELETE ur FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ? AND r.role_category = ?', [userId, 'EMPLOYEE']);
    await connection.execute('INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)', [userId, input.roleId, request.auth!.userId]);
    await writeAuditLog(
      { action: 'EMPLOYEE_UPDATED', resourceType: 'EMPLOYEE', resourceId: id, outcome: 'SUCCESS', afterData: { roleId: input.roleId, departmentCode: input.departmentCode }, metadata: { reason: input.reason } },
      { actorUserId: request.auth!.userId, actorPartyId: request.auth!.partyId, requestId: request.requestId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
      connection
    );
  });
  const [rows] = await pool.query<EmployeeRow[]>(`${employeeSelect} WHERE ep.id = ?`, [id]);
  return sendSuccess(response, mapEmployee(rows[0]!));
}));

employeeRouter.patch('/:id/status', requirePermission('EMPLOYEE_UPDATE'), validate(employeeIdSchema, 'params'), validate(updateEmployeeStatusSchema), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const { status, reason } = updateEmployeeStatusSchema.parse(request.body);

  await withTransaction(async (connection) => {
    const [employees] = await connection.query<(RowDataPacket & { user_id: string; employment_status: string })[]>(
      'SELECT user_id, employment_status FROM employee_profiles WHERE id = ? FOR UPDATE', [id],
    );
    if (!employees[0]) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Employee profile not found');
    if (employees[0].employment_status === 'TERMINATED' && status !== 'TERMINATED') {
      throw new ApiError(409, 'TERMINATED_EMPLOYEE_IMMUTABLE', 'A terminated employee cannot be reactivated');
    }
    const userId = employees[0].user_id;
    await connection.execute('UPDATE employee_profiles SET employment_status = ?, updated_at = NOW() WHERE id = ?', [status, id]);
    const userStatus = status === 'ACTIVE' ? 'ACTIVE' : status === 'SUSPENDED' ? 'SUSPENDED' : 'DISABLED';
    await connection.execute('UPDATE users SET status = ?, updated_at = NOW() WHERE id = ?', [userId, userStatus]);
    await writeAuditLog(
      { action: 'EMPLOYEE_STATUS_UPDATED', resourceType: 'EMPLOYEE', resourceId: id, outcome: 'SUCCESS', afterData: { status }, metadata: { reason } },
      { actorUserId: request.auth!.userId, actorPartyId: request.auth!.partyId, requestId: request.requestId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
      connection
    );
  });


  const [rows] = await pool.query<EmployeeRow[]>(`${employeeSelect} WHERE ep.id = ?`, [id]);
  return sendSuccess(response, mapEmployee(rows[0]!));
}));

employeeRouter.post('/:id/reset-password', requirePermission('EMPLOYEE_UPDATE'), validate(employeeIdSchema, 'params'), validate(resetEmployeePasswordSchema), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const input = resetEmployeePasswordSchema.parse(request.body);
  const temporaryPassword = input.password ?? `Qsp@${randomBytes(8).toString('base64url')}9`;
  const passwordHash = await bcrypt.hash(temporaryPassword, env.BCRYPT_ROUNDS);
  await withTransaction(async (connection) => {
    const [employees] = await connection.query<(RowDataPacket & { user_id: string })[]>(
      'SELECT user_id FROM employee_profiles WHERE id = ? FOR UPDATE', [id],
    );
    if (!employees[0]) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Employee profile not found');
    await connection.execute(`UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6),
      must_change_password = TRUE, failed_login_count = 0, locked_until = NULL, version = version + 1 WHERE id = ?`,
      [passwordHash, employees[0].user_id]);
    await revokeAllRefreshTokens(connection, employees[0].user_id);
    await writeAuditLog(
      { action: 'EMPLOYEE_PASSWORD_RESET', resourceType: 'EMPLOYEE', resourceId: id, outcome: 'SUCCESS', metadata: { reason: input.reason } },
      { actorUserId: request.auth!.userId, actorPartyId: request.auth!.partyId, requestId: request.requestId, ipAddress: request.ip, userAgent: request.headers['user-agent'] },
      connection
    );
  });
  return sendSuccess(response, { temporaryPassword });
}));

