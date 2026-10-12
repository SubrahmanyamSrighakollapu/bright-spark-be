import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';

export type ApiRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD';
export type ApiRequestStatusClass = '2XX' | '3XX' | '4XX' | '5XX';

export interface InsertApiRequestLogInput {
  requestId?: string | null;
  actorUserId?: string | null;
  actorPartyId?: string | null;
  method: ApiRequestMethod;
  routeTemplate?: string | null;
  fullUrl?: string | null;
  statusCode: number;
  responseTimeMs: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  errorCode?: string | null;
  createdAt?: Date;
}

export function statusClassOf(statusCode: number): ApiRequestStatusClass {
  if (statusCode < 300) return '2XX';
  if (statusCode < 400) return '3XX';
  if (statusCode < 500) return '4XX';
  return '5XX';
}

export async function insertApiRequestLog(
  input: InsertApiRequestLogInput,
  txConnection?: PoolConnection,
): Promise<void> {
  const connection = txConnection ?? pool;
  try {
    const statusClass = statusClassOf(input.statusCode);
    await connection.execute(
      `INSERT INTO api_request_logs (
         request_id, actor_user_id, actor_party_id, method, route_template, full_url,
         status_code, status_class, response_time_ms, ip_address, user_agent, error_code, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP(6)))`,
      [
        input.requestId ?? null,
        input.actorUserId ?? null,
        input.actorPartyId ?? null,
        input.method,
        input.routeTemplate ?? null,
        input.fullUrl ?? null,
        input.statusCode,
        statusClass,
        Math.max(0, Math.floor(input.responseTimeMs || 0)),
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.errorCode ?? null,
        input.createdAt ?? null,
      ] as any,
    );
  } catch (error) {
    logger.warn(
      { err: error, method: input.method, statusCode: input.statusCode, routeTemplate: input.routeTemplate ?? null },
      'insertApiRequestLog: best-effort insert failed (swallowed, response already sent)',
    );
  }
}

export function insertApiRequestLogVoid(input: InsertApiRequestLogInput): void {
  void insertApiRequestLog(input);
}
