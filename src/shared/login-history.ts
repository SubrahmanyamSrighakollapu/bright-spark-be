import type { PoolConnection } from 'mysql2/promise';
import { pool } from '../database/pool.js';
import { logger } from '../config/logger.js';
import { normalizeClientIp } from './ip.js';

export type LoginHistoryResult = 'SUCCESS' | 'FAILED' | 'LOCKED' | 'LOGGED_OUT' | 'REFRESH';
export type LoginHistoryMethod = 'PASSWORD' | 'REFRESH_TOKEN' | 'OTP' | 'SSO';
export type LoginHistoryLocationStatus =
  | 'GRANTED'
  | 'DENIED'
  | 'TIMEOUT'
  | 'UNSUPPORTED'
  | 'ERROR'
  | 'PENDING'
  | 'UNAVAILABLE';
export type LoginHistoryFailReason =
  | 'BAD_PASSWORD'
  | 'LOCKED'
  | 'UNVERIFIED'
  | 'NOT_FOUND'
  | 'TOKEN_EXPIRED'
  | 'TAMPERED'
  | 'REVOKED'
  | null;

export interface InsertLoginHistoryInput {
  userId?: string | null | undefined;
  sessionId?: string | null | undefined;
  result: LoginHistoryResult;
  ipAddress?: string | null | undefined;
  userAgent?: string | null | undefined;
  deviceFingerprint?: string | null | undefined;
  failReason?: LoginHistoryFailReason | undefined;
  loginMethod?: LoginHistoryMethod | undefined;
  refreshJti?: string | null | undefined;
  metadata?: unknown;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  locationAccuracy?: number | null | undefined;
  locationStatus?: LoginHistoryLocationStatus | undefined;
  locationCapturedAt?: Date | string | null | undefined;
  createdAt?: Date | undefined;
}

const serializeMeta = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const normalizeLocationTs = (v: Date | string | null | undefined): Date | null => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const parsed = new Date(v);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export async function insertLoginHistory(
  input: InsertLoginHistoryInput,
  txConnection?: PoolConnection,
): Promise<void> {
  const connection = txConnection ?? pool;
  try {
    await connection.execute(
      `INSERT INTO login_history (
         user_id, session_id, result, ip_address, user_agent, device_fingerprint,
         fail_reason, login_method, refresh_jti, metadata,
         latitude, longitude, location_accuracy, location_status, location_captured_at,
         created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP(6)), CURRENT_TIMESTAMP(6))`,
      [
        input.userId ?? null,
        input.sessionId ?? null,
        input.result,
        normalizeClientIp(input.ipAddress),
        input.userAgent ?? null,
        input.deviceFingerprint ?? null,
        input.failReason ?? null,
        input.loginMethod ?? 'PASSWORD',
        input.refreshJti ?? null,
        serializeMeta(input.metadata),
        input.latitude ?? null,
        input.longitude ?? null,
        input.locationAccuracy ?? null,
        input.locationStatus ?? 'UNAVAILABLE',
        normalizeLocationTs(input.locationCapturedAt),
        input.createdAt ?? null,
      ],
    );
  } catch (error) {
    logger.warn(
      { err: error, result: input.result, userId: input.userId ?? null },
      'insertLoginHistory: best-effort insert failed (swallowed)',
    );
  }
}

export function insertLoginHistoryVoid(
  input: InsertLoginHistoryInput,
  txConnection?: PoolConnection,
): void {
  void insertLoginHistory(input, txConnection);
}
