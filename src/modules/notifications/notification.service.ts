import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { pool } from '../../database/pool.js';
import { logger } from '../../config/logger.js';
import { ApiError } from '../../shared/api-error.js';
import { writeAuditLog, writeAuditLogVoid, contextFromAuth, type WriteAuditLogContext } from '../../shared/audit.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type {
  publishAnnouncementSchema,
  updatePreferenceSchema,
  listNotificationsSchema,
  targetSchema,
} from './notification.schemas.js';
import { z } from 'zod';

type ListFilters = z.infer<typeof listNotificationsSchema>;
type PublishAnnouncementInput = z.infer<typeof publishAnnouncementSchema>;
type UpdatePreferenceInput = z.infer<typeof updatePreferenceSchema>;
export type Target = z.infer<typeof targetSchema>;

export interface NotificationRow extends RowDataPacket {
  id: string;
  recipient_user_id: string;
  category: string;
  notification_type: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  action_required: number | boolean;
  entity_type: string | null;
  entity_id: string | null;
  related_entity: string | null;
  source_module: string | null;
  title: string;
  message: string;
  data: unknown;
  is_announcement: number | boolean;
  announcement_audience: unknown;
  created_by_user_id: string | null;
  delivered_at: Date | null;
  read_at: Date | null;
  dismissed_at: Date | null;
  clicked_at: Date | null;
  expires_at: Date | null;
  created_at: Date;
}

export interface NotificationPreferenceMasterRow extends RowDataPacket {
  code: string;
  label: string;
  description: string | null;
  configuration: unknown;
  sort_order: number;
}

export interface NotificationPreferenceStoredRow extends RowDataPacket {
  user_id: string;
  event_code: string;
  in_app_enabled: number | boolean;
  email_enabled: number | boolean;
  sms_enabled: number | boolean;
  push_enabled: number | boolean;
  updated_at: Date;
}

export interface Notification {
  id: string;
  recipientUserId: string;
  category: string;
  type: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  actionRequired: boolean;
  entityType?: string | null;
  entityId?: string | null;
  relatedEntity?: string | null;
  sourceModule?: string | null;
  title: string;
  message: string;
  metadata?: Record<string, unknown> | null;
  isAnnouncement: boolean;
  announcementAudience?: unknown;
  createdByUserId?: string | null;
  deliveredAt?: string | null;
  status: 'UNREAD' | 'READ';
  readAt?: string | null;
  dismissedAt?: string | null;
  clickedAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
}

export interface NotificationSummary {
  totalNotifications: number;
  unreadCount: number;
  criticalCount: number;
  actionRequiredCount: number;
  todayCount: number;
  readCount: number;
}

export interface PaginatedNotificationResult {
  items: Notification[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  summary: NotificationSummary;
}

export interface NotificationPreferenceItem {
  type: string;
  label: string;
  category: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  inAppMandatory: boolean;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  smsEnabled: boolean;
  pushEnabled: boolean;
}

export interface DispatchEventInput {
  type: string;
  category: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  relatedEntity?: string;
  sourceModule?: string;
  actionRequired?: boolean;
  metadata?: Record<string, unknown>;
}

const toBoolean = (v: number | boolean | null | undefined): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  return v === 1;
};

const formatDateIso = (d: Date | string | null | undefined): string | null => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
};

const mapRowToNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  recipientUserId: row.recipient_user_id,
  category: row.category,
  type: row.notification_type,
  severity: row.severity,
  actionRequired: toBoolean(row.action_required),
  entityType: row.entity_type,
  entityId: row.entity_id,
  relatedEntity: row.related_entity,
  sourceModule: row.source_module,
  title: row.title,
  message: row.message,
  metadata: row.data as Record<string, unknown> | null,
  isAnnouncement: toBoolean(row.is_announcement),
  announcementAudience: row.announcement_audience,
  createdByUserId: row.created_by_user_id,
  deliveredAt: formatDateIso(row.delivered_at),
  status: row.read_at ? 'READ' : 'UNREAD',
  readAt: formatDateIso(row.read_at),
  dismissedAt: formatDateIso(row.dismissed_at),
  clickedAt: formatDateIso(row.clicked_at),
  expiresAt: formatDateIso(row.expires_at),
  createdAt: formatDateIso(row.created_at) ?? new Date().toISOString(),
});

