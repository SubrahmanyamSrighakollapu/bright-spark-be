import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import type { z } from 'zod';
import type {
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
  transferUserAuthoritySchema,
  walletCreditDebitSchema,
  walletHoldSchema,
} from './user.schemas.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

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
  parent_party_type: string | null;
  grandparent_party_id: string | null;
  role_code: string | null;
  role_name: string | null;
  wallet_id: string | null;
  available_balance: number | string | null;
  hold_balance: number | string | null;
  ledger_balance: number | string | null;
  created_by_user_id: string | null;
  creator_name: string | null;
  creator_role: string | null;
  plan_id: string | null;
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
    parentType: row.parent_party_type,
    masterDistributorId: row.party_type === 'DISTRIBUTOR'
      ? row.parent_party_id
      : row.parent_party_type === 'MASTER_DISTRIBUTOR' ? row.parent_party_id : row.grandparent_party_id,
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
    createdByUserId: row.created_by_user_id,
    createdByRole: row.creator_role,
    createdBy: row.creator_role === 'ADMIN' || row.creator_role === 'SUPER_ADMIN'
      ? 'Admin'
      : row.creator_name || 'Admin',
    planId: row.plan_id,
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
  p.created_by_user_id,
  parent.display_name AS parent_name,
  parent.code AS parent_code,
  parent.party_type AS parent_party_type,
  parent.parent_party_id AS grandparent_party_id,
  creator.full_name AS creator_name,
  creator_role.code AS creator_role,
  JSON_UNQUOTE(JSON_EXTRACT(plan_mapping.configuration, '$.planId')) AS plan_id,
  r.code AS role_code,
  r.name AS role_name,
  w.id AS wallet_id,
  COALESCE(w.available_balance, 0) AS available_balance,
  COALESCE(w.hold_balance, 0) AS hold_balance,
  COALESCE(w.ledger_balance, 0) AS ledger_balance
