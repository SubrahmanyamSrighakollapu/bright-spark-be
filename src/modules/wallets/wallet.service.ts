import { randomUUID } from 'node:crypto';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import { writeAuditLog, contextFromAuth } from '../../shared/audit.js';
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

interface WalletRow extends RowDataPacket {
  id: string;
  party_id: string;
  currency: string;
  status: string;
  available_balance: number | string;
  hold_balance: number | string;
  ledger_balance: number | string;
  version: number;
}

interface LedgerRow extends RowDataPacket {
  id: string;
  wallet_id: string;
  party_id: string;
  entry_type: string;
  amount: number | string;
  available_balance_before: number | string;
  available_balance_after: number | string;
  hold_balance_before: number | string;
  hold_balance_after: number | string;
  reference_type: string;
  reference_id: string | null;
  narration: string;
  created_by_user_id: string;
  created_at: Date;
  creator_name?: string;
}

interface DebitRequestRow extends RowDataPacket {
  id: string;
  wallet_id: string;
  party_id: string;
  amount: number | string;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  requested_by_user_id: string;
  reviewed_by_user_id: string | null;
  rejection_reason: string | null;
  created_at: Date;
  updated_at: Date;
  party_name?: string;
  party_code?: string;
  requester_name?: string;
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

export async function getAllWallets(
  filters: { role?: string | undefined; status?: string | undefined; search?: string | undefined; page?: number | undefined; pageSize?: number | undefined },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Only Admin or Accounts staff can view all system wallets');
  }

  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const whereConditions: string[] = ['p.deleted_at IS NULL'];
  const params: any[] = [];

  if (filters.role && filters.role !== 'ALL') {
    whereConditions.push('p.party_type = ?');
    params.push(filters.role);
  }

  if (filters.status && filters.status !== 'ALL') {
    whereConditions.push('w.status = ?');
    params.push(filters.status);
  }

  if (filters.search) {
    const q = `%${filters.search.trim()}%`;
    whereConditions.push('(p.display_name LIKE ? OR p.code LIKE ? OR parent.display_name LIKE ?)');
    params.push(q, q, q);
  }

  const whereClause = whereConditions.join(' AND ');

  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(w.id) AS total
       FROM wallets w
       INNER JOIN parties p ON p.id = w.party_id
       LEFT JOIN parties parent ON parent.id = p.parent_party_id
      WHERE ${whereClause}`,
    params
  );

  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<WalletDetailsRow[]>(
    `SELECT w.id AS wallet_id, w.party_id, p.party_type, p.display_name AS party_name,
            p.code AS party_code, parent.display_name AS parent_name,
            w.available_balance, w.ledger_balance, w.hold_balance, w.currency,
            w.status AS wallet_status, w.updated_at
       FROM wallets w
       INNER JOIN parties p ON p.id = w.party_id
       LEFT JOIN parties parent ON parent.id = p.parent_party_id
      WHERE ${whereClause}
      ORDER BY w.updated_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    items: rows.map(mapWallet),
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
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
      WHERE (w.party_id = ? OR p.code = ?) AND p.deleted_at IS NULL
      LIMIT 1`,
    [partyId, partyId]
  );

  if (!rows[0]) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet was not found for this account');
  return mapWallet(rows[0]);
}

export async function getCurrentWallet(actor: AuthenticatedUser) {
  if (!actor.partyId) throw new ApiError(404, 'WALLET_NOT_LINKED', 'Your account is not linked to a wallet');
  return getWalletForParty(actor.partyId, actor);
}

/**
 * Manual Credit Wallet (Top-up)
 */
export async function creditWallet(
  partyId: string,
  input: { amount: number; referenceType?: string | undefined; referenceId?: string | undefined; narration: string },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Only Admin or Accounts staff can credit wallet balances');
  }

  if (input.amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Credit amount must be greater than zero');
  }

  return withTransaction(async (connection) => {
    // 1. Lock wallet FOR UPDATE
    const [wallets] = await connection.query<WalletRow[]>(
      `SELECT w.id, w.party_id, w.currency, w.status, w.available_balance, w.hold_balance, w.ledger_balance, w.version
         FROM wallets w
         INNER JOIN parties p ON p.id = w.party_id
        WHERE (w.party_id = ? OR p.code = ?) AND p.deleted_at IS NULL FOR UPDATE`,
      [partyId, partyId]
    );

    const wallet = wallets[0];
    if (!wallet) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found for party');
    if (wallet.status === 'FROZEN') {
      throw new ApiError(400, 'WALLET_FROZEN', 'Cannot credit frozen wallet account');
    }

    const availBefore = Number(wallet.available_balance);
    const holdBefore = Number(wallet.hold_balance);
    const ledgerBefore = Number(wallet.ledger_balance);
    const availAfter = availBefore + input.amount;
    const ledgerAfter = availAfter + holdBefore;

    const beforeData = {
      availableBalance: availBefore,
      ledgerBalance: ledgerBefore,
      holdBalance: holdBefore,
    };

    // 2. Update balances
    await connection.execute(
      `UPDATE wallets
          SET available_balance = ?, ledger_balance = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6)
        WHERE id = ?`,
      [availAfter, ledgerAfter, wallet.id]
    );

    // 3. Record immutable ledger entry
    const ledgerId = randomUUID();
    await connection.execute(
      `INSERT INTO ledger_entries
       (id, wallet_id, party_id, entry_type, amount, available_balance_before, available_balance_after,
        hold_balance_before, hold_balance_after, reference_type, reference_id, narration, created_by_user_id)
       VALUES (?, ?, ?, 'CREDIT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ledgerId,
        wallet.id,
        wallet.party_id,
        input.amount,
        availBefore,
        availAfter,
        holdBefore,
        holdBefore,
        input.referenceType || 'MANUAL_CREDIT',
        input.referenceId || null,
        input.narration.trim(),
        actor.userId,
      ]
    );

    const afterData = {
      availableBalance: availAfter,
      ledgerBalance: ledgerAfter,
      holdBalance: holdBefore,
    };

    await writeAuditLog(
      {
        action: 'WALLET_CREDIT',
        resourceType: 'WALLET',
        resourceId: wallet.id,
        beforeData,
        afterData,
        metadata: {
          amount: input.amount,
          type: input.referenceType || 'MANUAL_TOPUP',
          txnRef: input.referenceId ?? null,
          remarks: input.narration.trim(),
          operatorUserId: actor.userId,
        },
      },
      contextFromAuth(actor),
      connection,
    );

    return {
      walletId: wallet.id,
      partyId: wallet.party_id,
      previousBalance: availBefore,
      newAvailableBalance: availAfter,
      newLedgerBalance: ledgerAfter,
      amountCredited: input.amount,
      ledgerEntryId: ledgerId,
    };
  });
}