// --------------------------
// Target resolver
// --------------------------
export const resolveTargetUsers = async (target: Target): Promise<string[]> => {
  switch (target.kind) {
    case 'ALL': {
      const [rows] = await pool.query<{ id: string }[] & RowDataPacket[]>(
        `SELECT id FROM users WHERE status = 'ACTIVE'`,
      );
      return rows.map((r) => r.id);
    }
    case 'USER_IDS': {
      if (target.userIds.length === 0) return [];
      const placeholders = target.userIds.map(() => '?').join(',');
      const [rows] = await pool.query<{ id: string }[] & RowDataPacket[]>(
        `SELECT id FROM users WHERE status = 'ACTIVE' AND id IN (${placeholders})`,
        target.userIds,
      );
      const found = new Set(rows.map((r) => r.id));
      return target.userIds.filter((id) => found.has(id));
    }
    case 'ROLES': {
      if (target.roles.length === 0) return [];
      const placeholders = target.roles.map(() => '?').join(',');
      const [rows] = await pool.query<{ id: string }[] & RowDataPacket[]>(
        `SELECT u.id
         FROM users u
         INNER JOIN parties p ON p.user_id = u.id
         WHERE u.status = 'ACTIVE'
           AND p.role IN (${placeholders})
         UNION
         SELECT id FROM users WHERE status = 'ACTIVE' AND role IN (${placeholders})`,
        [...target.roles, ...target.roles],
      );
      return Array.from(new Set(rows.map((r) => r.id)));
    }
    case 'HIERARCHY': {
      const userIds = new Set<string>();
      const visited = new Set<string>();
      let frontier: string[] = [target.ownerUserId];
      if (target.includeOwner) {
        const [ownerRows] = await pool.query<{ id: string; status: string }[] & RowDataPacket[]>(
          `SELECT id, status FROM users WHERE id = ?`,
          [target.ownerUserId],
        );
        if (ownerRows.length && ownerRows[0]!.status === 'ACTIVE') userIds.add(ownerRows[0]!.id);
      }
      let safetyDepth = 0;
      while (frontier.length > 0 && safetyDepth < 20) {
        safetyDepth++;
        const placeholders = frontier.map(() => '?').join(',');
        const [childRows] = await pool.query<{ id: string; parent_user_id: string | null; status: string }[] & RowDataPacket[]>(
          `SELECT u.id, u.status,
                  COALESCE(
                    (SELECT parent_user_id FROM parties WHERE user_id = u.id LIMIT 1),
                    NULL
                  ) AS parent_user_id
           FROM users u
           WHERE COALESCE((SELECT parent_user_id FROM parties WHERE user_id = u.id LIMIT 1), NULL) IN (${placeholders})`,
          frontier,
        );
        const next: string[] = [];
        for (const child of childRows) {
          if (visited.has(child.id)) continue;
          visited.add(child.id);
          if (child.status === 'ACTIVE') userIds.add(child.id);
          next.push(child.id);
        }
        frontier = next;
      }
      return Array.from(userIds);
    }
  }
};

