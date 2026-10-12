import type { Response } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { listSchema, exportSchema, byIdSchema } from './login-history.schemas.js';
import type { z } from 'zod';

type ListFilters = z.infer<typeof listSchema>;
type ExportFilters = z.infer<typeof exportSchema>;
type ByIdParams = z.infer<typeof byIdSchema>;

export interface LoginHistoryRow extends RowDataPacket {
  id: number;
  user_id: string | null;
  session_id: string | null;
  result: 'SUCCESS' | 'FAILED' | 'LOCKED' | 'LOGGED_OUT' | 'REFRESH';
  ip_address: string | null;
  user_agent: string | null;
  device_fingerprint: string | null;
  fail_reason: string | null;
  login_method: string;
  refresh_jti: string | null;
  metadata: unknown;
  latitude: number | null;
  longitude: number | null;
  location_accuracy: number | null;
  location_status: string;
  location_captured_at: Date | null;
  user_full_name: string | null;
  user_email: string | null;
  user_mobile: string | null;
  party_type: string | null;
  party_display_name: string | null;
  roles: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LoginHistory {
  id: number;
  userId: string | null;
  sessionId: string | null;
  result: 'SUCCESS' | 'FAILED' | 'LOCKED' | 'LOGGED_OUT' | 'REFRESH';
  ipAddress: string | null;
  userAgent: string | null;
  deviceFingerprint: string | null;
  failReason: string | null;
  loginMethod: string;
  refreshJti: string | null;
  metadata: unknown;
  latitude: number | null;
  longitude: number | null;
  locationAccuracy: number | null;
  locationStatus: string;
  locationCapturedAt: string | null;
  userFullName: string | null;
  userEmail: string | null;
  userMobile: string | null;
  partyType: string | null;
  partyDisplayName: string | null;
  roles: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LoginHistorySummary {
  todaySuccessCount: number;
  todayFailedCount: number;
  newDevicesLast7Days: number;
}

export interface PaginatedLoginHistoryResult {
  items: LoginHistory[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const ADMIN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'ACCOUNTS'];

const canCrossUserScope = (auth: AuthenticatedUser): boolean => {
  const hasAdminRole = auth.roles.some((r) => ADMIN_ROLES.includes(r));
  const hasPermission = auth.permissions.includes('LOGIN_HISTORY_READ');
  return hasAdminRole && hasPermission;
};

const formatDateIso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const mapRowToLoginHistory = (row: LoginHistoryRow): LoginHistory => ({
  id: row.id,
  userId: row.user_id,
  sessionId: row.session_id,
  result: row.result,
  ipAddress: row.ip_address,
  userAgent: row.user_agent,
  deviceFingerprint: row.device_fingerprint,
  failReason: row.fail_reason,
  loginMethod: row.login_method,
  refreshJti: row.refresh_jti,
  metadata: row.metadata,
  latitude: row.latitude ?? null,
  longitude: row.longitude ?? null,
  locationAccuracy: row.location_accuracy ?? null,
  locationStatus: row.location_status ?? 'UNAVAILABLE',
  locationCapturedAt: formatDateIso(row.location_captured_at),
  userFullName: row.user_full_name ?? null,
  userEmail: row.user_email ?? null,
  userMobile: row.user_mobile ?? null,
  partyType: row.party_type ?? null,
  partyDisplayName: row.party_display_name ?? null,
  roles: row.roles ?? null,
  createdAt: formatDateIso(row.created_at) ?? new Date().toISOString(),
  updatedAt: formatDateIso(row.updated_at) ?? new Date().toISOString(),
});

const buildWhereClauses = (filters: ListFilters | ExportFilters, auth: AuthenticatedUser): { whereSql: string; params: unknown[] } => {
  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (canCrossUserScope(auth)) {
    if (filters.userId && filters.userId.length > 0) {
      const placeholders = filters.userId.map(() => '?').join(',');
      whereClauses.push(`lh.user_id IN (${placeholders})`);
      params.push(...filters.userId);
    }
  } else {
    whereClauses.push('lh.user_id = ?');
    params.push(auth.userId);
  }

  if (filters.result && filters.result.length > 0) {
    const placeholders = filters.result.map(() => '?').join(',');
    whereClauses.push(`lh.result IN (${placeholders})`);
    params.push(...filters.result);
  }

  if (filters.startDate) {
    whereClauses.push('lh.created_at >= ?');
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClauses.push('lh.created_at <= ?');
    params.push(filters.endDate);
  }

  if (filters.ip) {
    whereClauses.push('lh.ip_address = ?');
    params.push(filters.ip);
  }

  if (filters.keyword && filters.keyword.trim().length > 0) {
    whereClauses.push('(lh.user_agent LIKE ? OR u.full_name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ?)');
    params.push(`%${filters.keyword.trim()}%`, `%${filters.keyword.trim()}%`, `%${filters.keyword.trim()}%`, `%${filters.keyword.trim()}%`);
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';
  return { whereSql, params };
};

const LOGIN_HISTORY_FROM_JOINS = `
  FROM login_history lh
  LEFT JOIN users u ON u.id = lh.user_id
  LEFT JOIN parties p ON p.id = u.party_id
`;

const ENRICHED_LOGIN_HISTORY_SELECT = `
  SELECT lh.*,
         u.full_name    AS user_full_name,
         u.email        AS user_email,
         u.mobile       AS user_mobile,
         p.party_type   AS party_type,
         p.display_name AS party_display_name,
         roles.roles    AS roles
  ${LOGIN_HISTORY_FROM_JOINS}
  LEFT JOIN (
    SELECT ur.user_id,
           GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS roles
    FROM user_roles ur
    INNER JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
    GROUP BY ur.user_id
  ) roles ON roles.user_id = lh.user_id
`;

export const list = async (
  filters: ListFilters,
  auth: AuthenticatedUser,
): Promise<PaginatedLoginHistoryResult> => {
  const { whereSql, params } = buildWhereClauses(filters, auth);

  const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
    `SELECT COUNT(*) as c ${LOGIN_HISTORY_FROM_JOINS} ${whereSql}`,
    params,
  );
  const totalItems = Number(countRows[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize));
  const page = Math.max(1, Math.min(filters.page, totalPages));
  const offset = (page - 1) * filters.pageSize;

  const [rows] = await pool.query<LoginHistoryRow[]>(
    `${ENRICHED_LOGIN_HISTORY_SELECT} ${whereSql} ORDER BY lh.created_at DESC, lh.id DESC LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, offset],
  );
  const items = rows.map(mapRowToLoginHistory);

  return {
    items,
    pagination: {
      page,
      pageSize: filters.pageSize,
      totalItems,
      totalPages,
    },
  };
};

export const summary = async (
  filters: ListFilters,
  auth: AuthenticatedUser,
): Promise<LoginHistorySummary> => {
  const scopedToUser = !canCrossUserScope(auth);

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (scopedToUser) {
    whereParts.push('user_id = ?');
    params.push(auth.userId);
  } else if (filters.userId && filters.userId.length > 0) {
    const placeholders = filters.userId.map(() => '?').join(',');
    whereParts.push(`user_id IN (${placeholders})`);
    params.push(...filters.userId);
  }

  const baseParamsWhere = whereParts.length > 0 ? ` WHERE ${whereParts.join(' AND ')}` : '';

  const [aggRows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN DATE(created_at) = ? AND result = 'SUCCESS' THEN 1 ELSE 0 END) AS todaySuccessCount,
       SUM(CASE WHEN DATE(created_at) = ? AND result = 'FAILED' THEN 1 ELSE 0 END) AS todayFailedCount
     FROM login_history
     ${baseParamsWhere}`,
    [todayStr, todayStr, ...params],
  );

  const deviceParams = scopedToUser ? [auth.userId] : (filters.userId ?? []);
  let devicesWhere = 'created_at > NOW() - INTERVAL 7 DAY';
  if (scopedToUser) {
    devicesWhere += ' AND user_id = ?';
  } else if (filters.userId && filters.userId.length > 0) {
    const placeholders = filters.userId.map(() => '?').join(',');
    devicesWhere += ` AND user_id IN (${placeholders})`;
  }

  const [deviceRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
    `SELECT COUNT(DISTINCT device_fingerprint) as c
     FROM login_history
     WHERE ${devicesWhere}
       AND device_fingerprint IS NOT NULL
       AND device_fingerprint <> ''`,
    deviceParams,
  );

  const agg = (aggRows[0] as Record<string, unknown>) ?? {};
  return {
    todaySuccessCount: Number(agg.todaySuccessCount ?? 0),
    todayFailedCount: Number(agg.todayFailedCount ?? 0),
    newDevicesLast7Days: Number(deviceRows[0]?.c ?? 0),
  };
};

export const getById = async (
  id: ByIdParams['id'],
  auth: AuthenticatedUser,
): Promise<LoginHistory> => {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) {
    throw new ApiError(404, 'NOT_FOUND', 'Login history entry not found');
  }

  let sql = `${ENRICHED_LOGIN_HISTORY_SELECT} WHERE lh.id = ?`;
  const params: unknown[] = [numericId];

  if (!canCrossUserScope(auth)) {
    sql += ' AND lh.user_id = ?';
    params.push(auth.userId);
  }

  sql += ' LIMIT 1';

  const [rows] = await pool.query<LoginHistoryRow[]>(sql, params);
  if (!rows.length) {
    throw new ApiError(404, 'NOT_FOUND', 'Login history entry not found or not accessible');
  }
  return mapRowToLoginHistory(rows[0]!);
};

export interface UpdateLocationInput {
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  locationAccuracy?: number | null | undefined;
  locationStatus: 'GRANTED' | 'DENIED' | 'TIMEOUT' | 'UNSUPPORTED' | 'ERROR' | 'PENDING' | 'UNAVAILABLE';
  locationCapturedAt?: string | null | undefined;
}

export const updateLocationBySessionId = async (
  sessionId: string,
  input: UpdateLocationInput,
  auth: AuthenticatedUser,
): Promise<LoginHistory> => {
  const trimmedSessionId = sessionId.trim();
  if (!trimmedSessionId) {
    throw new ApiError(400, 'INVALID_SESSION_ID', 'Session ID is required');
  }

  const fields: string[] = ['location_status = ?', 'updated_at = CURRENT_TIMESTAMP(6)'];
  const params: unknown[] = [input.locationStatus];

  if (input.latitude !== undefined && input.latitude !== null) {
    fields.push('latitude = ?');
    params.push(input.latitude);
  }
  if (input.longitude !== undefined && input.longitude !== null) {
    fields.push('longitude = ?');
    params.push(input.longitude);
  }
  if (input.locationAccuracy !== undefined && input.locationAccuracy !== null) {
    fields.push('location_accuracy = ?');
    params.push(input.locationAccuracy);
  }
  if (input.locationCapturedAt) {
    fields.push('location_captured_at = ?');
    params.push(input.locationCapturedAt);
  }

  params.push(trimmedSessionId);

  if (!canCrossUserScope(auth)) {
    params.push(auth.userId);
  }

  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE login_history SET ${fields.join(', ')} WHERE session_id = ?${!canCrossUserScope(auth) ? ' AND user_id = ?' : ''} LIMIT 1`,
    params,
  );

  if (!result.affectedRows) {
    throw new ApiError(404, 'NOT_FOUND', 'Login history entry not found or not accessible');
  }

  const selectSql = `${ENRICHED_LOGIN_HISTORY_SELECT} WHERE lh.session_id = ?${!canCrossUserScope(auth) ? ' AND lh.user_id = ?' : ''} ORDER BY lh.id DESC LIMIT 1`;
  const selectParams = !canCrossUserScope(auth) ? [trimmedSessionId, auth.userId] : [trimmedSessionId];
  const [rows] = await pool.query<LoginHistoryRow[]>(selectSql, selectParams);
  if (!rows.length) {
    throw new ApiError(404, 'NOT_FOUND', 'Login history entry not found or not accessible');
  }
  return mapRowToLoginHistory(rows[0]!);
};

export const exportCsv = async (
  filters: ExportFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> => {
  const { whereSql, params } = buildWhereClauses(filters, auth);

  const [rows] = await pool.query<LoginHistoryRow[]>(
    `SELECT lh.id, lh.created_at, lh.result, lh.user_id, lh.session_id, lh.ip_address, lh.user_agent,
            lh.device_fingerprint, lh.fail_reason, lh.login_method, lh.refresh_jti, lh.metadata,
            lh.latitude, lh.longitude, lh.location_accuracy, lh.location_status, lh.location_captured_at,
            u.full_name AS user_full_name, u.email AS user_email, p.party_type AS party_type, roles.roles AS roles
     ${LOGIN_HISTORY_FROM_JOINS}
     LEFT JOIN (
       SELECT ur.user_id,
              GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS roles
       FROM user_roles ur
       INNER JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
       GROUP BY ur.user_id
     ) roles ON roles.user_id = lh.user_id
     ${whereSql}
     ORDER BY lh.created_at DESC, lh.id DESC
     LIMIT 250000`,
    params,
  );

  const headers = [
    'id', 'created_at', 'result', 'user_id', 'user_full_name', 'user_email', 'party_type', 'roles',
    'session_id', 'ip_address', 'user_agent', 'device_fingerprint', 'fail_reason', 'login_method',
    'refresh_jti', 'latitude', 'longitude', 'location_accuracy', 'location_status', 'location_captured_at',
    'metadata',
  ];

  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'object') {
      try {
        s = JSON.stringify(v);
      } catch {
        s = String(v);
      }
    } else {
      s = String(v);
    }
    s = s.replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };

  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const filename = `login_history_${dateStamp}.csv`;

  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  response.write('\uFEFF');
  response.write(headers.join(','));
  response.write('\r\n');

  for (const row of rows) {
    const line = [
      row.id,
      formatDateIso(row.created_at) ?? '',
      row.result,
      row.user_id ?? '',
      row.user_full_name ?? '',
      row.user_email ?? '',
      row.party_type ?? '',
      row.roles ?? '',
      row.session_id ?? '',
      row.ip_address ?? '',
      row.user_agent ?? '',
      row.device_fingerprint ?? '',
      row.fail_reason ?? '',
      row.login_method,
      row.refresh_jti ?? '',
      row.latitude ?? '',
      row.longitude ?? '',
      row.location_accuracy ?? '',
      row.location_status ?? '',
      formatDateIso(row.location_captured_at) ?? '',
      row.metadata,
    ].map(escape).join(',');
    response.write(line);
    response.write('\r\n');
  }

  response.end();
};
