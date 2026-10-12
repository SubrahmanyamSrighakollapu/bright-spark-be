import { randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { pool } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import { writeAuditLog } from '../../shared/audit.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import type { z } from 'zod';
import type { createPayoutChargeSchema, resolvePayoutChargeSchema, updatePayoutChargeSchema } from './payout-charge.schemas.js';

type CreateInput = z.infer<typeof createPayoutChargeSchema>;
type UpdateInput = z.infer<typeof updatePayoutChargeSchema>;
type ResolveInput = z.infer<typeof resolvePayoutChargeSchema>;
interface ChargeRow extends RowDataPacket { id: string; payout_mode: ResolveInput['payoutMode']; min_amount: string; max_amount: string; flat_charge: string; is_active: number; version: number; created_at: Date; updated_at: Date; }
const mapRow = (row: ChargeRow) => ({ id: row.id, payoutMode: row.payout_mode, minAmount: Number(row.min_amount), maxAmount: Number(row.max_amount), flatCharge: Number(row.flat_charge), isActive: Boolean(row.is_active), version: row.version, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

async function assertNoOverlap(connection: PoolConnection, input: CreateInput, excludedId?: string) {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT id FROM payout_charge_rules
     WHERE payout_mode = ? AND is_active = TRUE AND min_amount <= ? AND max_amount >= ?
       ${excludedId ? 'AND id <> ?' : ''} FOR UPDATE`,
    excludedId ? [input.payoutMode, input.maxAmount, input.minAmount, excludedId] : [input.payoutMode, input.maxAmount, input.minAmount],
  );
  if (rows.length) throw new ApiError(409, 'PAYOUT_CHARGE_RANGE_OVERLAP', `The ${input.payoutMode} amount range overlaps an existing active rule`);
}

export async function listRules() {
  const [rows] = await pool.query<ChargeRow[]>('SELECT * FROM payout_charge_rules WHERE is_active = TRUE ORDER BY payout_mode, min_amount');
  return rows.map(mapRow);
}

export async function getRule(id: string) {
  const [rows] = await pool.query<ChargeRow[]>('SELECT * FROM payout_charge_rules WHERE id = ? AND is_active = TRUE', [id]);
  if (!rows[0]) throw new ApiError(404, 'PAYOUT_CHARGE_NOT_FOUND', 'Payout charge rule was not found');
  return mapRow(rows[0]);
}

export async function resolveRule(input: ResolveInput) {
  const [rows] = await pool.query<ChargeRow[]>(
    `SELECT * FROM payout_charge_rules WHERE payout_mode = ? AND is_active = TRUE AND ? BETWEEN min_amount AND max_amount ORDER BY min_amount DESC LIMIT 1`,
    [input.payoutMode, input.amount],
  );
  if (!rows[0]) throw new ApiError(404, 'PAYOUT_CHARGE_NOT_CONFIGURED', `No ${input.payoutMode} payout charge is configured for this amount`);
  const rule = mapRow(rows[0]);
  return { rule, charge: rule.flatCharge };
}

export async function createRule(input: CreateInput, auth: AuthenticatedUser, requestId?: string, ipAddress?: string, userAgent?: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await assertNoOverlap(connection, input);
    const id = randomUUID();
    await connection.execute('INSERT INTO payout_charge_rules (id, payout_mode, min_amount, max_amount, flat_charge, created_by, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, input.payoutMode, input.minAmount, input.maxAmount, input.flatCharge, auth.userId, auth.userId]);
    await writeAuditLog({ action: 'PAYOUT_CHARGE_CREATED', resourceType: 'PAYOUT_CHARGE', resourceId: id, afterData: input }, { actorUserId: auth.userId, actorPartyId: auth.partyId, requestId, ipAddress, userAgent }, connection);
    await connection.commit();
    const [rows] = await pool.query<ChargeRow[]>('SELECT * FROM payout_charge_rules WHERE id = ?', [id]);
    return mapRow(rows[0]!);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function updateRule(id: string, input: UpdateInput, auth: AuthenticatedUser, requestId?: string, ipAddress?: string, userAgent?: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [beforeRows] = await connection.query<ChargeRow[]>('SELECT * FROM payout_charge_rules WHERE id = ? AND is_active = TRUE FOR UPDATE', [id]);
    if (!beforeRows[0]) throw new ApiError(404, 'PAYOUT_CHARGE_NOT_FOUND', 'Payout charge rule was not found');
    if (beforeRows[0].version !== input.version) throw new ApiError(409, 'VERSION_CONFLICT', 'Payout charge rule was updated by another user');
    await assertNoOverlap(connection, input, id);
    await connection.execute('UPDATE payout_charge_rules SET payout_mode = ?, min_amount = ?, max_amount = ?, flat_charge = ?, version = version + 1, updated_by = ? WHERE id = ? AND version = ?', [input.payoutMode, input.minAmount, input.maxAmount, input.flatCharge, auth.userId, id, input.version]);
    await writeAuditLog({ action: 'PAYOUT_CHARGE_UPDATED', resourceType: 'PAYOUT_CHARGE', resourceId: id, beforeData: mapRow(beforeRows[0]), afterData: input }, { actorUserId: auth.userId, actorPartyId: auth.partyId, requestId, ipAddress, userAgent }, connection);
    await connection.commit();
    const [rows] = await pool.query<ChargeRow[]>('SELECT * FROM payout_charge_rules WHERE id = ?', [id]);
    return mapRow(rows[0]!);
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}

export async function deleteRule(id: string, auth: AuthenticatedUser, requestId?: string, ipAddress?: string, userAgent?: string) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query<ChargeRow[]>('SELECT * FROM payout_charge_rules WHERE id = ? AND is_active = TRUE FOR UPDATE', [id]);
    if (!rows[0]) throw new ApiError(404, 'PAYOUT_CHARGE_NOT_FOUND', 'Payout charge rule was not found');
    await connection.execute('UPDATE payout_charge_rules SET is_active = FALSE, version = version + 1, updated_by = ? WHERE id = ?', [auth.userId, id]);
    await writeAuditLog({ action: 'PAYOUT_CHARGE_DELETED', resourceType: 'PAYOUT_CHARGE', resourceId: id, beforeData: mapRow(rows[0]) }, { actorUserId: auth.userId, actorPartyId: auth.partyId, requestId, ipAddress, userAgent }, connection);
    await connection.commit();
    return { deleted: true };
  } catch (error) { await connection.rollback(); throw error; } finally { connection.release(); }
}
