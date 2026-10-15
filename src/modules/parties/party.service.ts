import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import { writeAuditLog } from '../../shared/audit.js';
import type { z } from 'zod';
import type { createPartySchema, listPartiesSchema } from './party.schemas.js';
import { dispatchEvent } from '../notifications/notification.service.js';

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
  created_by_user_id: string | null;
  creator_name: string | null;
  creator_role: string | null;
  signup_source: string;
  assigned_by_user_id: string | null;
  assigned_at: Date | null;
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
    createdByUserId: row.created_by_user_id,
    createdByName: row.creator_name,
    createdByRole: row.creator_role,
    signupSource: row.signup_source,
    assignedByUserId: row.assigned_by_user_id,
    assignedAt: row.assigned_at,
  };
}

const selectParty = `SELECT p.*, parent.display_name AS parent_name, creator.full_name AS creator_name,
  (SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = p.created_by_user_id ORDER BY ur.assigned_at LIMIT 1) AS creator_role
  FROM parties p
  LEFT JOIN parties parent ON parent.id = p.parent_party_id
  LEFT JOIN users creator ON creator.id = p.created_by_user_id`;

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

  // Best-effort notifications for party users
  try {
    const [userRows] = await pool.query<(RowDataPacket & { user_id: string })[]>(
      `SELECT id AS user_id FROM users WHERE party_id = ? AND deleted_at IS NULL`,
      [id],
    );
    const userIds = userRows.map((r) => r.user_id);
    if (userIds.length) {
      if (status === 'SUSPENDED' || status === 'INACTIVE' || status === 'CLOSED') {
        void dispatchEvent(
          {
            type: status === 'SUSPENDED' ? 'USER_SUSPENDED' : 'USER_BLOCKED',
            category: 'USER',
            severity: status === 'CLOSED' ? 'CRITICAL' : 'WARNING',
            title: status === 'SUSPENDED' ? 'Your account has been suspended' : 'Your account has been disabled',
            message: `Your Qin Star Pay account (party) status is now ${status}.${reason ? ` Reason: ${reason}` : ''}`,
            entityType: 'PARTY',
            entityId: id,
            metadata: { reason: reason || null, actorUserId, status },
          },
          { kind: 'USER_IDS', userIds },
          actorUserId
        );
      } else if (status === 'ACTIVE') {
        void dispatchEvent(
          {
            type: 'ONBOARDING_COMPLETED',
            category: 'APPROVAL',
            severity: 'SUCCESS',
            title: 'Your party account is active',
            message: `Your Qin Star Pay party account is now ACTIVE. You can begin transacting on the platform.`,
            entityType: 'PARTY',
            entityId: id,
            metadata: { actorUserId, status },
          },
          { kind: 'USER_IDS', userIds },
          actorUserId
        );
      }
    }
  } catch {
    // never propagate
  }

  return getParty(id);
}