/**
 * Manual Debit Wallet
 */
export async function debitWallet(
  partyId: string,
  input: { amount: number; referenceType?: string | undefined; referenceId?: string | undefined; narration: string },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Only Admin or Accounts staff can debit wallet balances');
  }

  if (input.amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Debit amount must be greater than zero');
  }

  return withTransaction(async (connection) => {
    // 1. Lock wallet FOR UPDATE
    const [wallets] = await connection.query<WalletRow[]>(
      `SELECT w.id, w.party_id, w.currency, w.status, w.available_balance, w.hold_balance, w.ledger_balance, w.version
         FROM wallets w
         INNER JOIN parties p ON p.id = w.party_id
        WHERE (w.party_id = ? OR p.code = ?) AND p.deleted_at IS NULL FOR UPDATE`,
      [partyId, partyId]
    );

    const wallet = wallets[0];
    if (!wallet) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found for party');
    if (wallet.status === 'FROZEN') {
      throw new ApiError(400, 'WALLET_FROZEN', 'Cannot debit frozen wallet account');
    }

    const availBefore = Number(wallet.available_balance);
    const holdBefore = Number(wallet.hold_balance);
    const ledgerBefore = Number(wallet.ledger_balance);

    if (availBefore < input.amount) {
      throw new ApiError(400, 'INSUFFICIENT_FUNDS', `Insufficient available balance (₹${availBefore.toFixed(2)}) for debit of ₹${input.amount}`);
    }

    const availAfter = availBefore - input.amount;
    const ledgerAfter = availAfter + holdBefore;

    const beforeData = {
      availableBalance: availBefore,
      ledgerBalance: ledgerBefore,
      holdBalance: holdBefore,
    };

    // 2. Update balances
    await connection.execute(
      `UPDATE wallets
          SET available_balance = ?, ledger_balance = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6)
        WHERE id = ?`,
      [availAfter, ledgerAfter, wallet.id]
    );

    // 3. Record ledger entry
    const ledgerId = randomUUID();
    await connection.execute(
      `INSERT INTO ledger_entries
       (id, wallet_id, party_id, entry_type, amount, available_balance_before, available_balance_after,
        hold_balance_before, hold_balance_after, reference_type, reference_id, narration, created_by_user_id)
       VALUES (?, ?, ?, 'DEBIT', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ledgerId,
        wallet.id,
        wallet.party_id,
        input.amount,
        availBefore,
        availAfter,
        holdBefore,
        holdBefore,
        input.referenceType || 'MANUAL_DEBIT',
        input.referenceId || null,
        input.narration.trim(),
        actor.userId,
      ]
    );

    const afterData = {
      availableBalance: availAfter,
      ledgerBalance: ledgerAfter,
      holdBalance: holdBefore,
    };

    await writeAuditLog(
      {
        action: 'WALLET_DEBIT',
        resourceType: 'WALLET',
        resourceId: wallet.id,
        beforeData,
        afterData,
        metadata: {
          amount: input.amount,
          type: input.referenceType || 'PAYOUT',
          txnRef: input.referenceId ?? null,
          remarks: input.narration.trim(),
          operatorUserId: actor.userId,
        },
      },
      contextFromAuth(actor),
      connection,
    );

    return {
      walletId: wallet.id,
      partyId: wallet.party_id,
      previousBalance: availBefore,
      newAvailableBalance: availAfter,
      newLedgerBalance: ledgerAfter,
      amountDebited: input.amount,
      ledgerEntryId: ledgerId,
    };
  });
}

/**
 * Hold or Release Funds
 */
export async function holdFunds(
  partyId: string,
  input: { mode: 'HOLD' | 'RELEASE'; amount: number; reason: string },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Only Admin or Accounts staff can manage fund holds');
  }

  if (input.amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Amount must be greater than zero');
  }

  return withTransaction(async (connection) => {
    const [wallets] = await connection.query<WalletRow[]>(
      `SELECT w.id, w.party_id, w.currency, w.status, w.available_balance, w.hold_balance, w.ledger_balance
         FROM wallets w
         INNER JOIN parties p ON p.id = w.party_id
        WHERE (w.party_id = ? OR p.code = ?) AND p.deleted_at IS NULL FOR UPDATE`,
      [partyId, partyId]
    );

    const wallet = wallets[0];
    if (!wallet) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found for party');

    const availBefore = Number(wallet.available_balance);
    const holdBefore = Number(wallet.hold_balance);
    const ledgerBefore = Number(wallet.ledger_balance);

    let availAfter = availBefore;
    let holdAfter = holdBefore;

    if (input.mode === 'HOLD') {
      if (availBefore < input.amount) {
        throw new ApiError(400, 'INSUFFICIENT_AVAILABLE_FUNDS', `Cannot hold ₹${input.amount}. Available balance is only ₹${availBefore.toFixed(2)}.`);
      }
      availAfter = availBefore - input.amount;
      holdAfter = holdBefore + input.amount;
    } else {
      if (holdBefore < input.amount) {
        throw new ApiError(400, 'INSUFFICIENT_HOLD_FUNDS', `Cannot release ₹${input.amount}. Current hold balance is only ₹${holdBefore.toFixed(2)}.`);
      }
      availAfter = availBefore + input.amount;
      holdAfter = holdBefore - input.amount;
    }

    const ledgerBalance = availAfter + holdAfter;

    const beforeData = {
      availableBalance: availBefore,
      ledgerBalance: ledgerBefore,
      holdBalance: holdBefore,
    };

    await connection.execute(
      `UPDATE wallets
          SET available_balance = ?, hold_balance = ?, ledger_balance = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6)
        WHERE id = ?`,
      [availAfter, holdAfter, ledgerBalance, wallet.id]
    );

    const ledgerId = randomUUID();
    await connection.execute(
      `INSERT INTO ledger_entries
       (id, wallet_id, party_id, entry_type, amount, available_balance_before, available_balance_after,
        hold_balance_before, hold_balance_after, reference_type, reference_id, narration, created_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ledgerId,
        wallet.id,
        wallet.party_id,
        input.mode === 'HOLD' ? 'HOLD' : 'RELEASE',
        input.amount,
        availBefore,
        availAfter,
        holdBefore,
        holdAfter,
        input.mode === 'HOLD' ? 'HOLD_FUNDS' : 'RELEASE_FUNDS',
        null,
        input.reason.trim(),
        actor.userId,
      ]
    );

    const afterData = {
      availableBalance: availAfter,
      ledgerBalance,
      holdBalance: holdAfter,
    };

    await writeAuditLog(
      {
        action: input.mode === 'HOLD' ? 'WALLET_HOLD_APPLIED' : 'WALLET_HOLD_RELEASED',
        resourceType: 'WALLET',
        resourceId: wallet.id,
        beforeData,
        afterData,
        metadata: {
          amount: input.amount,
          type: input.mode,
          txnRef: null,
          remarks: input.reason.trim(),
          operatorUserId: actor.userId,
        },
      },
      contextFromAuth(actor),
      connection,
    );

    return {
      walletId: wallet.id,
      partyId: wallet.party_id,
      availableBalance: availAfter,
      holdBalance: holdAfter,
      ledgerBalance,
      mode: input.mode,
      amount: input.amount,
      ledgerEntryId: ledgerId,
    };
  });
}

