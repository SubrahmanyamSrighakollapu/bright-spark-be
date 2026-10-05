import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { pool, withTransaction } from './pool.js';

const roles = [
  ['ADMIN', 'Admin', 'SYSTEM', true],
  ['MASTER_DISTRIBUTOR', 'Master Distributor', 'NETWORK', true],
  ['DISTRIBUTOR', 'Distributor', 'NETWORK', true],
  ['RETAILER', 'Retailer', 'NETWORK', true],
  ['OPERATIONS', 'Operations', 'EMPLOYEE', false],
  ['ACCOUNTS', 'Accounts', 'EMPLOYEE', false],
  ['KYC', 'KYC', 'EMPLOYEE', false],
  ['SALES', 'Sales', 'EMPLOYEE', false],
] as const;
const permissions = [
  ['PARTY_READ', 'PARTY', 'READ'], ['PARTY_CREATE', 'PARTY', 'CREATE'], ['PARTY_STATUS_UPDATE', 'PARTY', 'STATUS_UPDATE'], ['PARTY_APPROVE', 'PARTY', 'APPROVE'],
  ['MASTER_DATA_READ', 'MASTER_DATA', 'READ'], ['MASTER_DATA_WRITE', 'MASTER_DATA', 'WRITE'], ['USER_READ', 'USER', 'READ'], ['USER_WRITE', 'USER', 'WRITE'],
  ['KYC_READ', 'KYC', 'READ'], ['KYC_REVIEW', 'KYC', 'REVIEW'], ['PROVIDER_READ', 'PROVIDER', 'READ'], ['PROVIDER_WRITE', 'PROVIDER', 'WRITE'],
  ['NOTIFICATION_READ', 'NOTIFICATION', 'READ'], ['AUDIT_READ', 'AUDIT', 'READ'], ['REPORT_READ', 'REPORT', 'READ'],
  ['ROLE_READ', 'ROLE', 'READ'], ['ROLE_CREATE', 'ROLE', 'CREATE'], ['ROLE_UPDATE', 'ROLE', 'UPDATE'],
  ['EMPLOYEE_READ', 'EMPLOYEE', 'READ'], ['EMPLOYEE_CREATE', 'EMPLOYEE', 'CREATE'], ['EMPLOYEE_UPDATE', 'EMPLOYEE', 'UPDATE'],
] as const;

async function seed(): Promise<void> {
  await withTransaction(async (connection) => {
    for (const [code, name, category, isSystem] of roles) {
      await connection.execute(`INSERT INTO roles (code, name, role_category, is_system, is_active) VALUES (?, ?, ?, ?, TRUE)
        ON DUPLICATE KEY UPDATE name = VALUES(name), role_category = VALUES(role_category), is_system = VALUES(is_system), is_active = TRUE`,
      [code, name, category, isSystem]);
    }
    for (const [code, module, action] of permissions) {
      await connection.execute(`INSERT INTO permissions (code, module, action) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action)`, [code, module, action]);
    }
    await connection.execute(`INSERT IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN'`);

    const platformId = randomUUID();
    await connection.execute(`INSERT INTO parties (id, party_type, code, display_name, legal_name, approval_status, account_status, kyc_status)
      VALUES (?, 'PLATFORM', 'QSP', 'Qin Star Pay', 'Qin Star Pay', 'APPROVED', 'ACTIVE', 'APPROVED')
      ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`, [platformId]);
    const [platformRows] = await connection.query<(RowDataPacket & { id: string })[]>('SELECT id FROM parties WHERE code = ?', ['QSP']);
    const userId = randomUUID();
    const passwordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
    await connection.execute(`INSERT INTO users (id, party_id, email, full_name, password_hash, status)
      VALUES (?, ?, ?, 'Qin Star Pay Super Admin', ?, 'ACTIVE')
      ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`, [userId, platformRows[0]!.id, env.SEED_ADMIN_EMAIL, passwordHash]);
    const [userRows] = await connection.query<(RowDataPacket & { id: string })[]>('SELECT id FROM users WHERE email = ?', [env.SEED_ADMIN_EMAIL]);
    await connection.execute(`INSERT IGNORE INTO user_roles (user_id, role_id)
      SELECT ?, id FROM roles WHERE code = 'ADMIN'`, [userRows[0]!.id]);
    for (const [code, label, sortOrder] of [
      ['OPERATIONS', 'Operations', 10], ['ACCOUNTS', 'Accounts', 20], ['KYC', 'KYC', 30], ['SALES', 'Sales', 40],
    ] as const) {
      await connection.execute(`INSERT INTO master_data (id, category, code, label, sort_order, is_active, created_by)
        VALUES (?, 'EMPLOYEE_DEPARTMENT', ?, ?, ?, TRUE, ?)
        ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order), is_active = TRUE`,
      [randomUUID(), code, label, sortOrder, userRows[0]!.id]);
    }
  });
}

seed().then(() => logger.info({ adminEmail: env.SEED_ADMIN_EMAIL }, 'Database seed completed')).catch((error: unknown) => {
  logger.fatal({ err: error }, 'Database seed failed');
  process.exitCode = 1;
}).finally(async () => pool.end());