// --------------------------
// Preference lookup helper — true => user is allowed to receive in_app
// --------------------------
const getUserInAppAllowed = async (userId: string, eventCode: string, mandatoryOverride?: boolean): Promise<{ allowed: boolean; mandatory: boolean }> => {
  const [masterRows] = await pool.query<NotificationPreferenceMasterRow[]>(
    `SELECT code, configuration FROM master_data WHERE category = 'NOTIFICATION_EVENT' AND code = ? LIMIT 1`,
    [eventCode],
  );
  let inAppMandatory = mandatoryOverride ?? false;
  if (masterRows.length && masterRows[0]!.configuration) {
    const cfg = masterRows[0]!.configuration as { inAppMandatory?: boolean } | null;
    if (cfg && typeof cfg.inAppMandatory === 'boolean') inAppMandatory = cfg.inAppMandatory;
  }
  if (inAppMandatory) return { allowed: true, mandatory: true };
  const [prefRows] = await pool.query<NotificationPreferenceStoredRow[]>(
    `SELECT in_app_enabled FROM notification_preferences WHERE user_id = ? AND event_code = ? LIMIT 1`,
    [userId, eventCode],
  );
  if (prefRows.length === 0) return { allowed: true, mandatory: false }; // default: enabled
  return { allowed: toBoolean(prefRows[0]!.in_app_enabled), mandatory: false };
};

// --------------------------
// Bulk insert notifications, batched to 100 rows per execute
// --------------------------
interface NotificationInsertRow {
  id: string;
  recipient_user_id: string;
  category: string;
  notification_type: string;
  severity: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
  action_required: 0 | 1;
  entity_type: string | null;
  entity_id: string | null;
  related_entity: string | null;
  source_module: string | null;
  title: string;
  message: string;
  data: string | null;
  is_announcement: 0 | 1;
  announcement_audience: string | null;
  created_by_user_id: string | null;
  delivered_at: Date;
  read_at: null;
  dismissed_at: null;
  clicked_at: null;
  expires_at: Date | null;
}

const bulkInsertNotifications = async (rows: NotificationInsertRow[]): Promise<number> => {
  if (rows.length === 0) return 0;
  const BATCH = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const values: unknown[] = [];
    for (const r of batch) {
      values.push(
        r.id, r.recipient_user_id, r.category, r.notification_type, r.severity,
        r.action_required, r.entity_type, r.entity_id, r.related_entity, r.source_module,
        r.title, r.message, r.data, r.is_announcement, r.announcement_audience,
        r.created_by_user_id, r.delivered_at, r.read_at, r.dismissed_at, r.clicked_at,
      );
      if (r.expires_at) {
        values[values.length - 1] = r.expires_at;
      } else {
        values[values.length - 1] = null;
      }
      // Actually we have 20 placeholders but 21 values for expires_at handling — fix below
    }
    // Rewrite using explicit 21-col insert with expiry:
    void placeholders;
  }
  // Run again with correct 21-col SQL:
  inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const placeholders = batch.map(() => '(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').join(',');
    const values: unknown[] = [];
    for (const r of batch) {
      values.push(
        r.id, r.recipient_user_id, r.category, r.notification_type, r.severity,
        r.action_required, r.entity_type, r.entity_id, r.related_entity, r.source_module,
        r.title, r.message, r.data, r.is_announcement, r.announcement_audience,
        r.created_by_user_id, r.delivered_at, r.read_at, r.dismissed_at, r.clicked_at, r.expires_at,
      );
    }
    const [result] = await pool.query<ResultSetHeader>(
      `INSERT INTO notifications (id, recipient_user_id, category, notification_type, severity, action_required, entity_type, entity_id, related_entity, source_module, title, message, data, is_announcement, announcement_audience, created_by_user_id, delivered_at, read_at, dismissed_at, clicked_at, expires_at) VALUES ${placeholders}`,
      values,
    );
    inserted += result.affectedRows;
  }
  return inserted;
};