export async function reviewParty(id: string, decision: string, reasonCode: string | undefined, remarks: string, version: number, actorUserId: string) {
  await withTransaction(async (connection) => {
    const [parties] = await connection.query<(RowDataPacket & { kyc_status: string; approval_status: string; account_status: string; created_at: Date; signup_source: string; assigned_at: Date | null })[]>(
      `SELECT kyc_status, approval_status, account_status, created_at, signup_source, assigned_at FROM parties WHERE id = ? AND deleted_at IS NULL FOR UPDATE`, [id],
    );
    if (!parties[0]) throw new ApiError(404, 'PARTY_NOT_FOUND', 'Party was not found');
    const party = parties[0];
    if (decision === 'APPROVED' && party.kyc_status !== 'APPROVED') {
      throw new ApiError(409, 'KYC_APPROVAL_REQUIRED', 'Network approval is allowed only after KYC approval');
    }
    if (decision === 'APPROVED' && party.signup_source === 'PUBLIC_SELF_SERVICE' && !party.assigned_at) {
      throw new ApiError(409, 'ADMIN_ASSIGNMENT_REQUIRED', 'Assign this public signup to the platform or a valid network parent before network approval');
    }

    const beforeData = {
      approvalStatus: party.approval_status,
      kycStatus: party.kyc_status,
      accountStatus: party.account_status,
    };

    const accountStatus = decision === 'APPROVED' ? 'ACTIVE' : 'INACTIVE';
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE parties SET approval_status = ?, account_status = ?, version = version + 1
       WHERE id = ? AND version = ? AND approval_status = 'PENDING_APPROVAL' AND deleted_at IS NULL`,
      [decision, accountStatus, id, version],
    );
    if (result.affectedRows !== 1) throw new ApiError(409, 'PARTY_NOT_REVIEWABLE', 'Party is stale or is not awaiting approval');
    await connection.execute(
      `UPDATE users SET status = ?, version = version + 1 WHERE party_id = ? AND deleted_at IS NULL`,
      [decision === 'APPROVED' ? 'ACTIVE' : 'INACTIVE', id],
    );
    await connection.execute(
      `INSERT INTO approval_events (id, subject_type, subject_id, action, actor_user_id, reason_code, remarks)
       VALUES (?, 'PARTY', ?, ?, ?, ?, ?)`,
      [randomUUID(), id, decision, actorUserId, reasonCode ?? null, remarks],
    );

    const afterData = {
      approvalStatus: decision,
      kycStatus: party.kyc_status,
      accountStatus,
    };

    const createdMs = party.created_at ? party.created_at.getTime() : Date.now();
    await writeAuditLog(
      {
        action: decision === 'APPROVED' ? 'KYC_APPROVED' : 'KYC_REJECTED',
        resourceType: 'PARTY',
        resourceId: id,
        actorUserId,
        beforeData,
        afterData,
        metadata: {
          reviewerUserId: actorUserId,
          rejectionReasonCode: reasonCode ?? null,
          remarks: remarks ?? null,
          slaMet: true,
          ttdMs: Date.now() - createdMs,
        },
      },
      { actorUserId },
      connection,
    );
  });

  // Best-effort approval/rejection notification to party users
  try {
    const [userRows] = await pool.query<(RowDataPacket & { user_id: string })[]>(
      `SELECT id AS user_id FROM users WHERE party_id = ? AND deleted_at IS NULL`,
      [id],
    );
    const userIds = userRows.map((r) => r.user_id);
    if (userIds.length) {
      void dispatchEvent(
        {
          type: decision === 'APPROVED' ? 'ONBOARDING_COMPLETED' : 'APPROVAL_COMPLETED',
          category: 'APPROVAL',
          severity: decision === 'APPROVED' ? 'SUCCESS' : 'WARNING',
          title: decision === 'APPROVED' ? '🎉 Onboarding approved — welcome to Qin Star Pay' : 'Onboarding decision updated',
          message: decision === 'APPROVED'
            ? `Your onboarding request has been APPROVED. Your account is ACTIVE.`
            : `Your onboarding request was not approved${remarks ? ` — ${remarks}` : '.'}`,
          entityType: 'PARTY',
          entityId: id,
          metadata: { decision, reasonCode: reasonCode || null, remarks: remarks || null, actorUserId },
        },
        { kind: 'USER_IDS', userIds },
        actorUserId
      );
    }
  } catch {
    // never propagate
  }

  return getParty(id);
}

export async function assignPublicParty(id: string, parentPartyId: string | null, version: number, actorUserId: string) {
  await withTransaction(async connection => {
    const [rows] = await connection.query<(RowDataPacket & { party_type:string; signup_source:string })[]>('SELECT party_type,signup_source FROM parties WHERE id=? AND deleted_at IS NULL FOR UPDATE',[id]);
    const party=rows[0];if(!party)throw new ApiError(404,'PARTY_NOT_FOUND','Party was not found');
    if(party.signup_source!=='PUBLIC_SELF_SERVICE')throw new ApiError(409,'NOT_PUBLIC_SIGNUP','Only public signup applications use this assignment workflow');
    if(parentPartyId){const [parents]=await connection.query<(RowDataPacket & {party_type:string;account_status:string})[]>('SELECT party_type,account_status FROM parties WHERE id=? AND deleted_at IS NULL',[parentPartyId]);const parent=parents[0];if(!parent)throw new ApiError(422,'INVALID_PARENT','Selected parent was not found');if(parent.account_status!=='ACTIVE')throw new ApiError(422,'PARENT_NOT_ACTIVE','Selected parent must be active');if(!validParentType(party.party_type,parent.party_type))throw new ApiError(422,'INVALID_HIERARCHY',`${party.party_type} cannot be assigned below ${parent.party_type}`);}
    if(party.party_type==='MASTER_DISTRIBUTOR'&&parentPartyId)throw new ApiError(422,'INVALID_HIERARCHY','A Master Distributor is assigned directly to the platform');
    const [result]=await connection.execute<ResultSetHeader>('UPDATE parties SET parent_party_id=?,assigned_by_user_id=?,assigned_at=CURRENT_TIMESTAMP(6),version=version+1 WHERE id=? AND version=?',[parentPartyId,actorUserId,id,version]);if(result.affectedRows!==1)throw new ApiError(409,'STALE_PARTY_VERSION','Application was updated by another user; reload and retry');
    await writeAuditLog({action:'PUBLIC_SIGNUP_ASSIGNED',resourceType:'PARTY',resourceId:id,afterData:{parentPartyId,assignedByUserId:actorUserId}},{actorUserId},connection);
  });
  return getParty(id);
}
