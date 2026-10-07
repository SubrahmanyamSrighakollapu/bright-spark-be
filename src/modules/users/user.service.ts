import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import type { z } from 'zod';
import type {
  createUserSchema,
  listUsersSchema,
  walletCreditDebitSchema,
  walletHoldSchema,
} from './user.schemas.js';

interface UserRow extends RowDataPacket {
  user_id: string;
  email: string;
  mobile: string;
  full_name: string;
  user_status: string;
  user_version: number;
  user_created_at: Date;
  party_id: string;
  party_type: string;
  party_code: string;
  party_display_name: string;
  party_legal_name: string | null;
  party_approval_status: string;
  party_account_status: string;
  party_kyc_status: string;
  parent_party_id: string | null;
  parent_name: string | null;
  parent_code: string | null;
  role_code: string | null;
  role_name: string | null;
  wallet_id: string | null;
  available_balance: number | string | null;
  hold_balance: number | string | null;
  ledger_balance: number | string | null;
}

interface WalletRow extends RowDataPacket {
  id: string;
  available_balance: number | string;
  ledger_balance: number | string;
  hold_balance: number | string;
}

function mapUser(row: UserRow) {
  const roleCode = row.role_code || row.party_type;
  return {
    id: row.user_id,
    userId: row.party_code || row.user_id,
    partyId: row.party_id,
    code: row.party_code,
    fullName: row.full_name,
    name: row.full_name,
    email: row.email,
    mobile: row.mobile,
    contactNo: row.mobile,
    displayName: row.party_display_name,
    businessName: row.party_display_name,
    legalName: row.party_legal_name,
    role: roleCode,
    roleName: roleCode,
    parentId: row.parent_party_id,
    parentName: row.parent_name,
    parentCode: row.parent_code,
    status: row.user_status,
    accountStatus: row.party_account_status,
    approvalStatus: row.party_approval_status,
    kycStatus: row.party_kyc_status,
    isAadharVerify: row.party_kyc_status === 'APPROVED',
    panNoVerify: row.party_kyc_status === 'APPROVED',
    walletId: row.wallet_id,
    availableBalance: Number(row.available_balance ?? 0),
    holdBalance: Number(row.hold_balance ?? 0),
    ledgerBalance: Number(row.ledger_balance ?? 0),
    version: row.user_version,
    createdAt: row.user_created_at,
  };
}

const baseUserSelect = `
SELECT
  u.id AS user_id,
  u.email,
  u.mobile,
  u.full_name,
  u.status AS user_status,
  u.version AS user_version,
  u.created_at AS user_created_at,
  p.id AS party_id,
  p.party_type,
  p.code AS party_code,
  p.display_name AS party_display_name,
  p.legal_name AS party_legal_name,
  p.approval_status AS party_approval_status,
  p.account_status AS party_account_status,
  p.kyc_status AS party_kyc_status,
  p.parent_party_id,
  parent.display_name AS parent_name,
  parent.code AS parent_code,
  r.code AS role_code,
  r.name AS role_name,
  w.id AS wallet_id,
  COALESCE(w.available_balance, 0) AS available_balance,
  COALESCE(w.hold_balance, 0) AS hold_balance,
  COALESCE(w.ledger_balance, 0) AS ledger_balance
FROM users u
INNER JOIN parties p ON p.id = u.party_id
LEFT JOIN parties parent ON parent.id = p.parent_party_id
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
LEFT JOIN wallets w ON w.party_id = p.id
`;

