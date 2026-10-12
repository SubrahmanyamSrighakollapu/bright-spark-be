import type { PoolConnection } from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import type { AuthenticatedUser } from '../modules/auth/auth.types.js';

export interface WriteAuditLogInput {
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: 'SUCCESS' | 'FAILURE';
  actorUserId?: string | null;
  actorPartyId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  metadata?: unknown;
}

export interface WriteAuditLogContext {
  requestId?: string | null | undefined;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  actorUserId?: string | null | undefined;
  actorPartyId?: string | null | undefined;
}

export function contextFromAuth(
  auth: AuthenticatedUser | null | undefined,
  ctx?: Omit<WriteAuditLogContext, 'actorUserId' | 'actorPartyId'>
): WriteAuditLogContext {
  return {
    actorUserId: auth?.userId ?? null,
    actorPartyId: auth?.partyId ?? null,
    ...(ctx ?? {}),
  };
}

const serialize = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return JSON.stringify(String(value));
    } catch {
      return null;
    }
  }
};

async function runInsert(
  sqlParams: Array<unknown>,
  txConnection?: PoolConnection
): Promise<void> {
  const connection = txConnection ?? pool;
  try {
    await connection.execute(
      `INSERT INTO audit_logs (
         request_id, actor_user_id, actor_party_id, action, resource_type, resource_id,
         outcome, ip_address, user_agent, before_data, after_data, metadata, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))`,
      sqlParams as any,
    );
  } catch (error) {
    logger.warn(
      { err: error, action: sqlParams[3] as string, resourceType: sqlParams[4] as string },
      'writeAuditLog: best-effort insert failed (swallowed, business tx unaffected)',
    );
  }
}

/**
 * Best-effort, non-throwing canonical audit log writer.
 *
 * Contract:
 *  - NEVER propagates errors to callers (business response must not
 *    fail due to audit-write issues, per NFR-03).
 *  - Always writes canonical columns matching migration 001/007 schema.
 *  - Optional `txConnection` parameter lets callers execute the INSERT
 *    inside an open DB transaction (co-located with the business mutation
 *    it's recording) so the audit row commits atomically with the data.
 *  - If no transaction is supplied we write to the pool directly.
 *  - Merges context values with explicit input (explicit input wins).
 */
export async function writeAuditLog(
  input: WriteAuditLogInput,
  context?: WriteAuditLogContext,
  txConnection?: PoolConnection,
): Promise<void> {
  const mergedRequestId = input.requestId ?? context?.requestId ?? randomUUID();
  const mergedActorUserId = input.actorUserId ?? context?.actorUserId ?? null;
  const mergedActorPartyId = input.actorPartyId ?? context?.actorPartyId ?? null;
  const outcome = input.outcome ?? 'SUCCESS';
  const sqlParams: Array<unknown> = [
    mergedRequestId,
    mergedActorUserId,
    mergedActorPartyId,
    input.action,
    input.resourceType,
    input.resourceId ?? null,
    outcome,
    input.ipAddress ?? context?.ipAddress ?? null,
    input.userAgent ?? context?.userAgent ?? null,
    serialize(input.beforeData),
    serialize(input.afterData),
    serialize(input.metadata),
  ];
  await runInsert(sqlParams, txConnection);
}

/**
 * Fire-and-forget wrapper. Preferred at call sites that currently do
 * `void writeAuditLog(...)` (notification preference updates, read
 * markers, etc.) so callers don't silently lose unhandled promise
 * rejections (writeAuditLog itself never throws, but this keeps
 * linters happy about unhandled promises).
 */
export function writeAuditLogVoid(
  input: WriteAuditLogInput,
  context?: WriteAuditLogContext,
  txConnection?: PoolConnection,
): void {
  void writeAuditLog(input, context, txConnection);
}

export interface BulkAuditItem extends WriteAuditLogInput {}

/**
 * Batched writer for operations that emit > 1 audit row at once
 * (e.g. hierarchy subtree move, bulk role reassign, bulk publish).
 *
 * Uses pool.query parameterised multi-row INSERT inside a best-effort
 * try/catch; never throws. Falls back to single inserts if batch is
 * small to keep code paths simple.
 */
export async function writeAuditLogBulk(
  items: BulkAuditItem[],
  context?: WriteAuditLogContext,
  txConnection?: PoolConnection,
): Promise<void> {
  if (!Array.isArray(items) || items.length === 0) return;
  if (items.length === 1) {
    await writeAuditLog(items[0]!, context, txConnection);
    return;
  }
  const placeholders: string[] = [];
  const values: unknown[] = [];
  for (const item of items) {
    const mergedRequestId = item.requestId ?? context?.requestId ?? randomUUID();
    placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))');
    values.push(
      mergedRequestId,
      item.actorUserId ?? context?.actorUserId ?? null,
      item.actorPartyId ?? context?.actorPartyId ?? null,
      item.action,
      item.resourceType,
      item.resourceId ?? null,
      item.outcome ?? 'SUCCESS',
      item.ipAddress ?? context?.ipAddress ?? null,
      item.userAgent ?? context?.userAgent ?? null,
      serialize(item.beforeData),
      serialize(item.afterData),
      serialize(item.metadata),
    );
  }
  const connection = txConnection ?? pool;
  try {
    await connection.query(
      `INSERT INTO audit_logs (
         request_id, actor_user_id, actor_party_id, action, resource_type, resource_id,
         outcome, ip_address, user_agent, before_data, after_data, metadata, created_at
       ) VALUES ${placeholders.join(', ')}`,
      values as any,
    );
  } catch (error) {
    logger.warn(
      { err: error, count: items.length },
      'writeAuditLogBulk: best-effort batch insert failed (swallowed)',
    );
  }
}
