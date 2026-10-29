import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool } from '../../database/pool.js';
import type { UserAuthRecord } from './auth.types.js';

interface UserRow extends RowDataPacket {
  id: string;
  party_id: string | null;
  email: string;
  full_name: string;
  password_hash: string;
  status: string;
  failed_login_count: number;
  locked_until: Date | null;
  must_change_password: number | boolean;
  roles: string | null;
  permissions: string | null;
}

export async function findUserForAuthentication(identifier: string, forLogin = false): Promise<UserAuthRecord | null> {
  // Internal token/password flows resolve strictly by UUID. Public login uses
  // email, or an individual employee/network code (never the shared platform code).
  const lookup = forLogin ? `(
    LOWER(u.email) = LOWER(?) OR (
      NOT EXISTS (SELECT 1 FROM user_roles ar JOIN roles admin_role ON admin_role.id = ar.role_id
                  WHERE ar.user_id = u.id AND admin_role.code IN ('ADMIN', 'SUPER_ADMIN'))
      AND (u.mobile = ?
        OR EXISTS (SELECT 1 FROM employee_profiles ep WHERE ep.user_id = u.id AND ep.employee_code = ?)
        OR EXISTS (SELECT 1 FROM parties party WHERE party.id = u.party_id
                   AND party.party_type IN ('MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER') AND party.code = ?))
    )
  )` : 'u.id = ?';
  const [rows] = await pool.query<UserRow[]>(`
    SELECT u.id, u.party_id, u.email, u.full_name, u.password_hash, u.status, u.must_change_password,
           u.failed_login_count, u.locked_until,
           GROUP_CONCAT(DISTINCT r.code ORDER BY r.code) AS roles,
           GROUP_CONCAT(DISTINCT p.code ORDER BY p.code) AS permissions
    FROM users u
    LEFT JOIN user_roles ur ON ur.user_id = u.id
    LEFT JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
    LEFT JOIN role_permissions rp ON rp.role_id = r.id
    LEFT JOIN permissions p ON p.id = rp.permission_id
    WHERE u.deleted_at IS NULL AND ${lookup}
    GROUP BY u.id
    LIMIT 2
  `, forLogin ? [identifier.trim(), identifier.trim(), identifier.trim(), identifier.trim()] : [identifier]);
  // Fail closed if identifiers across different namespaces match two accounts.
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row) return null;
  return {
    userId: row.id,
    partyId: row.party_id,
    email: row.email,
    fullName: row.full_name,
    passwordHash: row.password_hash,
    status: row.status,
    failedLoginCount: row.failed_login_count,
    lockedUntil: row.locked_until,
    roles: row.roles ? row.roles.split(',') : [],
    permissions: row.permissions ? row.permissions.split(',') : [],
    mustChangePassword: Boolean(row.must_change_password),
  };
}

export async function recordFailedLogin(userId: string): Promise<void> {
  await pool.execute(`UPDATE users SET failed_login_count = failed_login_count + 1,
    locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 15 MINUTE) ELSE locked_until END
    WHERE id = ?`, [userId]);
}

export async function recordSuccessfulLogin(userId: string): Promise<void> {
  await pool.execute('UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = UTC_TIMESTAMP(6) WHERE id = ?', [userId]);
}

export async function insertRefreshToken(
  connection: PoolConnection,
  token: { id: string; userId: string; tokenHash: string; expiresAt: Date; ipAddress?: string | null | undefined; userAgent?: string | null | undefined },
): Promise<void> {
  await connection.execute(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [token.id, token.userId, token.tokenHash, token.expiresAt, token.ipAddress ?? null, token.userAgent ?? null],
  );
}

export async function rotateRefreshToken(
  connection: PoolConnection,
  oldHash: string,
  replacement: { id: string; userId: string; tokenHash: string; expiresAt: Date; ipAddress?: string | null | undefined; userAgent?: string | null | undefined },
): Promise<boolean> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id FROM refresh_tokens
     WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP(6)
     FOR UPDATE`,
    [oldHash],
  );
  if (!rows[0]) return false;
  await insertRefreshToken(connection, replacement);
  const [result] = await connection.execute<ResultSetHeader>(
    `UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP(6), replaced_by_token_id = ? WHERE id = ?`,
    [replacement.id, rows[0].id],
  );
  if (result.affectedRows !== 1) return false;
  return true;
}

export async function revokeRefreshToken(tokenHash: string): Promise<void> {
  await pool.execute('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE token_hash = ?', [tokenHash]);
}

export async function revokeAllRefreshTokens(connection: PoolConnection, userId: string): Promise<void> {
  await connection.execute(
    'UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP(6)) WHERE user_id = ?',
    [userId],
  );
}