/**
 * Freeze or Unfreeze Wallet Status
 */
export async function toggleWalletStatus(
  partyId: string,
  input: { status: 'ACTIVE' | 'FROZEN'; reason: string },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Only Admin can update wallet status');
  }

  const [wallets] = await pool.query<WalletRow[]>(
    `SELECT w.id, w.party_id, w.status
       FROM wallets w
       INNER JOIN parties p ON p.id = w.party_id
      WHERE (w.party_id = ? OR p.code = ?) AND p.deleted_at IS NULL LIMIT 1`,
    [partyId, partyId]
  );

  const wallet = wallets[0];
  if (!wallet) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found');

  await pool.execute('UPDATE wallets SET status = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [
    input.status,
    wallet.id,
  ]);

  return {
    walletId: wallet.id,
    partyId: wallet.party_id,
    status: input.status,
    reason: input.reason,
  };
}

/**
 * Get Paginated Ledger Entries
 */
export async function getLedgerForParty(
  partyId: string,
  filters: { type?: string | undefined; page?: number | undefined; pageSize?: number | undefined; fromDate?: string | undefined; toDate?: string | undefined },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin && actor.partyId !== partyId) {
    throw new ApiError(403, 'ACCESS_DENIED', 'You can only access your own ledger history');
  }

  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const whereConditions: string[] = [];
  const params: any[] = [];

  if (partyId && partyId !== 'admin' && partyId !== 'ALL') {
    whereConditions.push('(l.party_id = ? OR p.code = ?)');
    params.push(partyId, partyId);
  }

  if (filters.type && filters.type !== 'ALL') {
    whereConditions.push('l.entry_type = ?');
    params.push(filters.type);
  }

  if (filters.fromDate) {
    whereConditions.push('l.created_at >= ?');
    params.push(`${filters.fromDate} 00:00:00`);
  }

  if (filters.toDate) {
    whereConditions.push('l.created_at <= ?');
    params.push(`${filters.toDate} 23:59:59`);
  }

  const whereClause = whereConditions.length > 0 ? whereConditions.join(' AND ') : '1=1';

  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(l.id) AS total
       FROM ledger_entries l
       INNER JOIN parties p ON p.id = l.party_id
      WHERE ${whereClause}`,
    params
  );

  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT l.id, l.wallet_id, l.party_id, l.entry_type, l.amount,
            l.available_balance_before, l.available_balance_after,
            l.hold_balance_before, l.hold_balance_after,
            l.reference_type, l.reference_id, l.narration, l.created_by_user_id, l.created_at,
            creator.full_name AS creator_name,
            p.display_name AS party_name, p.code AS party_code
       FROM ledger_entries l
       INNER JOIN parties p ON p.id = l.party_id
       LEFT JOIN users creator ON creator.id = l.created_by_user_id
      WHERE ${whereClause}
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    items: rows.map((r: any) => ({
      id: r.id,
      walletId: r.wallet_id,
      partyId: r.party_id,
      partyName: r.party_name,
      partyCode: r.party_code,
      type: r.entry_type,
      amount: Number(r.amount),
      availableBalanceBefore: Number(r.available_balance_before),
      availableBalanceAfter: Number(r.available_balance_after),
      holdBalanceBefore: Number(r.hold_balance_before),
      holdBalanceAfter: Number(r.hold_balance_after),
      referenceType: r.reference_type,
      referenceId: r.reference_id,
      narration: r.narration,
      createdBy: r.creator_name || 'System',
      createdAt: r.created_at,
    })),
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

/**
 * Wallet Debit Requests Queue (Create, List, Review)
 */
export async function createDebitRequest(
  partyId: string,
  input: { amount: number; reason: string },
  actor: AuthenticatedUser
) {
  if (input.amount <= 0) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Debit request amount must be greater than zero');
  }

  const [wallets] = await pool.query<WalletRow[]>(
    `SELECT w.id, w.available_balance FROM wallets w INNER JOIN parties p ON p.id = w.party_id WHERE (w.party_id = ? OR p.code = ?) AND p.deleted_at IS NULL LIMIT 1`,
    [partyId, partyId]
  );

  const wallet = wallets[0];
  if (!wallet) throw new ApiError(404, 'WALLET_NOT_FOUND', 'Wallet not found');

  const id = randomUUID();
  await pool.execute(
    `INSERT INTO wallet_debit_requests (id, wallet_id, party_id, amount, reason, requested_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, wallet.id, wallet.party_id, input.amount, input.reason.trim(), actor.userId]
  );

  return { id, walletId: wallet.id, partyId: wallet.party_id, amount: input.amount, status: 'PENDING' };
}

