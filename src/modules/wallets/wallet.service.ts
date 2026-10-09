import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

interface WalletDetailsRow extends RowDataPacket {
  wallet_id: string;
  party_id: string;
  party_type: string;
  party_name: string;
  party_code: string;
  parent_name: string | null;
  available_balance: number | string;
  ledger_balance: number | string;
  hold_balance: number | string;
  currency: string;
  wallet_status: string;
  updated_at: Date;
}

function entityType(partyType: string) {
  if (partyType === 'MASTER_DISTRIBUTOR') return 'MASTER';
  if (partyType === 'DISTRIBUTOR' || partyType === 'RETAILER') return partyType;
  return 'BACK_OFFICE';
}

function mapWallet(row: WalletDetailsRow) {
  return {
    walletId: row.wallet_id,
    entityId: row.party_id,
    entityType: entityType(row.party_type),
    entityName: row.party_name,
    entityCode: row.party_code,
    parentName: row.parent_name ?? undefined,
    availableBalance: Number(row.available_balance),
    ledgerBalance: Number(row.ledger_balance),
    holdBalance: Number(row.hold_balance),
    pendingSettlement: 0,
    currency: row.currency,
    status: row.wallet_status,
    updatedAt: row.updated_at,
  };
}

export async function getWalletForParty(partyId: string, actor: AuthenticatedUser) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin && actor.partyId !== partyId) {
    throw new ApiError(403, 'WALLET_SCOPE_FORBIDDEN', 'You can only access your own wallet');
  }

  const [rows] = await pool.query<WalletDetailsRow[]>(
    `SELECT w.id AS wallet_id, w.party_id, p.party_type, p.display_name AS party_name,
            p.code AS party_code, parent.display_name AS parent_name,
            w.available_balance, w.ledger_balance, w.hold_balance, w.currency,
            w.status AS wallet_status, w.updated_at
       FROM wallets w
       INNER JOIN parties p ON p.id = w.party_id
       LEFT JOIN parties parent ON parent.id = p.parent_party_id
      WHERE w.party_id = ? AND p.deleted_at IS NULL
      LIMIT 1`,
    [partyId],
  );

  if (!rows[0]) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet was not found for this account');
  return mapWallet(rows[0]);
}

export async function getCurrentWallet(actor: AuthenticatedUser) {
  if (!actor.partyId) throw new ApiError(404, 'WALLET_NOT_LINKED', 'Your account is not linked to a wallet');
  return getWalletForParty(actor.partyId, actor);
}
