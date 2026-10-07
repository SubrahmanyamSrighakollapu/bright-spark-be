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

const defaultDemoPassword = 'Demo@123456';

const rolePermissionMap: Record<string, string[]> = {
  MASTER_DISTRIBUTOR: ['PARTY_READ', 'PARTY_CREATE', 'USER_READ', 'USER_WRITE', 'KYC_READ', 'REPORT_READ', 'AUDIT_READ'],
  DISTRIBUTOR: ['PARTY_READ', 'PARTY_CREATE', 'USER_READ', 'USER_WRITE', 'KYC_READ', 'REPORT_READ'],
  RETAILER: ['PARTY_READ', 'USER_READ', 'REPORT_READ'],
  OPERATIONS: ['PARTY_READ', 'PARTY_STATUS_UPDATE', 'PARTY_APPROVE', 'USER_READ', 'USER_WRITE', 'KYC_READ', 'KYC_REVIEW', 'REPORT_READ'],
  ACCOUNTS: ['PARTY_READ', 'USER_READ', 'MASTER_DATA_READ', 'REPORT_READ', 'AUDIT_READ'],
  KYC: ['PARTY_READ', 'KYC_READ', 'KYC_REVIEW'],
  SALES: ['PARTY_READ', 'PARTY_CREATE', 'USER_READ', 'REPORT_READ'],
};

interface DemoUserDef {
  email: string;
  fullName: string;
  mobile: string;
  roleCode: string;
  partyType: 'PLATFORM' | 'MASTER_DISTRIBUTOR' | 'DISTRIBUTOR' | 'RETAILER' | 'EMPLOYEE';
  partyCode: string;
  partyName: string;
  parentPartyCode?: string;
  employeeCode?: string;
  departmentCode?: string;
}

const demoUsers: DemoUserDef[] = [
  {
    email: 'md@qinstarpay.com',
    fullName: 'Demo Master Distributor',
    mobile: '9876543210',
    roleCode: 'MASTER_DISTRIBUTOR',
    partyType: 'MASTER_DISTRIBUTOR',
    partyCode: 'MD001',
    partyName: 'Master Distributor Demo',
    parentPartyCode: 'QSP',
  },
  {
    email: 'distributor@qinstarpay.com',
    fullName: 'Demo Distributor',
    mobile: '9876543211',
    roleCode: 'DISTRIBUTOR',
    partyType: 'DISTRIBUTOR',
    partyCode: 'DST001',
    partyName: 'Distributor Demo',
    parentPartyCode: 'MD001',
  },
  {
    email: 'retailer@qinstarpay.com',
    fullName: 'Demo Retailer',
    mobile: '9876543212',
    roleCode: 'RETAILER',
    partyType: 'RETAILER',
    partyCode: 'RET001',
    partyName: 'Retailer Demo Store',
    parentPartyCode: 'DST001',
  },
  {
    email: 'ops@qinstarpay.com',
    fullName: 'Demo Operations User',
    mobile: '9876543213',
    roleCode: 'OPERATIONS',
    partyType: 'PLATFORM',
    partyCode: 'QSP',
    partyName: 'Qin Star Pay',
    employeeCode: 'EMP_OPS_001',
    departmentCode: 'OPERATIONS',
  },
  {
    email: 'accounts@qinstarpay.com',
    fullName: 'Demo Accounts User',
    mobile: '9876543214',
    roleCode: 'ACCOUNTS',
    partyType: 'PLATFORM',
    partyCode: 'QSP',
    partyName: 'Qin Star Pay',
    employeeCode: 'EMP_ACC_001',
    departmentCode: 'ACCOUNTS',
  },
  {
    email: 'kyc@qinstarpay.com',
    fullName: 'Demo KYC Officer',
    mobile: '9876543215',
    roleCode: 'KYC',
    partyType: 'PLATFORM',
    partyCode: 'QSP',
    partyName: 'Qin Star Pay',
    employeeCode: 'EMP_KYC_001',
    departmentCode: 'KYC',
  },
  {
    email: 'sales@qinstarpay.com',
    fullName: 'Demo Sales Executive',
    mobile: '9876543216',
    roleCode: 'SALES',
    partyType: 'PLATFORM',
    partyCode: 'QSP',
    partyName: 'Qin Star Pay',
    employeeCode: 'EMP_SAL_001',
    departmentCode: 'SALES',
  },
];