export async function listUsers(filters: z.infer<typeof listUsersSchema>) {
  const conditions: string[] = ['u.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  const values: unknown[] = [];

  const roleFilter = filters.role || filters.type;
  if (roleFilter && roleFilter !== 'ALL') {
    conditions.push('(r.code = ? OR p.party_type = ?)');
    values.push(roleFilter, roleFilter);
  }

  if (filters.status && filters.status !== 'ALL') {
    conditions.push('(u.status = ? OR p.account_status = ?)');
    values.push(filters.status, filters.status);
  }

  if (filters.approvalStatus && filters.approvalStatus !== 'ALL') {
    conditions.push('p.approval_status = ?');
    values.push(filters.approvalStatus);
  }

  const parentId = filters.parentPartyId || filters.distributorId;
  if (parentId && parentId !== 'ALL') {
    conditions.push('(p.parent_party_id = ? OR parent.code = ?)');
    values.push(parentId, parentId);
  }

  const search = filters.search || filters.searchQuery;
  if (search && search.trim() !== '') {
    conditions.push(
      '(u.full_name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR p.code LIKE ? OR p.display_name LIKE ?)'
    );
    const searchPattern = `%${search.trim()}%`;
    values.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
  }

  const whereClause = conditions.join(' AND ');
  const offset = (filters.page - 1) * filters.pageSize;

  const [rows] = await pool.query<UserRow[]>(
    `${baseUserSelect} WHERE ${whereClause} ORDER BY u.created_at DESC LIMIT ? OFFSET ?`,
    [...values, filters.pageSize, offset]
  );

  const [countRows] = await pool.query<(RowDataPacket & { total: number })[]>(
    `SELECT COUNT(DISTINCT u.id) AS total FROM users u
     INNER JOIN parties p ON p.id = u.party_id
     LEFT JOIN parties parent ON parent.id = p.parent_party_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE ${whereClause}`,
    values
  );

  const total = Number(countRows[0]?.total ?? 0);
  const items = rows.map(mapUser);

  return {
    items,
    pagination: {
      page: filters.page,
      pageSize: filters.pageSize,
      totalItems: total,
      total,
      totalPages: Math.ceil(total / filters.pageSize) || 1,
    },
  };
}

export async function getUserById(id: string) {
  const [rows] = await pool.query<UserRow[]>(
    `${baseUserSelect} WHERE (u.id = ? OR p.id = ? OR p.code = ?) AND u.deleted_at IS NULL LIMIT 1`,
    [id, id, id]
  );

  if (!rows[0]) {
    throw new ApiError(404, 'USER_NOT_FOUND', `User with ID ${id} was not found`);
  }

  return mapUser(rows[0]);
}

function generatePartyCode(role: string): string {
  const prefix = role === 'MASTER_DISTRIBUTOR' ? 'MD' : role === 'DISTRIBUTOR' ? 'DST' : 'RET';
  const randomNum = Math.floor(100 + Math.random() * 900);
  return `${prefix}${randomNum}`;
}

export async function createUser(input: z.infer<typeof createUserSchema>, actorUserId: string) {
  const userId = randomUUID();
  const partyId = randomUUID();
  const walletId = randomUUID();
  const partyCode = generatePartyCode(input.role);

  await withTransaction(async (connection) => {
    // Parent hierarchy validation
    if (input.parentPartyId) {
      const [parents] = await connection.query<
        (RowDataPacket & { id: string; party_type: string; account_status: string })[]
      >('SELECT id, party_type, account_status FROM parties WHERE (id = ? OR code = ?) AND deleted_at IS NULL FOR UPDATE', [
        input.parentPartyId,
        input.parentPartyId,
      ]);
      const parent = parents[0];
      if (!parent) throw new ApiError(422, 'INVALID_PARENT', 'Parent party was not found');
      if (
        (input.role === 'DISTRIBUTOR' && parent.party_type !== 'MASTER_DISTRIBUTOR') ||
        (input.role === 'RETAILER' && parent.party_type !== 'DISTRIBUTOR')
      ) {
        throw new ApiError(
          422,
          'INVALID_HIERARCHY',
          `${input.role} cannot be created under parent type ${parent.party_type}`
        );
      }
      if (parent.account_status !== 'ACTIVE') {
        throw new ApiError(422, 'PARENT_NOT_ACTIVE', 'Parent party must be active');
      }
    } else if (input.role === 'DISTRIBUTOR' || input.role === 'RETAILER') {
      throw new ApiError(422, 'PARENT_REQUIRED', `${input.role} requires an assigned parent party`);
    }

    // Check duplicate email or mobile
    const [existing] = await connection.query<(RowDataPacket & { id: string })[]>(
      'SELECT id FROM users WHERE (email = ? OR mobile = ?) AND deleted_at IS NULL LIMIT 1',
      [input.email, input.mobile]
    );
    if (existing.length > 0) {
      throw new ApiError(409, 'USER_EXISTS', 'User with this email or mobile already exists');
    }

    // Lookup role record
    const [roleRows] = await connection.query<(RowDataPacket & { id: number })[]>(
      'SELECT id FROM roles WHERE code = ? LIMIT 1',
      [input.role]
    );
    const roleId = roleRows[0]?.id;

    // Create party
    await connection.execute(
      `INSERT INTO parties (id, party_type, code, display_name, legal_name, email, mobile, parent_party_id, approval_status, account_status, kyc_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 'ACTIVE', 'NOT_STARTED')`,
      [
        partyId,
        input.role,
        partyCode,
        input.displayName,
        input.legalName ?? input.displayName,
        input.email,
        input.mobile,
        input.parentPartyId ?? null,
      ]
    );

    // Hash password
    const passwordHash = await bcrypt.hash(input.password || 'Demo@123456', 12);

    // Create user
    await connection.execute(
      `INSERT INTO users (id, party_id, email, mobile, full_name, password_hash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')`,
      [userId, partyId, input.email, input.mobile, input.fullName, passwordHash]
    );

    // Create user role mapping if role found
    if (roleId) {
      await connection.execute(
        `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
        [userId, roleId, actorUserId]
      );
    }

    // Create wallet
    await connection.execute(
      `INSERT INTO wallets (id, party_id, currency, status, available_balance, hold_balance, ledger_balance)
       VALUES (?, ?, 'INR', 'ACTIVE', 0.0000, 0.0000, 0.0000)`,
      [walletId, partyId]
    );
  });

  return getUserById(userId);
}

export async function updateUserStatus(
  id: string,
  status: 'ACTIVE' | 'PENDING' | 'SUSPENDED' | 'INACTIVE' | 'DISABLED' | 'BLOCKED',
  reason?: string,
  actorUserId?: string
) {
  const user = await getUserById(id);
  const mappedStatus = status === 'BLOCKED' ? 'SUSPENDED' : status;

  await withTransaction(async (connection) => {
    await connection.execute(`UPDATE users SET status = ?, version = version + 1 WHERE id = ?`, [
      mappedStatus,
      user.id,
    ]);

    const partyAccountStatus =
      mappedStatus === 'ACTIVE'
        ? 'ACTIVE'
        : mappedStatus === 'SUSPENDED'
        ? 'SUSPENDED'
        : mappedStatus === 'PENDING'
        ? 'PENDING'
        : 'INACTIVE';

    await connection.execute(
      `UPDATE parties SET account_status = ?, version = version + 1 WHERE id = ?`,
      [partyAccountStatus, user.partyId]
    );
  });

  return getUserById(user.id);
}

export async function creditWallet(
  id: string,
  input: z.infer<typeof walletCreditDebitSchema>,
  actorUserId: string
) {
  const user = await getUserById(id);
  const amount = input.amount;
  const remarks = input.remarks || input.reason || 'Manual Wallet Credit Top-up';

  let updatedWallet: { availableBalance: number; ledgerBalance: number; holdBalance: number } = {
    availableBalance: 0,
    ledgerBalance: 0,
    holdBalance: 0,
  };

  await withTransaction(async (connection) => {
    const [wallets] = await connection.query<WalletRow[]>(
      'SELECT * FROM wallets WHERE party_id = ? FOR UPDATE',
      [user.partyId]
    );

    let walletId = wallets[0]?.id;
    let currentAvailable = Number(wallets[0]?.available_balance ?? 0);
    let currentLedger = Number(wallets[0]?.ledger_balance ?? 0);
    let currentHold = Number(wallets[0]?.hold_balance ?? 0);

    if (!walletId) {
      walletId = randomUUID();
      await connection.execute(
        `INSERT INTO wallets (id, party_id, currency, status, available_balance, hold_balance, ledger_balance)
         VALUES (?, ?, 'INR', 'ACTIVE', 0, 0, 0)`,
        [walletId, user.partyId]
      );
      currentAvailable = 0;
      currentLedger = 0;
      currentHold = 0;
    }

    const newAvailable = currentAvailable + amount;
    const newLedger = currentLedger + amount;

    await connection.execute(
      `UPDATE wallets SET available_balance = ?, ledger_balance = ?, version = version + 1 WHERE id = ?`,
      [newAvailable, newLedger, walletId]
    );

    const txnId = randomUUID();
    const internalRef = `WLT${Date.now().toString().slice(-8)}`;
    const idempotencyKey = `CREDIT_${txnId}`;

    await connection.execute(
      `INSERT INTO transactions (id, internal_reference, idempotency_key, party_id, transaction_type, payment_mode, gross_amount, status, calculation_snapshot)
       VALUES (?, ?, ?, ?, 'PAY_IN', 'WALLET_TOPUP', ?, 'SUCCESS', ?)`,
      [
        txnId,
        internalRef,
        idempotencyKey,
        user.partyId,
        amount,
        JSON.stringify({ amount, remarks, actorUserId, referenceNumber: input.referenceNumber }),
      ]
    );

    updatedWallet = {
      availableBalance: newAvailable,
      ledgerBalance: newLedger,
      holdBalance: currentHold,
    };
  });

  return {
    user,
    transaction: {
      transId: `WLT${Date.now().toString().slice(-8)}`,
      type: 'CREDIT',
      amount,
      remarks,
      status: 'SUCCESS',
      wallet: updatedWallet,
    },
  };
}

export async function debitWallet(
  id: string,
  input: z.infer<typeof walletCreditDebitSchema>,
  actorUserId: string
) {
  const user = await getUserById(id);
  const amount = input.amount;
  const remarks = input.remarks || input.reason || 'Manual Wallet Debit Adjustment';

  let updatedWallet: { availableBalance: number; ledgerBalance: number; holdBalance: number } = {
    availableBalance: 0,
    ledgerBalance: 0,
    holdBalance: 0,
  };

  await withTransaction(async (connection) => {
    const [wallets] = await connection.query<WalletRow[]>(
      'SELECT * FROM wallets WHERE party_id = ? FOR UPDATE',
      [user.partyId]
    );

    const wallet = wallets[0];
    if (!wallet) {
      throw new ApiError(400, 'WALLET_NOT_FOUND', 'User wallet record was not found');
    }

    const currentAvailable = Number(wallet.available_balance ?? 0);
    const currentLedger = Number(wallet.ledger_balance ?? 0);
    const currentHold = Number(wallet.hold_balance ?? 0);

    if (currentAvailable < amount) {
      throw new ApiError(
        400,
        'INSUFFICIENT_FUNDS',
        `Insufficient wallet available balance (Current: ₹${currentAvailable.toFixed(2)}, Requested Debit: ₹${amount.toFixed(2)})`
      );
    }

    const newAvailable = currentAvailable - amount;
    const newLedger = currentLedger - amount;

    await connection.execute(
      `UPDATE wallets SET available_balance = ?, ledger_balance = ?, version = version + 1 WHERE id = ?`,
      [newAvailable, newLedger, wallet.id]
    );

    const txnId = randomUUID();
    const internalRef = `WLT${Date.now().toString().slice(-8)}`;
    const idempotencyKey = `DEBIT_${txnId}`;

    await connection.execute(
      `INSERT INTO transactions (id, internal_reference, idempotency_key, party_id, transaction_type, payment_mode, gross_amount, status, calculation_snapshot)
       VALUES (?, ?, ?, ?, 'PAY_OUT', 'ADMIN_DEBIT', ?, 'SUCCESS', ?)`,
      [
        txnId,
        internalRef,
        idempotencyKey,
        user.partyId,
        amount,
        JSON.stringify({ amount, remarks, actorUserId, referenceNumber: input.referenceNumber }),
      ]
    );

    updatedWallet = {
      availableBalance: newAvailable,
      ledgerBalance: newLedger,
      holdBalance: currentHold,
    };
  });

  return {
    user,
    transaction: {
      transId: `WLT${Date.now().toString().slice(-8)}`,
      type: 'DEBIT',
      amount,
      remarks,
      status: 'SUCCESS',
      wallet: updatedWallet,
    },
  };
}

export async function holdWalletFunds(
  id: string,
  input: z.infer<typeof walletHoldSchema>,
  actorUserId: string
) {
  const user = await getUserById(id);
  const amount = input.amount;
  const action = input.action;
  const remarks = input.remarks || input.reason || `Security fund ${action.toLowerCase()}`;

  let updatedWallet: { availableBalance: number; ledgerBalance: number; holdBalance: number } = {
    availableBalance: 0,
    ledgerBalance: 0,
    holdBalance: 0,
  };

  await withTransaction(async (connection) => {
    const [wallets] = await connection.query<WalletRow[]>(
      'SELECT * FROM wallets WHERE party_id = ? FOR UPDATE',
      [user.partyId]
    );

    let walletId = wallets[0]?.id;
    let currentAvailable = Number(wallets[0]?.available_balance ?? 0);
    let currentHold = Number(wallets[0]?.hold_balance ?? 0);
    let currentLedger = Number(wallets[0]?.ledger_balance ?? 0);

    if (!walletId) {
      if (action === 'RELEASE') {
        throw new ApiError(400, 'WALLET_NOT_FOUND', 'User wallet record was not found');
      }
      walletId = randomUUID();
      await connection.execute(
        `INSERT INTO wallets (id, party_id, currency, status, available_balance, hold_balance, ledger_balance)
         VALUES (?, ?, 'INR', 'ACTIVE', 0, 0, 0)`,
        [walletId, user.partyId]
      );
      currentAvailable = 0;
      currentHold = 0;
      currentLedger = 0;
    }

    let newAvailable = currentAvailable;
    let newHold = currentHold;

    if (action === 'HOLD') {
      if (currentAvailable < amount) {
        throw new ApiError(
          400,
          'INSUFFICIENT_FUNDS',
          `Cannot place hold: amount ₹${amount} exceeds available balance ₹${currentAvailable}`
        );
      }
      newAvailable = currentAvailable - amount;
      newHold = currentHold + amount;
    } else {
      // RELEASE
      if (currentHold < amount) {
        throw new ApiError(
          400,
          'INVALID_HOLD_RELEASE',
          `Cannot release hold: amount ₹${amount} exceeds active hold balance ₹${currentHold}`
        );
      }
      newAvailable = currentAvailable + amount;
      newHold = currentHold - amount;
    }

    await connection.execute(
      `UPDATE wallets SET available_balance = ?, hold_balance = ?, version = version + 1 WHERE id = ?`,
      [newAvailable, newHold, walletId]
    );

    updatedWallet = {
      availableBalance: newAvailable,
      ledgerBalance: currentLedger,
      holdBalance: newHold,
    };
  });

  return {
    user,
    holdRecord: {
      action,
      amount,
      remarks,
      status: action === 'HOLD' ? 'ACTIVE_HOLD' : 'RELEASED',
      wallet: updatedWallet,
    },
  };
}
