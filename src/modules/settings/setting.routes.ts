import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';

export const settingRouter = Router();
settingRouter.use(authenticate);

interface SettingRow extends RowDataPacket {
  id: string; code: string; label: string; description: string | null; configuration: string | null; is_active: number;
}

const defaultSettings = {
  appName: 'Bright Spark',
  companyName: 'Bright Spark Financial Technologies',
  supportEmail: 'support@brightspark.com',
  supportPhone: '+91 1800-123-4567',
  gstPercentage: 18.0,
  minWalletBalanceRequirement: 500,
  maxDailyTransactionLimit: 200000,
  isMaintenanceMode: false,
  isKycMandatory: true,
  twoFactorAuth: true,
};

settingRouter.get('/', asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<SettingRow[]>(
    "SELECT * FROM master_data WHERE category = 'SYSTEM_SETTING'"
  );

  const settings: Record<string, unknown> = { ...defaultSettings };
  rows.forEach((r) => {
    if (r.configuration) {
      try {
        const parsed = typeof r.configuration === 'string' ? JSON.parse(r.configuration) : r.configuration;
        Object.assign(settings, parsed);
      } catch {}
    }
  });

  return sendSuccess(response, settings);
}));

const updateSettingSchema = z.record(z.string(), z.unknown());

settingRouter.patch('/', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const input = updateSettingSchema.parse(request.body);
  const id = randomUUID();

  await pool.execute(
    `INSERT INTO master_data (id, category, code, label, description, configuration, is_active, created_by)
     VALUES (?, 'SYSTEM_SETTING', 'GLOBAL_CONFIG', 'Global System Configuration', 'System wide configuration settings', ?, TRUE, ?)
     ON DUPLICATE KEY UPDATE configuration = VALUES(configuration), is_active = TRUE`,
    [id, JSON.stringify(input), request.auth!.userId]
  );

  return sendSuccess(response, { ...defaultSettings, ...input });
}));