export async function getDebitRequests(
  filters: { status?: string | undefined; page?: number | undefined; pageSize?: number | undefined },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 20));
  const offset = (page - 1) * pageSize;

  const whereConditions: string[] = [];
  const params: any[] = [];

  if (!isAdmin) {
    if (!actor.partyId) throw new ApiError(403, 'ACCESS_DENIED', 'No party linked');
    whereConditions.push('dr.party_id = ?');
    params.push(actor.partyId);
  }

  if (filters.status && filters.status !== 'ALL') {
    whereConditions.push('dr.status = ?');
    params.push(filters.status);
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(dr.id) AS total FROM wallet_debit_requests dr ${whereClause}`,
    params
  );

  const total = Number(countRows[0]?.total ?? 0);

  const [rows] = await pool.query<DebitRequestRow[]>(
    `SELECT dr.id, dr.wallet_id, dr.party_id, dr.amount, dr.reason, dr.status, dr.requested_by_user_id,
            dr.reviewed_by_user_id, dr.rejection_reason, dr.created_at, dr.updated_at,
            p.display_name AS party_name, p.code AS party_code, req.full_name AS requester_name
       FROM wallet_debit_requests dr
       INNER JOIN parties p ON p.id = dr.party_id
       LEFT JOIN users req ON req.id = dr.requested_by_user_id
      ${whereClause}
      ORDER BY dr.created_at DESC
      LIMIT ? OFFSET ?`,
    [...params, pageSize, offset]
  );

  return {
    items: rows.map((r) => ({
      id: r.id,
      walletId: r.wallet_id,
      partyId: r.party_id,
      partyName: r.party_name,
      partyCode: r.party_code,
      amount: Number(r.amount),
      reason: r.reason,
      status: r.status,
      requesterName: r.requester_name || 'Staff User',
      rejectionReason: r.rejection_reason,
      createdAt: r.created_at,
    })),
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize) || 1,
    },
  };
}

export async function reviewDebitRequest(
  id: string,
  input: { action: 'APPROVE' | 'REJECT'; rejectionReason?: string | undefined },
  actor: AuthenticatedUser
) {
  const isAdmin = actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
  if (!isAdmin) {
    throw new ApiError(403, 'ACCESS_DENIED', 'Only Admin or Accounts staff can review debit requests');
  }

  const [requests] = await pool.query<DebitRequestRow[]>(
    'SELECT * FROM wallet_debit_requests WHERE id = ? FOR UPDATE',
    [id]
  );

  const request = requests[0];
  if (!request) throw new ApiError(404, 'REQUEST_NOT_FOUND', 'Debit request not found');
  if (request.status !== 'PENDING') {
    throw new ApiError(400, 'ALREADY_PROCESSED', `Debit request is already ${request.status}`);
  }

  if (input.action === 'REJECT') {
    await pool.execute(
      `UPDATE wallet_debit_requests SET status = 'REJECTED', reviewed_by_user_id = ?, rejection_reason = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
      [actor.userId, input.rejectionReason || 'Rejected by Admin', id]
    );
    return { id, status: 'REJECTED' };
  }

  // Action APPROVE -> Execute debit via transaction
  const debitRes = await debitWallet(
    request.party_id,
    { amount: Number(request.amount), referenceType: 'DEBIT_REQUEST', referenceId: id, narration: `Approved Debit Request: ${request.reason}` },
    actor
  );

  await pool.execute(
    `UPDATE wallet_debit_requests SET status = 'APPROVED', reviewed_by_user_id = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?`,
    [actor.userId, id]
  );

  return { id, status: 'APPROVED', debitResult: debitRes };
}