// --------------------------
// Internal dispatch — usable by other modules, best-effort non-throwing
// --------------------------
export const dispatchEvent = async (
  event: DispatchEventInput,
  target: Target,
  createdByUserId?: string,
): Promise<{ targetCount: number; createdCount: number; skippedDueToPreferences: number }> => {
  try {
    const targetUserIds = await resolveTargetUsers(target);
    let skipped = 0;
    const now = new Date();
    const rows: NotificationInsertRow[] = [];
    for (const userId of targetUserIds) {
      const { allowed } = await getUserInAppAllowed(userId, event.type);
      if (!allowed) {
        skipped++;
        continue;
      }
      rows.push({
        id: randomUUID(),
        recipient_user_id: userId,
        category: event.category,
        notification_type: event.type,
        severity: event.severity,
        action_required: event.actionRequired ? 1 : 0,
        entity_type: event.entityType ?? null,
        entity_id: event.entityId ?? null,
        related_entity: event.relatedEntity ?? null,
        source_module: event.sourceModule ?? null,
        title: event.title,
        message: event.message,
        data: event.metadata ? JSON.stringify(event.metadata) : null,
        is_announcement: 0,
        announcement_audience: JSON.stringify(target),
        created_by_user_id: createdByUserId ?? null,
        delivered_at: now,
        read_at: null,
        dismissed_at: null,
        clicked_at: null,
        expires_at: null,
      });
    }
    const createdCount = await bulkInsertNotifications(rows);
    return { targetCount: targetUserIds.length, createdCount, skippedDueToPreferences: skipped };
  } catch (error) {
    logger.error({ err: error, eventType: event.type }, 'notification.dispatchEvent failed — delivery best-effort, suppressed');
    return { targetCount: 0, createdCount: 0, skippedDueToPreferences: 0 };
  }
};