FROM users u
INNER JOIN parties p ON p.id = u.party_id
LEFT JOIN parties parent ON parent.id = p.parent_party_id
LEFT JOIN users creator ON creator.id = p.created_by_user_id
LEFT JOIN user_roles creator_ur ON creator_ur.user_id = creator.id
LEFT JOIN roles creator_role ON creator_role.id = creator_ur.role_id
LEFT JOIN master_data plan_mapping ON plan_mapping.category = 'USER_PLAN_MAPPING' AND plan_mapping.code = u.id AND plan_mapping.is_active = TRUE
LEFT JOIN user_roles ur ON ur.user_id = u.id
LEFT JOIN roles r ON r.id = ur.role_id
LEFT JOIN wallets w ON w.party_id = p.id
`;

function isAdmin(actor: AuthenticatedUser): boolean {
  return actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
}

export async function listUsers(filters: z.infer<typeof listUsersSchema>, actor: AuthenticatedUser) {
  const conditions: string[] = ['u.deleted_at IS NULL', 'p.deleted_at IS NULL'];
  const values: unknown[] = [];

  if (!isAdmin(actor)) {
    if (!actor.partyId) throw new ApiError(403, 'NETWORK_SCOPE_REQUIRED', 'Your account is not linked to a network party');
    if (actor.roles.includes('MASTER_DISTRIBUTOR')) {
      conditions.push('(p.parent_party_id = ? OR parent.parent_party_id = ?)');
      values.push(actor.partyId, actor.partyId);
    } else if (actor.roles.includes('DISTRIBUTOR')) {
      conditions.push("p.parent_party_id = ? AND p.party_type = 'RETAILER'");
      values.push(actor.partyId);
    } else {
      throw new ApiError(403, 'NETWORK_SCOPE_FORBIDDEN', 'This role cannot access network user management');
    }
  }

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

export async function assertUserInActorScope(id: string, actor: AuthenticatedUser): Promise<void> {
  if (isAdmin(actor)) return;
  if (!actor.partyId) throw new ApiError(403, 'NETWORK_SCOPE_REQUIRED', 'Your account is not linked to a network party');
  const [rows] = await pool.query<(RowDataPacket & { party_type: string; parent_party_id: string | null; grandparent_id: string | null })[]>(
    `SELECT p.party_type, p.parent_party_id, parent.parent_party_id AS grandparent_id
     FROM users u JOIN parties p ON p.id = u.party_id
     LEFT JOIN parties parent ON parent.id = p.parent_party_id
     WHERE (u.id = ? OR p.id = ? OR p.code = ?) AND u.deleted_at IS NULL AND p.deleted_at IS NULL LIMIT 1`,
    [id, id, id],
  );
  const target = rows[0];
  const allowed = actor.roles.includes('MASTER_DISTRIBUTOR')
    ? target && (target.parent_party_id === actor.partyId || target.grandparent_id === actor.partyId)
    : actor.roles.includes('DISTRIBUTOR')
      ? target?.party_type === 'RETAILER' && target.parent_party_id === actor.partyId
      : false;
  if (!allowed) throw new ApiError(404, 'USER_NOT_FOUND', 'User was not found within your network');
}

function generatePartyCode(role: string): string {
  const prefix = role === 'MASTER_DISTRIBUTOR' ? 'MD' : role === 'DISTRIBUTOR' ? 'DST' : 'RET';
  const randomNum = Math.floor(100 + Math.random() * 900);
  return `${prefix}${randomNum}`;
}

export async function createUser(input: z.infer<typeof createUserSchema>, actor: AuthenticatedUser) {
  const userId = randomUUID();
  const partyId = randomUUID();
  const walletId = randomUUID();
  const partyCode = generatePartyCode(input.role);

  await withTransaction(async (connection) => {
    let finalParentPartyId = input.parentPartyId;

    if (!isAdmin(actor)) {
      if (!actor.partyId) throw new ApiError(403, 'NETWORK_SCOPE_REQUIRED', 'Your account is not linked to a network party');
      if (actor.roles.includes('MASTER_DISTRIBUTOR')) {
        if (input.role === 'MASTER_DISTRIBUTOR') throw new ApiError(403, 'ROLE_CREATION_FORBIDDEN', 'Master Distributors can create only Distributors and Retailers');
        if (input.role === 'DISTRIBUTOR') finalParentPartyId = actor.partyId;
      } else if (actor.roles.includes('DISTRIBUTOR')) {
        if (input.role !== 'RETAILER') throw new ApiError(403, 'ROLE_CREATION_FORBIDDEN', 'Distributors can create only Retailers');
        finalParentPartyId = actor.partyId;
      } else throw new ApiError(403, 'ROLE_CREATION_FORBIDDEN', 'This role cannot create network users');
    }

    // Parent hierarchy validation
    if (finalParentPartyId) {
      const [parents] = await connection.query<
        (RowDataPacket & { id: string; party_type: string; account_status: string })[]
      >('SELECT id, party_type, account_status FROM parties WHERE (id = ? OR code = ?) AND deleted_at IS NULL FOR UPDATE', [
        finalParentPartyId,
        finalParentPartyId,
      ]);
      const parent = parents[0];
      if (!parent) throw new ApiError(422, 'INVALID_PARENT', 'Parent party was not found');
      if (parent.account_status !== 'ACTIVE') {
        throw new ApiError(422, 'PARENT_NOT_ACTIVE', 'Parent party must be active');
      }
      const expectedParentTypes = input.role === 'MASTER_DISTRIBUTOR' ? ['PLATFORM'] : input.role === 'DISTRIBUTOR' ? ['MASTER_DISTRIBUTOR'] : ['MASTER_DISTRIBUTOR', 'DISTRIBUTOR'];
      if (!expectedParentTypes.includes(parent.party_type)) throw new ApiError(422, 'INVALID_PARENT_TYPE', `Invalid parent for ${input.role}`);
      if (!isAdmin(actor) && actor.roles.includes('MASTER_DISTRIBUTOR') && input.role === 'RETAILER' && parent.id !== actor.partyId) {
        const [ownedParents] = await connection.query<RowDataPacket[]>('SELECT id FROM parties WHERE id = ? AND parent_party_id = ? AND party_type = ? LIMIT 1', [parent.id, actor.partyId, 'DISTRIBUTOR']);
        if (!ownedParents[0]) throw new ApiError(403, 'PARENT_OUTSIDE_SCOPE', 'Retailer parent must belong to your network');
      }
    } else {
      // Default to logged-in admin's party ID or top platform party
      const [actorParties] = await connection.query<(RowDataPacket & { party_id: string })[]>(
        'SELECT party_id FROM users WHERE id = ? LIMIT 1',
        [actor.userId]
      );
      if (actorParties[0]?.party_id) {
        finalParentPartyId = actorParties[0].party_id;
      } else {
        const [topParties] = await connection.query<(RowDataPacket & { id: string })[]>(
          "SELECT id FROM parties WHERE party_type IN ('PLATFORM', 'ADMIN') LIMIT 1"
        );
        finalParentPartyId = topParties[0]?.id;
      }
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
      `INSERT INTO parties (id, party_type, code, display_name, legal_name, email, mobile, parent_party_id, created_by_user_id, approval_status, account_status, kyc_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_STARTED')`,
      [
        partyId,
        input.role,
        partyCode,
        input.displayName,
        input.legalName ?? input.displayName,
        input.email,
        input.mobile,
        finalParentPartyId ?? null,
        actor.userId,
        'PENDING_APPROVAL',
        'PENDING',
      ]
    );

    // Auto-generate temporary password: QinStar@ + last 4 digits of mobile
    const last4 = input.mobile && input.mobile.length >= 4 ? input.mobile.slice(-4) : '1234';
    const generatedTempPassword = input.password || `QinStar@${last4}`;
    const passwordHash = await bcrypt.hash(generatedTempPassword, 12);

    // Create user
    await connection.execute(
      `INSERT INTO users (id, party_id, email, mobile, full_name, password_hash, status, must_change_password)
       VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [userId, partyId, input.email, input.mobile, input.fullName, passwordHash, 'PENDING']
    );

    // Create user role mapping if role found
    if (roleId) {
      await connection.execute(
        `INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)`,
        [userId, roleId, actor.userId]
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
  if (status === 'ACTIVE' && user.kycStatus !== 'APPROVED') {
    throw new ApiError(409, 'KYC_APPROVAL_REQUIRED', 'The account cannot be activated before KYC approval');
  }
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

export async function updateUser(
  id: string,
  input: z.infer<typeof updateUserSchema>,
  actorUserId: string
) {
  const user = await getUserById(id);

  await withTransaction(async (connection) => {
    // Check email / mobile conflict if changed
    if (input.email || input.mobile) {
      const email = input.email || user.email;
      const mobile = input.mobile || user.mobile;
      const [existing] = await connection.query<(RowDataPacket & { id: string })[]>(
        'SELECT id FROM users WHERE (email = ? OR mobile = ?) AND id != ? AND deleted_at IS NULL LIMIT 1',
        [email, mobile, user.id]
      );
      if (existing.length > 0) {
        throw new ApiError(409, 'USER_EXISTS', 'Another user with this email or mobile already exists');
      }
    }

    if (input.fullName || input.email || input.mobile) {
      await connection.execute(
        `UPDATE users SET
          full_name = COALESCE(?, full_name),
          email = COALESCE(?, email),
          mobile = COALESCE(?, mobile),
          version = version + 1
         WHERE id = ?`,
        [input.fullName ?? null, input.email ?? null, input.mobile ?? null, user.id]
      );
    }

    if (input.displayName || input.legalName || input.email || input.mobile) {
      await connection.execute(
        `UPDATE parties SET
          display_name = COALESCE(?, display_name),
          legal_name = COALESCE(?, legal_name),
          email = COALESCE(?, email),
          mobile = COALESCE(?, mobile),
          version = version + 1
         WHERE id = ?`,
        [input.displayName ?? null, input.legalName ?? null, input.email ?? null, input.mobile ?? null, user.partyId]
      );
    }
  });

  if (input.status && input.status !== user.status) {
    await updateUserStatus(user.id, input.status, 'Status updated via Edit User form', actorUserId);
  }

  return getUserById(user.id);
}

export async function blockUser(id: string, reason?: string, actorUserId?: string) {
  return updateUserStatus(id, 'SUSPENDED', reason || 'Admin blocked account', actorUserId);
}

export async function unblockUser(id: string, actorUserId?: string) {
  return updateUserStatus(id, 'ACTIVE', 'Admin unblocked account', actorUserId);
}

export async function resetPassword(
  id: string,
  mode: 'LINK' | 'TEMP_PASSWORD' = 'LINK',
  actorUserId?: string
) {
  const user = await getUserById(id);
  const last4 = user.mobile && user.mobile.length >= 4 ? user.mobile.slice(-4) : '1234';

  const isEmployee = user.role === 'EMPLOYEE' || user.role === 'STAFF';
  const prefix = isEmployee ? 'QinStarEmp@' : 'QinStar@';
  const tempPassword = `${prefix}${last4}`;

  const passwordHash = await bcrypt.hash(tempPassword, 12);

  await pool.execute(
    `UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP(6), version = version + 1 WHERE id = ?`,
    [passwordHash, user.id]
  );

  return {
    message: mode === 'TEMP_PASSWORD'
      ? `Temporary password generated successfully for ${user.fullName}.`
      : `Password reset dispatched via email (${user.email}) and SMS.`,
    tempPassword: mode === 'TEMP_PASSWORD' ? tempPassword : undefined,
  };
}

function assertAdminAuthority(actor: AuthenticatedUser) {
  if (!isAdmin(actor)) {
    throw new ApiError(403, 'ADMIN_AUTHORITY_REQUIRED', 'Only an administrator can transfer network user authority');
  }
}

const allowedAuthorityTypes: Record<string, string[]> = {
  MASTER_DISTRIBUTOR: ['PLATFORM'],
  DISTRIBUTOR: ['PLATFORM', 'MASTER_DISTRIBUTOR'],
  RETAILER: ['PLATFORM', 'MASTER_DISTRIBUTOR', 'DISTRIBUTOR'],
};

export async function listEligibleAuthorities(
  id: string,
  authorityType: string | undefined,
  search: string | undefined,
  actor: AuthenticatedUser,
) {
  assertAdminAuthority(actor);
  const user = await getUserById(id);
  const allowedTypes = allowedAuthorityTypes[user.role];
  if (!allowedTypes) throw new ApiError(422, 'AUTHORITY_TRANSFER_NOT_ALLOWED', 'This user role cannot be transferred in the network hierarchy');
  if (authorityType && !allowedTypes.includes(authorityType)) {
    throw new ApiError(422, 'INVALID_AUTHORITY_TYPE', 'The selected authority type is not valid for this user role');
  }

  const types = authorityType ? [authorityType] : allowedTypes;
  const placeholders = types.map(() => '?').join(', ');
  const conditions = [
    `p.party_type IN (${placeholders})`,
    'p.id <> ?',
    'p.deleted_at IS NULL',
    "p.account_status = 'ACTIVE'",
    "p.approval_status = 'APPROVED'",
  ];
  const values: unknown[] = [...types, user.partyId];
  if (search) {
    conditions.push('(p.display_name LIKE ? OR p.code LIKE ? OR p.email LIKE ? OR p.mobile LIKE ?)');
    const pattern = `%${search}%`;
    values.push(pattern, pattern, pattern, pattern);
  }

  const [rows] = await pool.query<(RowDataPacket & {
    id: string; party_type: string; code: string; display_name: string;
    email: string | null; mobile: string | null; parent_party_id: string | null;
  })[]>(
    `SELECT p.id, p.party_type, p.code, p.display_name, p.email, p.mobile, p.parent_party_id
       FROM parties p
      WHERE ${conditions.join(' AND ')}
      ORDER BY FIELD(p.party_type, 'PLATFORM', 'MASTER_DISTRIBUTOR', 'DISTRIBUTOR'), p.display_name`,
    values,
  );

  return {
    user: { id: user.id, partyId: user.partyId, role: user.role, parentId: user.parentId, name: user.fullName },
    allowedAuthorityTypes: allowedTypes,
    items: rows.map((row) => ({
      partyId: row.id,
      authorityType: row.party_type,
      code: row.code,
      name: row.display_name,
      email: row.email,
      mobile: row.mobile,
      parentPartyId: row.parent_party_id,
      isCurrent: row.id === user.parentId,
    })),
  };
}

export async function transferUserAuthority(
  id: string,
  input: z.infer<typeof transferUserAuthoritySchema>,
  actor: AuthenticatedUser,
) {
  assertAdminAuthority(actor);
  const user = await getUserById(id);
  const allowedTypes = allowedAuthorityTypes[user.role];
  if (!allowedTypes) throw new ApiError(422, 'AUTHORITY_TRANSFER_NOT_ALLOWED', 'This user role cannot be transferred in the network hierarchy');
  if (input.targetParentPartyId === user.parentId) {
    throw new ApiError(409, 'AUTHORITY_UNCHANGED', 'The selected authority is already assigned to this user');
  }

  await withTransaction(async (connection) => {
    const [partyRows] = await connection.query<(RowDataPacket & { id: string; party_type: string; parent_party_id: string | null })[]>(
      'SELECT id, party_type, parent_party_id FROM parties WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [user.partyId],
    );
    const currentParty = partyRows[0];
    if (!currentParty) throw new ApiError(404, 'PARTY_NOT_FOUND', 'The user network party was not found');

    const [targetRows] = await connection.query<(RowDataPacket & { id: string; party_type: string; display_name: string })[]>(
      `SELECT id, party_type, display_name FROM parties
        WHERE id = ? AND deleted_at IS NULL AND account_status = 'ACTIVE' AND approval_status = 'APPROVED'
        FOR UPDATE`,
      [input.targetParentPartyId],
    );
    const target = targetRows[0];
    if (!target) throw new ApiError(422, 'INVALID_TARGET_AUTHORITY', 'The selected authority is not active and approved');
    if (!allowedTypes.includes(target.party_type)) {
      throw new ApiError(422, 'INVALID_AUTHORITY_HIERARCHY', `${user.role} cannot be assigned under ${target.party_type}`);
    }

    await connection.execute(
      'UPDATE parties SET parent_party_id = ?, version = version + 1 WHERE id = ?',
      [target.id, user.partyId],
    );
    await connection.execute(
      `INSERT INTO audit_logs
        (actor_user_id, actor_party_id, action, resource_type, resource_id, outcome, before_data, after_data, metadata)
       VALUES (?, ?, 'USER_AUTHORITY_TRANSFERRED', 'USER', ?, 'SUCCESS', ?, ?, ?)`,
      [actor.userId, actor.partyId, user.id,
        JSON.stringify({ parentPartyId: currentParty.parent_party_id, role: user.role }),
        JSON.stringify({ parentPartyId: target.id, authorityType: target.party_type, role: user.role }),
        JSON.stringify({ reason: input.reason, rolePreserved: true, creatorPreserved: true })],
    );
  });

  return getUserById(user.id);
}

