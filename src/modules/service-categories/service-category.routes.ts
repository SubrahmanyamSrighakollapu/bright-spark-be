import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';

export const serviceCategoryRouter = Router();
serviceCategoryRouter.use(authenticate);

interface CategoryRow extends RowDataPacket {
  id: string; code: string; label: string; description: string | null; sort_order: number; is_active: number; created_at: Date;
}

const defaultCategories = [
  { code: 'MOBILE_RECHARGE', label: 'Mobile Prepaid & Postpaid', description: 'Telecom recharge and bill payment services', sortOrder: 10 },
  { code: 'DTH', label: 'DTH Recharge', description: 'Direct-to-home TV subscription payments', sortOrder: 20 },
  { code: 'BBPS', label: 'BBPS Utility Bills', description: 'Electricity, Water, Gas & Broadband bill payments', sortOrder: 30 },
  { code: 'AEPS', label: 'Aadhaar Enabled Payment (AEPS)', description: 'Biometric cash withdrawal and mini-statement', sortOrder: 40 },
  { code: 'MONEY_TRANSFER', label: 'Domestic Money Transfer (DMT)', description: 'Instant IMPS/NEFT fund transfer to any bank', sortOrder: 50 },
  { code: 'PAYOUTS', label: 'Payouts & Vendor Settlement', description: 'Automated bulk merchant payouts', sortOrder: 60 },
  { code: 'PAN_CARD', label: 'PAN Card Services', description: 'NSDL & UTI PAN application processing', sortOrder: 70 },
  { code: 'FASTAG', label: 'FASTag Recharge', description: 'National Highway toll tag recharges', sortOrder: 80 },
];

serviceCategoryRouter.get('/', asyncHandler(async (_request, response) => {
  const [rows] = await pool.query<CategoryRow[]>(
    "SELECT * FROM master_data WHERE category = 'SERVICE_CATEGORY' ORDER BY sort_order ASC"
  );

  if (rows.length === 0) {
    // Return default categories if empty
    return sendSuccess(response, defaultCategories.map((c, i) => ({
      id: `cat_${i + 1}`,
      code: c.code,
      name: c.label,
      description: c.description,
      sortOrder: c.sortOrder,
      isActive: true,
    })));
  }

  return sendSuccess(response, rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.label,
    description: r.description,
    sortOrder: r.sort_order,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
  })));
}));

const categorySchema = z.object({
  code: z.string().trim().min(2).max(50),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

serviceCategoryRouter.post('/', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const input = categorySchema.parse(request.body);
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO master_data (id, category, code, label, description, sort_order, is_active, created_by)
     VALUES (?, 'SERVICE_CATEGORY', ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description), sort_order = VALUES(sort_order), is_active = VALUES(is_active)`,
    [id, input.code.toUpperCase(), input.name, input.description || null, input.sortOrder, input.isActive, request.auth!.userId]
  );
  return sendSuccess(response, { id, ...input }, 201);
}));
