import type { Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type {
  listAuditLogsSchema,
  auditLogIdSchema,
  exportAuditLogsSchema,
} from './audit-log.schemas.js';
import type { z } from 'zod';

type ListFilters = z.infer<typeof listAuditLogsSchema>;
type ExportFilters = z.infer<typeof exportAuditLogsSchema>;
type AuditLogIdInput = z.infer<typeof auditLogIdSchema>;

const WALLET_CRITICAL_ACTIONS = [
  'WALLET_CREDIT',
  'WALLET_DEBIT',
  'WALLET_HOLD_APPLIED',
  'WALLET_HOLD_RELEASED',
  'WALLET_BALANCE_CORRECTION',
] as const;

type LogSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AuditLogRow extends RowDataPacket {
  id: number;
  request_id: string | null;
  actor_user_id: string | null;
  actor_party_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: 'SUCCESS' | 'FAILURE';
  ip_address: string | null;
  user_agent: string | null;
  before_data: unknown;
  after_data: unknown;
  metadata: unknown;
  created_at: Date;
  actor_full_name: string | null;
  actor_email: string | null;
  actor_role: string | null;
  actor_party_role: string | null;
  actor_party_display_name: string | null;
  target_name: string | null;
  target_subtitle: string | null;
  target_badge: string | null;
  login_latitude: number | null;
  login_longitude: number | null;
  login_location_accuracy: number | null;
  login_location_status: string | null;
  login_location_captured_at: Date | null;
}

export interface AuditLog {
  id: string;
  requestId: string | null;
  actorUserId: string | null;
  actorPartyId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  outcome: 'SUCCESS' | 'FAILURE';
  ipAddress: string | null;
  userAgent: string | null;
  beforeData: unknown;
  afterData: unknown;
  metadata: unknown;
  createdAt: string;
  traceId: string;
  correlationId: string;
  sourceModule: string;
  severity: LogSeverity;
  status: string;
  entityType?: string | undefined;
  entityId?: string | undefined;
  module: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  description: string;
  previousValue?: unknown | undefined;
  newValue?: unknown | undefined;
  reason?: string | undefined;
  targetName: string;
  targetSummary: string;
  targetBadge: string;
  whatHappened: string;
  impact: string;
  latitude?: number | null;
  longitude?: number | null;
  locationAccuracy?: number | null;
  locationStatus?: string | null;
  locationCapturedAt?: string | null;
}

export interface AuditLogSummary {
  todayActionsCount: number;
  failedActionsCount: number;
  criticalWalletEvents: number;
  topActorUsers: Array<{
    actorUserId: string;
    actionCount: number;
  }>;
}

export interface ActionCatalogItem {
  action: string;
  resourceType: string;
}

export interface PaginatedAuditLogResult {
  items: AuditLog[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

const formatDateIso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const safeJsonParse = (v: unknown): unknown => {
  if (typeof v !== 'string') return v;
  if (v.length === 0) return null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
};

const moduleFromResourceType = (resourceType: string | null | undefined): string => {
  const rt = (resourceType ?? '').toUpperCase();
  if (rt === 'WALLET') return 'WALLET';
  if (['USER', 'EMPLOYEE', 'HIERARCHY_TRANSFER'].includes(rt)) return 'USERS';
  if (['PARTY', 'DOCUMENT', 'KYC'].includes(rt)) return 'KYC';
  if (['ROLE', 'PERMISSION'].includes(rt)) return 'ADMIN';
  if (['SETTLEMENT', 'LEDGER', 'TRANSACTION', 'CHARGEBACK'].includes(rt)) return 'FINANCE';
  if (rt === 'NOTIFICATION') return 'COMM';
  if (rt.startsWith('LOGIN') || rt === 'AUTH') return 'SECURITY';
  return 'SYSTEM';
};

const humanDescription = (
  action: string,
  resourceType: string | null,
  resourceId: string | null,
  metadata: unknown,
  beforeData: unknown,
  afterData: unknown,
): string => {
  const meta = (metadata && typeof metadata === 'object' ? metadata : {}) as Record<string, unknown>;
  const before = (beforeData && typeof beforeData === 'object' ? beforeData : {}) as Record<string, unknown>;
  const after = (afterData && typeof afterData === 'object' ? afterData : {}) as Record<string, unknown>;

  switch (action) {
    case 'USER_CREATED': {
      const name = after.full_name || after.fullName || '';
      const email = after.email || '';
      const role = after.role || '';
      const parts = [
        'Created user account',
        name ? `${name}` : '',
        email ? `<${email}>` : '',
        role ? `[${role}]` : '',
      ].filter(Boolean);
      return parts.join(' ').trim() || `Created user account${resourceId ? ' #' + resourceId : ''}`;
    }
    case 'USER_STATUS_UPDATED': {
      const beforeStatus = String(before.status ?? '');
      const afterStatus = String(after.status ?? '');
      const reason = meta.reason ? ` (${meta.reason})` : '';
      return `Updated user status: ${beforeStatus} → ${afterStatus}${reason}`.trim();
    }
    case 'WALLET_CREDIT':
    case 'WALLET_DEBIT': {
      const amount = meta.amount != null ? String(meta.amount) : '';
      const type = meta.type ? ` via ${meta.type}` : '';
      const dir = action === 'WALLET_CREDIT' ? 'CREDIT' : 'DEBIT';
      return `Wallet ${dir}${amount ? ` of ₹${amount}` : ''}${resourceId ? ` to wallet ${resourceId}` : ''}${type}`.trim();
    }
    case 'KYC_APPROVED':
    case 'KYC_REJECTED': {
      const decision = action === 'KYC_APPROVED' ? 'APPROVED' : 'REJECTED';
      const reviewer = meta.reviewerUserId ? ` reviewer=${meta.reviewerUserId}` : '';
      const remarks = meta.remarks ? ` (${meta.remarks})` : '';
      return `KYC review for party ${resourceId ?? ''}: decision ${decision}${reviewer}${remarks}`.trim();
    }
    case 'LOGIN_SUCCESS':
    case 'LOGIN_FAILURE':
    case 'LOGOUT_SUCCESS': {
      const parts = action.split('_');
      const verb = parts[1] ? parts[1].toLowerCase() : action.toLowerCase();
      return `Login session: ${verb}`;
    }
    case 'ROLE_CREATED':
    case 'ROLE_UPDATED': {
      const afterCode = after.code ? String(after.code) : '';
      const beforeCode = before.code ? ` (${before.code})` : '';
      return `Role ${action === 'ROLE_CREATED' ? 'created' : 'updated'}: ${afterCode}${beforeCode}`.trim();
    }
    default: {
      const base = `${action} on ${resourceType ?? 'SYSTEM'}`;
      const suffix = resourceId ? ` #${resourceId}` : '';
      return base + suffix;
    }
  }
};

const computeSeverity = (
  outcome: 'SUCCESS' | 'FAILURE',
  resourceType: string | null,
  action: string,
): LogSeverity => {
  if (outcome !== 'FAILURE') return 'INFO';
  const rt = (resourceType ?? '').toUpperCase();
  const isCriticalResource = rt === 'WALLET' || rt === 'KYC';
  const isCriticalAction = WALLET_CRITICAL_ACTIONS.includes(action as (typeof WALLET_CRITICAL_ACTIONS)[number]);
  if (isCriticalResource || isCriticalAction) return 'HIGH' as LogSeverity;
  return 'MEDIUM' as LogSeverity;
};

const mapRowToAuditLog = (row: AuditLogRow): AuditLog => {
  const sourceModule = moduleFromResourceType(row.resource_type);
  const idStr = String(row.id);
  const beforeData = safeJsonParse(row.before_data);
  const afterData = safeJsonParse(row.after_data);
  const metadata = safeJsonParse(row.metadata);
  const actorId = row.actor_user_id ?? '';
  let actorName: string;
  if (row.actor_full_name) {
    actorName = row.actor_full_name;
  } else if (row.actor_party_display_name) {
    actorName = row.actor_party_display_name;
  } else if (row.actor_user_id) {
    actorName = `User ${row.actor_user_id.slice(-6)}`;
  } else {
    actorName = 'System';
  }
  const roleFromJoin = (row.actor_role && row.actor_role.length > 0)
    ? (row.actor_role.includes(',') ? row.actor_role.split(',')[0]! : row.actor_role)
    : null;
  const actorRole = (roleFromJoin || row.actor_party_role || 'SYSTEM') as string;
  const createdAt = formatDateIso(row.created_at) ?? new Date().toISOString();
  const description = humanDescription(
    row.action,
    row.resource_type,
    row.resource_id,
    metadata,
    beforeData,
    afterData,
  );

  const targetBadge = row.target_badge?.trim() || row.resource_type || 'System';
  let targetName = row.target_name?.trim();
  if (!targetName || targetName.length === 0) {
    if (row.resource_id && row.resource_id.length <= 12) targetName = `${targetBadge} #${row.resource_id}`;
    else if (row.resource_id) targetName = `${targetBadge} #${String(row.resource_id).slice(-8)}`;
    else targetName = `System ${targetBadge} Event`;
  }
  let targetSummary = row.target_subtitle?.trim() || '';
  if (!targetSummary && row.resource_id && row.resource_id.length > 12) {
    targetSummary = `ID: …${String(row.resource_id).slice(-10)}`;
  }
  const whatHappened = description || `${row.action.replace(/_/g, ' ')} on ${targetBadge}`;
  const impactText = (() => {
    if (row.outcome === 'FAILURE') return 'Action did not complete — review error details below.';
    if (/USER_STATUS|PASSWORD|KYC_APPROVED|KYC_REJECTED|WALLET_CORRECTION|BALANCE|ROLE_PERMISSION|AUTHORITY_TRANSFER|HIERARCHY_TRANSFER/.test(row.action)) {
      return 'Operational / financial state change — verify downstream impact if needed.';
    }
    if (/LOGIN|REFRESH|LOGOUT|PASSWORD_CHANGED|SESSION/.test(row.action)) return 'Session / security event.';
    if (/CREATE|UPDATE|UPLOAD|SUBMITTED|CREATED|UPDATED/.test(row.action)) return 'Record update event.';
    if (/DELETED|REMOVED/.test(row.action)) return 'Record removal event.';
    return 'Recorded audit event.';
  })();

  return {
    id: idStr,
    requestId: row.request_id,
    actorUserId: row.actor_user_id,
    actorPartyId: row.actor_party_id,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    outcome: row.outcome,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    beforeData,
    afterData,
    metadata,
    createdAt,
    traceId: row.request_id ?? `TRACE_AUD_${idStr}`,
    correlationId: row.request_id ?? `CORR_AUD_${idStr}`,
    sourceModule,
    severity: computeSeverity(row.outcome, row.resource_type, row.action),
    status: row.outcome as string,
    entityType: row.resource_type as string | undefined,
    entityId: row.resource_id ?? undefined,
    module: sourceModule,
    actorId,
    actorName,
    actorRole,
    description,
    previousValue: beforeData ?? undefined,
    newValue: afterData ?? undefined,
    reason: (metaReason(metadata) ?? undefined),
    targetName,
    targetSummary,
    targetBadge,
    whatHappened,
    impact: impactText,
    latitude: row.login_latitude == null ? null : Number(row.login_latitude),
    longitude: row.login_longitude == null ? null : Number(row.login_longitude),
    locationAccuracy: row.login_location_accuracy == null ? null : Number(row.login_location_accuracy),
    locationStatus: row.login_location_status ?? null,
    locationCapturedAt: formatDateIso(row.login_location_captured_at),
  };
};

const metaReason = (metadata: unknown): string | undefined => {
  if (!metadata || typeof metadata !== 'object') return undefined;
  const m = metadata as Record<string, unknown>;
  if (typeof m.reason === 'string' && m.reason.length > 0) return m.reason;
  if (typeof m.remarks === 'string' && m.remarks.length > 0) return m.remarks;
  return undefined;
};

const isAdminScope = (auth: AuthenticatedUser): boolean => {
  return auth.roles.includes('ADMIN') || auth.roles.includes('SUPER_ADMIN');
};

const ENRICHED_AUDIT_JOIN_SELECT = `
SELECT a.*,
       u.full_name   AS actor_full_name,
       u.email       AS actor_email,
       actor_roles.roles         AS actor_role,
       user_party.party_type     AS actor_party_role,
       user_party.display_name   AS actor_party_display_name,
       CASE
         WHEN a.resource_type = 'USER' THEN t_user.full_name
         WHEN a.resource_type = 'PARTY' THEN t_party.display_name
         WHEN a.resource_type IN ('SESSION','AUTH') THEN COALESCE(t_user2.full_name, t_user.full_name)
         WHEN a.resource_type = 'WALLET' THEN COALESCE(CONCAT(w_party.display_name, ' ', w.currency, ' Wallet'), CONCAT('Wallet ', a.resource_id))
         ELSE NULL
       END AS target_name,
       CASE
         WHEN a.resource_type = 'USER' THEN COALESCE(t_user.email, '')
         WHEN a.resource_type = 'PARTY' THEN COALESCE(t_party.party_type, '')
         WHEN a.resource_type IN ('SESSION','AUTH') THEN COALESCE(t_user2.email, t_user.email, '')
         WHEN a.resource_type = 'WALLET' THEN COALESCE(w_party.party_type, '')
         ELSE ''
       END AS target_subtitle,
       CASE
         WHEN a.resource_type = 'USER' THEN 'User'
         WHEN a.resource_type = 'PARTY' THEN 'Party'
         WHEN a.resource_type = 'SESSION' THEN 'Session'
         WHEN a.resource_type = 'AUTH' THEN 'Auth'
         WHEN a.resource_type = 'WALLET' THEN 'Wallet'
         WHEN a.resource_type = 'ROLE' THEN 'Role'
         WHEN a.resource_type = 'PERMISSION' THEN 'Permission'
         WHEN a.resource_type = 'KYC' THEN 'KYC'
         WHEN a.resource_type = 'DOCUMENT' THEN 'Document'
         WHEN a.resource_type = 'NOTIFICATION' THEN 'Notification'
         WHEN a.resource_type = 'EMPLOYEE' THEN 'Employee'
         WHEN a.resource_type = 'TRANSACTION' THEN 'Transaction'
         WHEN a.resource_type = 'LEDGER' THEN 'Ledger'
         WHEN a.resource_type = 'HIERARCHY_TRANSFER' THEN 'Hierarchy Transfer'
         ELSE a.resource_type
       END AS target_badge,
       login_event.latitude             AS login_latitude,
       login_event.longitude            AS login_longitude,
       login_event.location_accuracy    AS login_location_accuracy,
       login_event.location_status      AS login_location_status,
       login_event.location_captured_at AS login_location_captured_at
FROM audit_logs a
LEFT JOIN users u ON u.id = a.actor_user_id
LEFT JOIN (
  SELECT ur.user_id,
         GROUP_CONCAT(DISTINCT r.code ORDER BY r.code SEPARATOR ',') AS roles
  FROM user_roles ur
  INNER JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
  GROUP BY ur.user_id
) actor_roles ON actor_roles.user_id = a.actor_user_id
LEFT JOIN parties user_party ON user_party.id = u.party_id
LEFT JOIN parties direct_party ON direct_party.id = a.actor_party_id
LEFT JOIN users t_user ON t_user.id = a.resource_id
LEFT JOIN parties t_party ON t_party.id = a.resource_id AND a.resource_type = 'PARTY'
LEFT JOIN users t_user2 ON t_user2.id = a.resource_id AND a.resource_type IN ('SESSION','AUTH')
LEFT JOIN wallets w ON w.id = a.resource_id AND a.resource_type = 'WALLET'
LEFT JOIN parties w_party ON w_party.id = w.party_id
LEFT JOIN login_history login_event
  ON a.action = 'LOGIN_SUCCESS'
 AND login_event.session_id = JSON_UNQUOTE(JSON_EXTRACT(a.metadata, '$.sessionId'))
`;

const buildFilterWhereClauses = (
  filters: ListFilters | ExportFilters,
  params: unknown[],
): string[] => {
  const whereClauses: string[] = [];

  if (filters.actorUserId) {
    whereClauses.push('actor_user_id = ?');
    params.push(filters.actorUserId);
  }
  if (filters.action && filters.action.length > 0) {
    const placeholders = filters.action.map(() => '?').join(',');
    whereClauses.push(`action IN (${placeholders})`);
    params.push(...filters.action);
  }
  if (filters.resourceType && filters.resourceType.length > 0) {
    const placeholders = filters.resourceType.map(() => '?').join(',');
    whereClauses.push(`resource_type IN (${placeholders})`);
    params.push(...filters.resourceType);
  }
  if (filters.outcome) {
    whereClauses.push('outcome = ?');
    params.push(filters.outcome);
  }
  if (filters.startDate && filters.endDate) {
    whereClauses.push('DATE(created_at) BETWEEN ? AND ?');
    params.push(filters.startDate, filters.endDate);
  } else if (filters.startDate) {
    whereClauses.push('DATE(created_at) >= ?');
    params.push(filters.startDate);
  } else if (filters.endDate) {
    whereClauses.push('DATE(created_at) <= ?');
    params.push(filters.endDate);
  }
  if (filters.resourceId) {
    whereClauses.push('resource_id = ?');
    params.push(filters.resourceId);
  }
  if (filters.ipAddress) {
    whereClauses.push('ip_address = ?');
    params.push(filters.ipAddress);
  }
  if (filters.actorRole) {
    whereClauses.push(`actor_user_id IN (
      SELECT ur.user_id FROM user_roles ur
      INNER JOIN roles r ON r.id = ur.role_id AND r.is_active = TRUE
      WHERE r.code = ?
    )`);
    params.push(filters.actorRole);
  }
  if (filters.keyword && filters.keyword.trim().length > 0) {
    const like = `%${filters.keyword.trim()}%`;
    whereClauses.push(`(
      action LIKE ?
      OR JSON_SEARCH(metadata, 'one', ?, NULL, '$.*') IS NOT NULL
      OR JSON_SEARCH(after_data, 'one', ?, NULL, '$.*') IS NOT NULL
      OR JSON_SEARCH(before_data, 'one', ?, NULL, '$.*') IS NOT NULL
      OR actor_full_name LIKE ?
    )`);
    params.push(like, like, like, like, like);
  }

  return whereClauses;
};

export const listAuditLogs = async (
  filters: ListFilters,
  auth: AuthenticatedUser,
): Promise<PaginatedAuditLogResult> => {
  const params: unknown[] = [];
  const whereClauses: string[] = [];

  if (!isAdminScope(auth)) {
    whereClauses.push('actor_user_id = ?');
    params.push(auth.userId);
  }

  const filterClauses = buildFilterWhereClauses(filters, params);
  whereClauses.push(...filterClauses);

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
    `SELECT COUNT(*) as c FROM (${ENRICHED_AUDIT_JOIN_SELECT}) x ${whereSql}`,
    params,
  );
  const totalItems = Number(countRows[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize));
  const page = Math.max(1, Math.min(filters.page, totalPages));
  const offset = (page - 1) * filters.pageSize;

  const [rows] = await pool.query<AuditLogRow[]>(
    `SELECT x.* FROM (${ENRICHED_AUDIT_JOIN_SELECT}) x ${whereSql} ORDER BY x.created_at DESC LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, offset],
  );
  const items = rows.map(mapRowToAuditLog);

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

export const getAuditLogById = async (
  id: AuditLogIdInput['id'],
  auth: AuthenticatedUser,
): Promise<AuditLog> => {
  const params: unknown[] = [id];
  const whereClauses: string[] = ['id = ?'];

  if (!isAdminScope(auth)) {
    whereClauses.push('actor_user_id = ?');
    params.push(auth.userId);
  }

  const [rows] = await pool.query<AuditLogRow[]>(
    `SELECT x.* FROM (${ENRICHED_AUDIT_JOIN_SELECT}) x WHERE ${whereClauses.join(' AND ')} LIMIT 1`,
    params,
  );
  if (!rows.length) {
    throw new ApiError(404, 'NOT_FOUND', 'Audit log not found or not accessible');
  }
  return mapRowToAuditLog(rows[0]!);
};

export const getAuditLogSummary = async (
  auth: AuthenticatedUser,
): Promise<AuditLogSummary> => {
  const scopeParams: unknown[] = [];
  const scopeWhere: string[] = [];

  if (!isAdminScope(auth)) {
    scopeWhere.push('actor_user_id = ?');
    scopeParams.push(auth.userId);
  }
  const scopeSql = scopeWhere.length > 0 ? 'AND ' + scopeWhere.join(' AND ') : '';

  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       SUM(CASE WHEN DATE(created_at) = ? THEN 1 ELSE 0 END) AS todayActionsCount,
       SUM(CASE WHEN outcome = 'FAILURE' THEN 1 ELSE 0 END) AS failedActionsCount,
       SUM(CASE WHEN (
         action IN (${WALLET_CRITICAL_ACTIONS.map(() => '?').join(',')}) AND outcome = 'FAILURE'
       ) OR action = 'WALLET_BALANCE_CORRECTION' THEN 1 ELSE 0 END) AS criticalWalletEvents
     FROM audit_logs
     WHERE 1=1 ${scopeSql}`,
    [today, ...WALLET_CRITICAL_ACTIONS, ...scopeParams],
  );
  const row = (rows[0] as Record<string, unknown>) ?? {};

  const topParams: unknown[] = [];
  const topWhere: string[] = ['created_at > NOW() - INTERVAL 24 HOUR'];
  if (!isAdminScope(auth)) {
    topWhere.push('actor_user_id = ?');
    topParams.push(auth.userId);
  }
  const [topRows] = await pool.query<RowDataPacket[]>(
    `SELECT actor_user_id AS actorUserId, COUNT(*) AS actionCount
     FROM audit_logs
     WHERE ${topWhere.join(' AND ')}
       AND actor_user_id IS NOT NULL
     GROUP BY actor_user_id
     ORDER BY actionCount DESC
     LIMIT 5`,
    topParams,
  );

  return {
    todayActionsCount: Number(row.todayActionsCount ?? 0),
    failedActionsCount: Number(row.failedActionsCount ?? 0),
    criticalWalletEvents: Number(row.criticalWalletEvents ?? 0),
    topActorUsers: topRows.map((r) => ({
      actorUserId: String((r as Record<string, unknown>).actorUserId ?? ''),
      actionCount: Number((r as Record<string, unknown>).actionCount ?? 0),
    })),
  };
};

export const getActionCatalog = async (
  auth: AuthenticatedUser,
): Promise<ActionCatalogItem[]> => {
  const params: unknown[] = [];
  const whereClauses: string[] = ['created_at > NOW() - INTERVAL 90 DAY'];

  if (!isAdminScope(auth)) {
    whereClauses.push('actor_user_id = ?');
    params.push(auth.userId);
  }

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT action, resource_type AS resourceType
     FROM audit_logs
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY resource_type, action`,
    params,
  );

  return rows.map((r) => ({
    action: String((r as Record<string, unknown>).action ?? ''),
    resourceType: String((r as Record<string, unknown>).resourceType ?? ''),
  }));
};

const escapeCsv = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
};

const jsonCompact = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const parsed = safeJsonParse(v);
  try {
    return JSON.stringify(parsed);
  } catch {
    return String(parsed ?? v);
  }
};

export const exportAuditLogsCsv = async (
  filters: ExportFilters,
  auth: AuthenticatedUser,
  response: Response,
): Promise<void> => {
  const params: unknown[] = [];
  const whereClauses: string[] = [];

  if (!isAdminScope(auth)) {
    whereClauses.push('actor_user_id = ?');
    params.push(auth.userId);
  }

  const filterClauses = buildFilterWhereClauses(filters, params);
  whereClauses.push(...filterClauses);

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const EXPORT_LIMIT = 250000;
  const [rows] = await pool.query<AuditLogRow[]>(
    `SELECT x.* FROM (${ENRICHED_AUDIT_JOIN_SELECT}) x ${whereSql} ORDER BY x.created_at DESC LIMIT ?`,
    [...params, EXPORT_LIMIT],
  );

  const headers = [
    'Activity ID', 'Timestamp', 'Action', 'Module', 'Outcome',
    'Actor Name', 'Actor Email', 'Actor Role', 'Actor Party Role',
    'Target Entity', 'Target Subtitle', 'Target Badge',
    'What Happened', 'Impact', 'Reason', 'Severity',
    'Source IP', 'Trace ID', 'Correlation ID',
    'Before State (JSON)', 'After State (JSON)', 'Metadata (JSON)',
  ];

  const lines = [headers.join(',')];
  for (const row of rows) {
    const enriched = mapRowToAuditLog(row);
    lines.push([
      enriched.id,
      enriched.createdAt,
      enriched.action,
      enriched.module,
      enriched.status,
      escapeCsv(enriched.actorName),
      escapeCsv(row.actor_email),
      escapeCsv(enriched.actorRole),
      escapeCsv(row.actor_party_role),
      escapeCsv(enriched.targetName),
      escapeCsv(enriched.targetSummary),
      escapeCsv(enriched.targetBadge),
      escapeCsv(enriched.whatHappened),
      escapeCsv(enriched.impact),
      escapeCsv(enriched.reason ?? ''),
      escapeCsv(enriched.severity),
      escapeCsv(row.ip_address),
      escapeCsv(enriched.traceId),
      escapeCsv(enriched.correlationId),
      jsonCompact(row.before_data),
      jsonCompact(row.after_data),
      jsonCompact(row.metadata),
    ].map(escapeCsv).join(','));
  }

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timeStamp = now.toISOString().slice(11, 19).replace(/:/g, '');
  const filename = `audit_logs_${dateStamp}_${timeStamp}.csv`;

  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.send('\uFEFF' + lines.join('\r\n'));
};

export interface TraceApiRequestRow extends RowDataPacket {
  id: number;
  request_id: string | null;
  actor_user_id: string | null;
  actor_party_id: string | null;
  method: string;
  route_template: string | null;
  full_url: string | null;
  status_code: number;
  status_class: string;
  response_time_ms: number;
  ip_address: string | null;
  user_agent: string | null;
  error_code: string | null;
  created_at: Date;
}

export interface TraceResult {
  referenceId: string;
  traceId: string;
  correlationId: string;
  activityLogs: AuditLog[];
  apiRequests: Array<{
    id: string;
    requestId: string;
    method: string;
    route: string | null;
    statusCode: number;
    responseTimeMs: number;
    ipAddress: string | null;
    errorCode: string | null;
    createdAt: string;
  }>;
  counts: {
    activity: number;
    api: number;
    total: number;
  };
  matchedOn: Array<'TRACE_ID' | 'CORRELATION_ID' | 'REQUEST_ID' | 'RESOURCE_ID' | 'ACTIVITY_ID' | 'ACTOR_ID'>;
  timeframe: { earliest: string | null; latest: string | null };
}

export async function traceAuditByReference(
  referenceIdRaw: string,
  _auth: AuthenticatedUser,
): Promise<TraceResult> {
  void _auth;
  const ref = referenceIdRaw.trim();
  const refUpper = ref.toUpperCase();
  const withoutPrefix = refUpper.startsWith('ACT_') ? refUpper.slice(4) : ref;
  const isNumericOnly = /^\d+$/.test(withoutPrefix);

  const matchedOn: TraceResult['matchedOn'] = [];
  const likeExpr = `%${ref}%`;
  const numericLookup = isNumericOnly ? Number(withoutPrefix) : null;

  const whereAudit = `
    WHERE 1=0
    OR a.request_id LIKE ?
    OR a.resource_id = ?
    OR a.resource_id LIKE ?
    OR a.actor_user_id LIKE ?
    OR a.actor_party_id LIKE ?
    ${isNumericOnly ? 'OR a.id = ?' : ''}
  `;
  const baseAuditParams: unknown[] = [
    likeExpr,
    ref,
    likeExpr,
    likeExpr,
    likeExpr,
  ];
  if (isNumericOnly) baseAuditParams.push(numericLookup);

  const auditSql = `${ENRICHED_AUDIT_JOIN_SELECT} ${whereAudit} ORDER BY a.created_at DESC LIMIT 200`;
  const [auditRows] = await pool.query<AuditLogRow[]>(auditSql, baseAuditParams);

  if (auditRows.length > 0) {
    matchedOn.push('ACTIVITY_ID');
    if (auditRows.some((r) => r.request_id && ref.includes(String(r.request_id)))) matchedOn.push('REQUEST_ID');
    if (auditRows.some((r) => r.resource_id === ref)) matchedOn.push('RESOURCE_ID');
  }

  const auditLogs = auditRows.map(mapRowToAuditLog);

  const apiSql = `
    SELECT
      arl.id, arl.request_id, arl.actor_user_id, arl.actor_party_id,
      arl.method, arl.route_template, arl.full_url, arl.status_code,
      arl.status_class, arl.response_time_ms, arl.ip_address,
      arl.user_agent, arl.error_code, arl.created_at
    FROM api_request_logs arl
    WHERE 1=0
       OR arl.request_id LIKE ?
       OR arl.actor_user_id LIKE ?
       OR arl.actor_party_id LIKE ?
       OR arl.route_template LIKE ?
       OR arl.full_url LIKE ?
    ORDER BY arl.created_at DESC
    LIMIT 200
  `;
  const [apiRows] = await pool.query<TraceApiRequestRow[]>(apiSql, [
    likeExpr, likeExpr, likeExpr, likeExpr, likeExpr,
  ]);
  if (apiRows.length > 0 && !matchedOn.includes('REQUEST_ID')) matchedOn.push('REQUEST_ID');

  const apiRequests = apiRows.map((r) => ({
    id: `API_${String(r.id).padStart(8, '0')}`,
    requestId: r.request_id ?? `REQ_${r.id}`,
    method: r.method,
    route: r.route_template ?? r.full_url ?? null,
    statusCode: r.status_code,
    responseTimeMs: r.response_time_ms,
    ipAddress: r.ip_address ?? null,
    errorCode: r.error_code ?? null,
    createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
  }));

  const allDates: Date[] = [
    ...auditRows.map((r) => r.created_at).filter(Boolean),
    ...apiRows.map((r) => r.created_at).filter(Boolean),
  ];
  const earliest = allDates.length > 0 ? new Date(Math.min(...allDates.map((d) => d.getTime()))).toISOString() : null;
  const latest = allDates.length > 0 ? new Date(Math.max(...allDates.map((d) => d.getTime()))).toISOString() : null;

  const traceId = auditLogs[0]?.traceId ?? apiRequests[0]?.requestId ?? `REF_${ref.slice(0, 24)}`;
  const correlationId = auditLogs[0]?.correlationId ?? apiRequests[0]?.requestId ?? traceId;

  if (auditLogs.some((l) => l.traceId && l.traceId.toLowerCase() === ref.toLowerCase())) {
    if (!matchedOn.includes('TRACE_ID')) matchedOn.push('TRACE_ID');
  }
  if (auditLogs.some((l) => l.correlationId && l.correlationId.toLowerCase() === ref.toLowerCase())) {
    if (!matchedOn.includes('CORRELATION_ID')) matchedOn.push('CORRELATION_ID');
  }

  return {
    referenceId: ref,
    traceId,
    correlationId,
    activityLogs: auditLogs,
    apiRequests,
    counts: {
      activity: auditLogs.length,
      api: apiRequests.length,
      total: auditLogs.length + apiRequests.length,
    },
    matchedOn,
    timeframe: { earliest, latest },
  };
}