// --------------------------
// List + Summary + Pagination
// --------------------------
export const listNotifications = async (
  filters: ListFilters,
  auth: AuthenticatedUser,
): Promise<PaginatedNotificationResult> => {
  const whereClauses: string[] = ['recipient_user_id = ?'];
  const params: unknown[] = [auth.userId];

  if (filters.category && filters.category !== 'ALL') {
    whereClauses.push('category = ?');
    params.push(filters.category);
  }
  if (filters.severity && filters.severity !== 'ALL') {
    whereClauses.push('severity = ?');
    params.push(filters.severity);
  }
  if (filters.status && filters.status !== 'ALL') {
    if (filters.status === 'UNREAD') whereClauses.push('read_at IS NULL');
    else if (filters.status === 'READ') whereClauses.push('read_at IS NOT NULL');
  }
  if (filters.actionRequired && filters.actionRequired !== 'ALL') {
    whereClauses.push('action_required = ?');
    params.push(filters.actionRequired === 'true' ? 1 : 0);
  }
  if (filters.excludeDismissed === 'true') {
    whereClauses.push('dismissed_at IS NULL');
  }
  if (filters.dateFrom) {
    whereClauses.push('created_at >= ?');
    params.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    whereClauses.push('created_at <= ?');
    params.push(filters.dateTo);
  }
  const search = filters.search || filters.searchQuery;
  if (search && search.trim().length > 0) {
    const like = `%${search.trim()}%`;
    whereClauses.push('(id LIKE ? OR title LIKE ? OR message LIKE ? OR entity_id LIKE ? OR related_entity LIKE ?)');
    params.push(like, like, like, like, like);
  }
  const whereSql = 'WHERE ' + whereClauses.join(' AND ');

  const [countRows] = await pool.query<{ c: number }[] & RowDataPacket[]>(
    `SELECT COUNT(*) as c FROM notifications ${whereSql}`,
    params,
  );
  const totalItems = Number(countRows[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(totalItems / filters.pageSize));
  const page = Math.max(1, Math.min(filters.page, totalPages));
  const offset = (page - 1) * filters.pageSize;

  const [rows] = await pool.query<NotificationRow[]>(
    `SELECT * FROM notifications ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, filters.pageSize, offset],
  );
  const items = rows.map(mapRowToNotification);
  const summary = await getNotificationSummary(auth);
  return {
    items,
    pagination: {
      page,
      pageSize: filters.pageSize,
      totalItems,
      totalPages,
    },
    summary,
  };
};

export const getNotificationSummary = async (auth: AuthenticatedUser): Promise<NotificationSummary> => {
  const today = new Date().toISOString().slice(0, 10);
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT
       COUNT(*) AS totalNotifications,
       SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) AS unreadCount,
       SUM(CASE WHEN severity = 'CRITICAL' THEN 1 ELSE 0 END) AS criticalCount,
       SUM(CASE WHEN read_at IS NULL AND action_required = 1 THEN 1 ELSE 0 END) AS actionRequiredCount,
       SUM(CASE WHEN DATE(created_at) = ? THEN 1 ELSE 0 END) AS todayCount,
       SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS readCount
     FROM notifications
     WHERE recipient_user_id = ?`,
    [today, auth.userId],
  );
  const row = (rows[0] as Record<string, unknown>) ?? {};
  return {
    totalNotifications: Number(row.totalNotifications ?? 0),
    unreadCount: Number(row.unreadCount ?? 0),
    criticalCount: Number(row.criticalCount ?? 0),
    actionRequiredCount: Number(row.actionRequiredCount ?? 0),
    todayCount: Number(row.todayCount ?? 0),
    readCount: Number(row.readCount ?? 0),
  };
};

// --------------------------
// Single row + ownership enforcement
// --------------------------
export const getNotificationById = async (id: string, auth: AuthenticatedUser): Promise<Notification> => {
  const [rows] = await pool.query<NotificationRow[]>(
    `SELECT * FROM notifications WHERE id = ? AND recipient_user_id = ? LIMIT 1`,
    [id, auth.userId],
  );
  if (!rows.length) {
    throw new ApiError(404, 'NOT_FOUND', 'Notification not found or not accessible');
  }
  return mapRowToNotification(rows[0]!);
};

// --------------------------
// Mark-as-Read / Unread / All / Dismiss / Clicked
// --------------------------
export const markAsRead = async (id: string, auth: AuthenticatedUser): Promise<Notification> => {
  await pool.execute(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP(6), delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP(6))
     WHERE id = ? AND recipient_user_id = ? AND read_at IS NULL`,
    [id, auth.userId],
  );
  void writeAuditLogVoid({ action: 'NOTIFICATION_READ', resourceType: 'NOTIFICATION', resourceId: id }, contextFromAuth(auth));
  return getNotificationById(id, auth);
};

export const markAsUnread = async (id: string, auth: AuthenticatedUser): Promise<Notification> => {
  await pool.execute(
    `UPDATE notifications SET read_at = NULL WHERE id = ? AND recipient_user_id = ?`,
    [id, auth.userId],
  );
  void writeAuditLogVoid({ action: 'NOTIFICATION_UNREAD', resourceType: 'NOTIFICATION', resourceId: id }, contextFromAuth(auth));
  return getNotificationById(id, auth);
};

export const markAllAsRead = async (auth: AuthenticatedUser, categoryFilter?: string): Promise<{ markedCount: number }> => {
  const params: unknown[] = [auth.userId];
  const where = ['recipient_user_id = ?', 'read_at IS NULL'];
  if (categoryFilter) {
    where.push('category = ?');
    params.push(categoryFilter);
  }
  const [result] = await pool.query<ResultSetHeader>(
    `UPDATE notifications SET read_at = CURRENT_TIMESTAMP(6), delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP(6))
     WHERE ${where.join(' AND ')}`,
    params,
  );
  void writeAuditLogVoid({ action: 'NOTIFICATION_MARK_ALL_READ', resourceType: 'NOTIFICATION_BATCH', resourceId: null, metadata: { category: categoryFilter ?? null, markedCount: result.affectedRows } }, contextFromAuth(auth));
  return { markedCount: result.affectedRows };
};

export const dismissNotification = async (id: string, auth: AuthenticatedUser): Promise<Notification> => {
  await pool.execute(
    `UPDATE notifications SET dismissed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND recipient_user_id = ? AND dismissed_at IS NULL`,
    [id, auth.userId],
  );
  void writeAuditLogVoid({ action: 'NOTIFICATION_DISMISS', resourceType: 'NOTIFICATION', resourceId: id }, contextFromAuth(auth));
  return getNotificationById(id, auth);
};

export const markClicked = async (id: string, auth: AuthenticatedUser): Promise<Notification> => {
  await pool.execute(
    `UPDATE notifications SET clicked_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND recipient_user_id = ? AND clicked_at IS NULL`,
    [id, auth.userId],
  );
  return getNotificationById(id, auth);
};

// --------------------------
// Publish Announcement
// --------------------------
export const publishAnnouncement = async (
  input: PublishAnnouncementInput,
  auth: AuthenticatedUser,
): Promise<{ targetCount: number; createdCount: number; skippedDueToPreferences: number }> => {
  const target = input.target;
  const targetUserIds = await resolveTargetUsers(target);
  let skipped = 0;
  const now = new Date();
  const rows: NotificationInsertRow[] = [];
  for (const userId of targetUserIds) {
    const { allowed } = await getUserInAppAllowed(userId, 'SYSTEM_ANNOUNCEMENT');
    if (!allowed) {
      skipped++;
      continue;
    }
    rows.push({
      id: randomUUID(),
      recipient_user_id: userId,
      category: 'SYSTEM',
      notification_type: 'SYSTEM_ANNOUNCEMENT',
      severity: input.severity,
      action_required: input.actionRequired ? 1 : 0,
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      related_entity: input.relatedEntity ?? null,
      source_module: 'ADMIN_ANNOUNCEMENT',
      title: input.title,
      message: input.message,
      data: null,
      is_announcement: 1,
      announcement_audience: JSON.stringify(target),
      created_by_user_id: auth.userId,
      delivered_at: now,
      read_at: null,
      dismissed_at: null,
      clicked_at: null,
      expires_at: input.expiresAt ? new Date(input.expiresAt) : null,
    });
  }
  const createdCount = await bulkInsertNotifications(rows);
  void writeAuditLogVoid({ action: 'ANNOUNCEMENT_PUBLISH', resourceType: 'ANNOUNCEMENT', resourceId: null, metadata: {
    target: input.target,
    title: input.title,
    severity: input.severity,
    targetCount: targetUserIds.length,
    createdCount,
    skippedDueToPreferences: skipped,
  } }, contextFromAuth(auth));
  return { targetCount: targetUserIds.length, createdCount, skippedDueToPreferences: skipped };
};

// --------------------------
// Preferences
// --------------------------
export const getPreferences = async (auth: AuthenticatedUser): Promise<NotificationPreferenceItem[]> => {
  const [masterRows] = await pool.query<NotificationPreferenceMasterRow[]>(
    `SELECT code, label, description, configuration, sort_order
     FROM master_data
     WHERE category = 'NOTIFICATION_EVENT' AND is_active = TRUE
     ORDER BY sort_order, label`,
  );
  const [prefRows] = await pool.query<NotificationPreferenceStoredRow[]>(
    `SELECT event_code, in_app_enabled, email_enabled, sms_enabled, push_enabled
     FROM notification_preferences
     WHERE user_id = ?`,
    [auth.userId],
  );
  const userPrefs = new Map(prefRows.map((r) => [r.event_code, r]));
  return masterRows.map((m) => {
    const cfg = (m.configuration as { category?: string; severity?: 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL'; inAppMandatory?: boolean } | null) ?? {};
    const user = userPrefs.get(m.code);
    return {
      type: m.code,
      label: m.label,
      category: cfg.category ?? 'SYSTEM',
      severity: cfg.severity ?? 'INFO',
      inAppMandatory: Boolean(cfg.inAppMandatory),
      inAppEnabled: user ? toBoolean(user.in_app_enabled) : true,
      emailEnabled: user ? toBoolean(user.email_enabled) : false,
      smsEnabled: user ? toBoolean(user.sms_enabled) : false,
      pushEnabled: user ? toBoolean(user.push_enabled) : false,
    };
  });
};

export const updatePreference = async (
  eventCode: string,
  input: UpdatePreferenceInput,
  auth: AuthenticatedUser,
): Promise<NotificationPreferenceItem[]> => {
  // First check if event exists in master and if it's mandatory
  const [masterRows] = await pool.query<NotificationPreferenceMasterRow[]>(
    `SELECT code, configuration FROM master_data WHERE category = 'NOTIFICATION_EVENT' AND code = ? LIMIT 1`,
    [eventCode],
  );
  if (!masterRows.length) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Unknown notification event: ${eventCode}`);
  }
  const cfg = (masterRows[0]!.configuration as { inAppMandatory?: boolean } | null) ?? {};
  const inAppMandatory = Boolean(cfg.inAppMandatory);
  if (inAppMandatory && input.inAppEnabled === false) {
    throw new ApiError(400, 'VALIDATION_ERROR', `Cannot disable in-app notification for mandatory event "${eventCode}"`);
  }
  // Build the columns we'll upsert
  const sets: string[] = [];
  const values: unknown[] = [];
  if (typeof input.inAppEnabled === 'boolean') { sets.push('in_app_enabled = ?'); values.push(input.inAppEnabled ? 1 : 0); }
  if (typeof input.emailEnabled === 'boolean') { sets.push('email_enabled = ?'); values.push(input.emailEnabled ? 1 : 0); }
  if (typeof input.smsEnabled === 'boolean') { sets.push('sms_enabled = ?'); values.push(input.smsEnabled ? 1 : 0); }
  if (typeof input.pushEnabled === 'boolean') { sets.push('push_enabled = ?'); values.push(input.pushEnabled ? 1 : 0); }
  if (sets.length === 0) return getPreferences(auth);

  const params: unknown[] = [
    auth.userId,
    eventCode,
    typeof input.inAppEnabled === 'boolean' ? (input.inAppEnabled ? 1 : 0) : 1,
    typeof input.emailEnabled === 'boolean' ? (input.emailEnabled ? 1 : 0) : 0,
    typeof input.smsEnabled === 'boolean' ? (input.smsEnabled ? 1 : 0) : 0,
    typeof input.pushEnabled === 'boolean' ? (input.pushEnabled ? 1 : 0) : 0,
    ...values,
  ];
  await pool.execute(
    `INSERT INTO notification_preferences (user_id, event_code, in_app_enabled, email_enabled, sms_enabled, push_enabled, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
     ON DUPLICATE KEY UPDATE ${sets.join(', ')}, updated_at = CURRENT_TIMESTAMP(6)`,
    params as any,
  );
  void writeAuditLogVoid({ action: 'NOTIFICATION_PREFERENCE_UPDATE', resourceType: 'NOTIFICATION_PREFERENCE', resourceId: eventCode, metadata: input }, contextFromAuth(auth));
  return getPreferences(auth);
};

// --------------------------
// CSV Export
// --------------------------
export const exportNotificationsToCsv = async (filters: ListFilters, auth: AuthenticatedUser): Promise<{ filename: string; content: string }> => {
  const all: ListFilters = { ...filters, page: 1, pageSize: 5000 };
  const { items } = await listNotifications(all, auth);
  const headers = [
    'id', 'category', 'notification_type', 'severity', 'title', 'message',
    'entity_type', 'entity_id', 'related_entity', 'status', 'action_required',
    'source_module', 'created_at', 'read_at',
  ];
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [headers.join(',')];
  for (const n of items) {
    lines.push([
      n.id,
      n.category,
      n.type,
      n.severity,
      n.title,
      n.message,
      n.entityType ?? '',
      n.entityId ?? '',
      n.relatedEntity ?? '',
      n.status,
      n.actionRequired ? 'true' : 'false',
      n.sourceModule ?? '',
      n.createdAt,
      n.readAt ?? '',
    ].map(escape).join(','));
  }
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return {
    filename: `notifications_${dateStamp}.csv`,
    content: lines.join('\r\n'),
  };
};
