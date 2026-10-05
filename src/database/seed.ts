import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { RowDataPacket } from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { pool, withTransaction } from './pool.js';

const roleCodes = ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS', 'ACCOUNTS', 'KYC', 'SALES', 'SUPPORT', 'MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER'];
const permissions = [
  ['PARTY_READ', 'PARTY', 'READ'], ['PARTY_CREATE', 'PARTY', 'CREATE'], ['PARTY_STATUS_UPDATE', 'PARTY', 'STATUS_UPDATE'], ['PARTY_APPROVE', 'PARTY', 'APPROVE'],
  ['MASTER_DATA_READ', 'MASTER_DATA', 'READ'], ['MASTER_DATA_WRITE', 'MASTER_DATA', 'WRITE'], ['USER_READ', 'USER', 'READ'], ['USER_WRITE', 'USER', 'WRITE'],
  ['KYC_READ', 'KYC', 'READ'], ['KYC_REVIEW', 'KYC', 'REVIEW'], ['PROVIDER_READ', 'PROVIDER', 'READ'], ['PROVIDER_WRITE', 'PROVIDER', 'WRITE'],
  ['NOTIFICATION_READ', 'NOTIFICATION', 'READ'], ['AUDIT_READ', 'AUDIT', 'READ'], ['REPORT_READ', 'REPORT', 'READ'],
] as const;

async function seed(): Promise<void> {
  await withTransaction(async (connection) => {
    for (const code of roleCodes) {
      await connection.execute(`INSERT INTO roles (code, name, is_system, is_active) VALUES (?, ?, TRUE, TRUE)
        ON DUPLICATE KEY UPDATE name = VALUES(name), is_active = TRUE`, [code, code.replaceAll('_', ' ')]);
    }
    for (const [code, module, action] of permissions) {
      await connection.execute(`INSERT INTO permissions (code, module, action) VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action)`, [code, module, action]);
    }
    await connection.execute(`INSERT IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'SUPER_ADMIN'`);

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
      SELECT ?, id FROM roles WHERE code = 'SUPER_ADMIN'`, [userRows[0]!.id]);
  });
}

seed().then(() => logger.info({ adminEmail: env.SEED_ADMIN_EMAIL }, 'Database seed completed')).catch((error: unknown) => {
  logger.fatal({ err: error }, 'Database seed failed');
  process.exitCode = 1;
}).finally(async () => pool.end());