async function seed(): Promise<void> {
  await withTransaction(async (connection) => {
    // 1. Roles
    for (const [code, name, category, isSystem] of roles) {
      await connection.execute(
        `INSERT INTO roles (code, name, role_category, is_system, is_active) VALUES (?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE name = VALUES(name), role_category = VALUES(role_category), is_system = VALUES(is_system), is_active = TRUE`,
        [code, name, category, isSystem]
      );
    }

    // 2. Permissions
    for (const [code, module, action] of permissions) {
      await connection.execute(
        `INSERT INTO permissions (code, module, action) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE module = VALUES(module), action = VALUES(action)`,
        [code, module, action]
      );
    }

    // 3. Admin Permissions (All permissions)
    await connection.execute(`INSERT IGNORE INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN'`);

    // 4. Role-Permission mappings for network and employee roles
    for (const [roleCode, permCodes] of Object.entries(rolePermissionMap)) {
      for (const permCode of permCodes) {
        await connection.execute(
          `INSERT IGNORE INTO role_permissions (role_id, permission_id)
           SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code = ? WHERE r.code = ?`,
          [permCode, roleCode]
        );
      }
    }

    // 5. System Platform Party
    const [platformRows] = await connection.query<(RowDataPacket & { id: string })[]>('SELECT id FROM parties WHERE code = ?', ['QSP']);
    let qspPartyId: string;
    if (platformRows[0]) {
      qspPartyId = platformRows[0].id;
    } else {
      qspPartyId = randomUUID();
      await connection.execute(
        `INSERT INTO parties (id, party_type, code, display_name, legal_name, approval_status, account_status, kyc_status)
         VALUES (?, 'PLATFORM', 'QSP', 'Qin Star Pay', 'Qin Star Pay', 'APPROVED', 'ACTIVE', 'APPROVED')`,
        [qspPartyId]
      );
    }

    // 6. Super Admin User
    const adminUserId = randomUUID();
    const adminPasswordHash = await bcrypt.hash(env.SEED_ADMIN_PASSWORD, env.BCRYPT_ROUNDS);
    await connection.execute(
      `INSERT INTO users (id, party_id, email, full_name, password_hash, status)
       VALUES (?, ?, ?, 'Qin Star Pay Super Admin', ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), password_hash = VALUES(password_hash), status = 'ACTIVE'`,
      [adminUserId, qspPartyId, env.SEED_ADMIN_EMAIL, adminPasswordHash]
    );
    const [adminUserRows] = await connection.query<(RowDataPacket & { id: string })[]>('SELECT id FROM users WHERE email = ?', [env.SEED_ADMIN_EMAIL]);
    const adminId = adminUserRows[0]!.id;

    await connection.execute(
      `INSERT IGNORE INTO user_roles (user_id, role_id)
       SELECT ?, id FROM roles WHERE code = 'ADMIN'`,
      [adminId]
    );

    // 7. Master Data - Employee Departments
    for (const [code, label, sortOrder] of [
      ['OPERATIONS', 'Operations', 10],
      ['ACCOUNTS', 'Accounts', 20],
      ['KYC', 'KYC', 30],
      ['SALES', 'Sales', 40],
    ] as const) {
      await connection.execute(
        `INSERT INTO master_data (id, category, code, label, sort_order, is_active, created_by)
         VALUES (?, 'EMPLOYEE_DEPARTMENT', ?, ?, ?, TRUE, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order), is_active = TRUE`,
        [randomUUID(), code, label, sortOrder, adminId]
      );
    }

    // 8. Demo Users Seeding
    const demoPasswordHash = await bcrypt.hash(defaultDemoPassword, env.BCRYPT_ROUNDS);

    for (const u of demoUsers) {
      // Find parent party ID if applicable
      let parentId: string | null = null;
      if (u.parentPartyCode) {
        const [parentRows] = await connection.query<(RowDataPacket & { id: string })[]>(
          'SELECT id FROM parties WHERE code = ?',
          [u.parentPartyCode]
        );
        if (parentRows[0]) {
          parentId = parentRows[0].id;
        }
      }

      // Upsert Party
      let partyId = qspPartyId;
      if (u.partyCode !== 'QSP') {
        const newPartyId = randomUUID();
        await connection.execute(
          `INSERT INTO parties (id, party_type, code, display_name, legal_name, email, mobile, parent_party_id, approval_status, account_status, kyc_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED', 'ACTIVE', 'APPROVED')
           ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), account_status = 'ACTIVE', approval_status = 'APPROVED'`,
          [newPartyId, u.partyType, u.partyCode, u.partyName, u.partyName, u.email, u.mobile, parentId]
        );
        const [pRows] = await connection.query<(RowDataPacket & { id: string })[]>(
          'SELECT id FROM parties WHERE code = ?',
          [u.partyCode]
        );
        if (pRows[0]) {
          partyId = pRows[0].id;
        }
      }

      // Upsert User
      const newUserId = randomUUID();
      await connection.execute(
        `INSERT INTO users (id, party_id, email, mobile, full_name, password_hash, status)
         VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
         ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), status = 'ACTIVE', password_hash = VALUES(password_hash)`,
        [newUserId, partyId, u.email, u.mobile, u.fullName, demoPasswordHash]
      );
      const [usrRows] = await connection.query<(RowDataPacket & { id: string })[]>(
        'SELECT id FROM users WHERE email = ?',
        [u.email]
      );
      const demoUserId = usrRows[0]!.id;

      // Assign User Role
      await connection.execute(
        `INSERT IGNORE INTO user_roles (user_id, role_id)
         SELECT ?, id FROM roles WHERE code = ?`,
        [demoUserId, u.roleCode]
      );

      // Create Employee Profile if applicable
      if (u.employeeCode && u.departmentCode) {
        const empProfileId = randomUUID();
        await connection.execute(
          `INSERT INTO employee_profiles (id, user_id, employee_code, department_code, designation, employment_status, created_by)
           VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)
           ON DUPLICATE KEY UPDATE department_code = VALUES(department_code), employment_status = 'ACTIVE'`,
          [empProfileId, demoUserId, u.employeeCode, u.departmentCode, u.roleCode, adminId]
        );
      }
    }

    // 9. Integration Providers Seeding
    const seedProviders = [
      ['AIRTEL', 'Airtel Payments Bank Gateway', 'MULTI_SERVICE', 'SANDBOX', 'ACTIVE', 'https://api-sandbox.airtel.in/v1'],
      ['JIO', 'Jio Digital Services Gateway', 'MULTI_SERVICE', 'SANDBOX', 'ACTIVE', 'https://partner.jio.com/api/v1'],
      ['PAYTM', 'Paytm Payments Gateway & BBPS', 'PAY_IN', 'PRODUCTION', 'ACTIVE', 'https://securegw.paytm.in/v1'],
      ['RAZORPAY', 'Razorpay Payouts Gateway', 'PAY_OUT', 'PRODUCTION', 'ACTIVE', 'https://api.razorpay.com/v1'],
      ['ICICI_BBPS', 'ICICI Bank BBPS Biller System', 'PAY_IN', 'PRODUCTION', 'ACTIVE', 'https://bbps.icicibank.com/v2'],
      ['CASHFREE', 'Cashfree Instant Payout Engine', 'PAY_OUT', 'SANDBOX', 'ACTIVE', 'https://payout-api.cashfree.com/v1'],
      ['PAYSPRINT', 'Paysprint AEPS & DMT Gateway', 'MULTI_SERVICE', 'PRODUCTION', 'ACTIVE', 'https://api.paysprint.in/v1'],
      ['CYBERPLAT', 'Cyberplat Utility Payment Services', 'MULTI_SERVICE', 'SANDBOX', 'ACTIVE', 'https://cyberplat.in/api'],
    ] as const;

    for (const [code, name, type, env, status, url] of seedProviders) {
      await connection.execute(
        `INSERT INTO providers (id, code, name, provider_type, environment, status, base_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), provider_type = VALUES(provider_type), environment = VALUES(environment), status = VALUES(status), base_url = VALUES(base_url)`,
        [randomUUID(), code, name, type, env, status, url]
      );
    }

    // 10. Pricing & Retailer Plans Seeding
    const seedPlans = [
      ['DEFAULT_RETAILER', 'Standard Retailer Plan', 1, 'ACTIVE'],
      ['GOLD_COMMISSION', 'Gold Retailer Plan', 1, 'ACTIVE'],
      ['PLATINUM_COMMISSION', 'Platinum Partner Plan', 1, 'ACTIVE'],
    ] as const;

    for (const [code, name, version, status] of seedPlans) {
      await connection.execute(
        `INSERT INTO pricing_plans (id, code, name, version, status)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE name = VALUES(name), status = VALUES(status)`,
        [randomUUID(), code, name, version, status]
      );
    }

    // 11. Service Categories & Headlines Master Data Seeding
    const seedMasterItems = [
      ['SERVICE_CATEGORY', 'MOBILE_RECHARGE', 'Mobile Prepaid & Postpaid', 'Telecom recharge and bill payment services', 10],
      ['SERVICE_CATEGORY', 'DTH', 'DTH Recharge', 'Direct-to-home TV subscription payments', 20],
      ['SERVICE_CATEGORY', 'BBPS', 'BBPS Utility Bills', 'Electricity, Water, Gas & Broadband bill payments', 30],
      ['SERVICE_CATEGORY', 'AEPS', 'Aadhaar Enabled Payment (AEPS)', 'Biometric cash withdrawal and mini-statement', 40],
      ['SERVICE_CATEGORY', 'MONEY_TRANSFER', 'Domestic Money Transfer (DMT)', 'Instant IMPS/NEFT fund transfer to any bank', 50],
      ['SERVICE_CATEGORY', 'PAYOUTS', 'Payouts & Vendor Settlement', 'Automated bulk merchant payouts', 60],
      ['SERVICE_CATEGORY', 'PAN_CARD', 'PAN Card Services', 'NSDL & UTI PAN application processing', 70],
      ['HEADLINE', 'HL_001', 'System Maintenance Scheduled', 'Scheduled system maintenance on Sunday from 02:00 AM to 04:00 AM IST.', 10],
      ['NOTICE_BOARD', 'NB_001', 'New ICICI BBPS Biller Added', 'Electricity bill payment for TNEB and UPVCL is now live with instant confirmation.', 20],
      ['TICKER', 'TK_001', 'High Commission Surcharge Offer', 'Earn up to 0.80% extra margin on AEPS transaction volumes exceeding 50,000 INR today!', 30],
    ] as const;

    for (const [cat, code, label, desc, sort] of seedMasterItems) {
      await connection.execute(
        `INSERT INTO master_data (id, category, code, label, description, sort_order, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description), sort_order = VALUES(sort_order), is_active = TRUE`,
        [randomUUID(), cat, code, label, desc, sort, adminId]
      );
    }
  });
}

seed()
  .then(() => logger.info({ adminEmail: env.SEED_ADMIN_EMAIL }, 'Database seed completed successfully with demo users'))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'Database seed failed');
    process.exitCode = 1;
  })
  .finally(async () => pool.end());
