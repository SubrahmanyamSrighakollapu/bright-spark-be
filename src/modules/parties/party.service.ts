import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import type { z } from 'zod';
import type { createPartySchema, listPartiesSchema } from './party.schemas.js';

interface PartyRow extends RowDataPacket {
  id: string;
  party_type: string;
  code: string;
  display_name: string;
  legal_name: string | null;
  email: string | null;
  mobile: string | null;
  parent_party_id: string | null;
  parent_name: string | null;
  approval_status: string;
  account_status: string;
  kyc_status: string;
  version: number;
  created_at: Date;
  updated_at: Date;
}

function mapParty(row: PartyRow) {
  return {
    id: row.id,
    partyType: row.party_type,
    code: row.code,
    displayName: row.display_name,
    legalName: row.legal_name,
    email: row.email,
    mobile: row.mobile,
    parentPartyId: row.parent_party_id,
    parentName: row.parent_name,
    approvalStatus: row.approval_status,
    accountStatus: row.account_status,
    kycStatus: row.kyc_status,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const selectParty = `SELECT p.*, parent.display_name AS parent_name FROM parties p LEFT JOIN parties parent ON parent.id = p.parent_party_id`;

export async function listParties(filters: z.infer<typeof listPartiesSchema>) {
  const conditions = ['p.deleted_at IS NULL'];
  const values: unknown[] = [];
  if (filters.type) { conditions.push('p.party_type = ?'); values.push(filters.type); }
  if (filters.parentPartyId) { conditions.push('p.parent_party_id = ?'); values.push(filters.parentPartyId); }
  if (filters.status) { conditions.push('p.account_status = ?'); values.push(filters.status); }
  if (filters.approvalStatus) { conditions.push('p.approval_status = ?'); values.push(filters.approvalStatus); }
  if (filters.search) {
    conditions.push('(p.code LIKE ? OR p.display_name LIKE ? OR p.email LIKE ? OR p.mobile LIKE ?)');
    const search = `%${filters.search}%`;
    values.push(search, search, search, search);
  }
  const where = conditions.join(' AND ');
  const offset = (filters.page - 1) * filters.pageSize;
  const [rows] = await pool.query<PartyRow[]>(`${selectParty} WHERE ${where} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, [...values, filters.pageSize, offset]);
  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) AS total FROM parties p WHERE ${where}`, values);
  const total = Number(countRows[0]?.total ?? 0);
  return { items: rows.map(mapParty), pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) } };
}

export async function getParty(id: string) {
  const [rows] = await pool.query<PartyRow[]>(`${selectParty} WHERE p.id = ? AND p.deleted_at IS NULL LIMIT 1`, [id]);
  if (!rows[0]) throw new ApiError(404, 'PARTY_NOT_FOUND', 'Party was not found');
  return mapParty(rows[0]);
}

function validParentType(type: string, parentType: string): boolean {
  return (type === 'DISTRIBUTOR' && parentType === 'MASTER_DISTRIBUTOR') ||
    (type === 'RETAILER' && parentType === 'DISTRIBUTOR');
}

export async function createParty(input: z.infer<typeof createPartySchema>, actorUserId: string) {
  const id = randomUUID();
  await withTransaction(async (connection) => {
    if (input.parentPartyId) {
      const [parents] = await connection.query<(RowDataPacket & { party_type: string; account_status: string })[]>(
        'SELECT party_type, account_status FROM parties WHERE id = ? AND deleted_at IS NULL FOR UPDATE', [input.parentPartyId],
      );
      const parent = parents[0];
      if (!parent) throw new ApiError(422, 'INVALID_PARENT', 'Parent party was not found');
      if (!validParentType(input.partyType, parent.party_type)) throw new ApiError(422, 'INVALID_HIERARCHY', `${input.partyType} cannot be created below ${parent.party_type}`);
      if (parent.account_status !== 'ACTIVE') throw new ApiError(422, 'PARENT_NOT_ACTIVE', 'Parent party must be active');
    } else if (input.partyType === 'DISTRIBUTOR' || input.partyType === 'RETAILER') {
      throw new ApiError(422, 'PARENT_REQUIRED', `${input.partyType} requires a parent party`);
    }
    await connection.execute(
      `INSERT INTO parties (id, party_type, code, display_name, legal_name, email, mobile, parent_party_id, approval_status, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_APPROVAL', 'PENDING')`,
      [id, input.partyType, input.code, input.displayName, input.legalName ?? null, input.email ?? null, input.mobile ?? null, input.parentPartyId ?? null],
     );
  });
  return getParty(id);
}

export async function updatePartyStatus(id: string, status: string, reason: string, version: number, actorUserId: string) {
  await withTransaction(async (connection) => {
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE parties SET account_status = ?, version = version + 1 WHERE id = ? AND version = ? AND deleted_at IS NULL`,
      [status, id, version],
    );
    if (result.affectedRows !== 1) throw new ApiError(409, 'STALE_PARTY_VERSION', 'Party was updated by another request; reload and retry');
  });
  return getParty(id);
}

export async function reviewParty(id: string, decision: string, reasonCode: string | undefined, remarks: string, version: number, actorUserId: string) {
  await withTransaction(async (connection) => {
    const accountStatus = decision === 'APPROVED' ? 'ACTIVE' : 'INACTIVE';
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE parties SET approval_status = ?, account_status = ?, version = version + 1
       WHERE id = ? AND version = ? AND approval_status = 'PENDING_APPROVAL' AND deleted_at IS NULL`,
      [decision, accountStatus, id, version],
    );
    if (result.affectedRows !== 1) throw new ApiError(409, 'PARTY_NOT_REVIEWABLE', 'Party is stale or is not awaiting approval');
    await connection.execute(
      `INSERT INTO approval_events (id, subject_type, subject_id, action, actor_user_id, reason_code, remarks)
       VALUES (?, 'PARTY', ?, ?, ?, ?, ?)`,
      [randomUUID(), id, decision, actorUserId, reasonCode ?? null, remarks],
    );
  });
  return getParty(id);
}
