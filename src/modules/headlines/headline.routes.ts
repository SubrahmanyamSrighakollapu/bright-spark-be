import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';

export const headlineRouter = Router();
headlineRouter.use(authenticate);

interface HeadlineRow extends RowDataPacket {
  id: string; category: string; code: string; label: string; description: string | null; configuration: string | null; sort_order: number; is_active: number; created_at: Date;
}

const defaultHeadlines = [
  { id: 'h1', category: 'HEADLINE', code: 'HL_001', title: 'System Maintenance Scheduled', message: 'Scheduled system maintenance on Sunday from 02:00 AM to 04:00 AM IST.', targetRoles: ['ALL'], isActive: true, sortOrder: 10 },
  { id: 'h2', category: 'NOTICE_BOARD', code: 'NB_001', title: 'New ICICI BBPS Biller Added', message: 'Electricity bill payment for TNEB and UPVCL is now live with instant confirmation.', targetRoles: ['RETAILER', 'DISTRIBUTOR'], isActive: true, sortOrder: 20 },
  { id: 'h3', category: 'TICKER', code: 'TK_001', title: 'High Commission Surcharge Offer', message: 'Earn up to 0.80% extra margin on AEPS transaction volumes exceeding 50,000 INR today!', targetRoles: ['RETAILER'], isActive: true, sortOrder: 30 },
];

headlineRouter.get('/', asyncHandler(async (request, response) => {
  const categoryFilter = request.query.category ? String(request.query.category) : undefined;
  const [rows] = await pool.query<HeadlineRow[]>(
    `SELECT * FROM master_data WHERE category IN ('HEADLINE', 'NOTICE_BOARD', 'TICKER') ${categoryFilter ? 'AND category = ?' : ''} ORDER BY sort_order ASC, created_at DESC`,
    categoryFilter ? [categoryFilter] : []
  );

  if (rows.length === 0) {
    return sendSuccess(response, categoryFilter ? defaultHeadlines.filter(h => h.category === categoryFilter) : defaultHeadlines);
  }

  return sendSuccess(response, rows.map((r) => ({
    id: r.id,
    category: r.category,
    code: r.code,
    title: r.label,
    message: r.description || '',
    configuration: r.configuration ? (typeof r.configuration === 'string' ? JSON.parse(r.configuration) : r.configuration) : null,
    sortOrder: r.sort_order,
    isActive: Boolean(r.is_active),
    createdAt: r.created_at,
  })));
}));

const headlineSchema = z.object({
  category: z.enum(['HEADLINE', 'NOTICE_BOARD', 'TICKER']).default('HEADLINE'),
  code: z.string().trim().optional(),
  title: z.string().trim().min(2).max(200),
  message: z.string().trim().min(2).max(1000),
  targetRoles: z.array(z.string()).optional(),
  speed: z.enum(['Slow', 'Normal', 'Fast']).optional(),
  targetAudience: z.string().optional(),
  noticeType: z.enum(['Information', 'Important', 'Urgent Alert']).optional(),
  publishDate: z.string().optional(),
  expiryDate: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isActive: z.boolean().default(true),
});

headlineRouter.post('/', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const input = headlineSchema.parse(request.body);
  const id = randomUUID();
  const code = input.code || `${input.category.slice(0, 2)}_${Math.floor(100 + Math.random() * 900)}`;
  const config = JSON.stringify({
    targetRoles: input.targetRoles || ['ALL'],
    speed: input.speed || 'Normal',
    targetAudience: input.targetAudience || 'All Users',
    noticeType: input.noticeType || 'Information',
    publishDate: input.publishDate || null,
    expiryDate: input.expiryDate || null,
  });

  await pool.execute(
    `INSERT INTO master_data (id, category, code, label, description, configuration, sort_order, is_active, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, input.category, code, input.title, input.message, config, input.sortOrder, input.isActive, request.auth!.userId]
  );

  return sendSuccess(response, { id, category: input.category, code, title: input.title, message: input.message, configuration: JSON.parse(config), isActive: input.isActive }, 201);
}));

const updateHeadlineSchema = headlineSchema.partial();

headlineRouter.patch('/:id', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const input = updateHeadlineSchema.parse(request.body);

  const [existing] = await pool.query<HeadlineRow[]>(
    'SELECT * FROM master_data WHERE id = ? AND category IN ("HEADLINE", "NOTICE_BOARD", "TICKER")',
    [id]
  );
  if (existing.length === 0) throw new ApiError(404, 'HEADLINE_NOT_FOUND', 'Headline notice not found');

  const current = existing[0];
  if (!current) throw new ApiError(404, 'HEADLINE_NOT_FOUND', 'Headline notice not found');

  const currentConfig = current.configuration ? (typeof current.configuration === 'string' ? JSON.parse(current.configuration) : current.configuration) : {};
  
  const newConfig = JSON.stringify({
    ...currentConfig,
    ...(input.targetRoles !== undefined && { targetRoles: input.targetRoles }),
    ...(input.speed !== undefined && { speed: input.speed }),
    ...(input.targetAudience !== undefined && { targetAudience: input.targetAudience }),
    ...(input.noticeType !== undefined && { noticeType: input.noticeType }),
    ...(input.publishDate !== undefined && { publishDate: input.publishDate }),
    ...(input.expiryDate !== undefined && { expiryDate: input.expiryDate }),
  });

  const newTitle = input.title !== undefined ? input.title : current.label;
  const newMessage = input.message !== undefined ? input.message : (current.description || '');
  const newSortOrder = input.sortOrder !== undefined ? input.sortOrder : current.sort_order;
  const newIsActive = input.isActive !== undefined ? input.isActive : Boolean(current.is_active);

  await pool.execute(
    `UPDATE master_data SET label = ?, description = ?, configuration = ?, sort_order = ?, is_active = ? WHERE id = ?`,
    [newTitle, newMessage, newConfig, newSortOrder, newIsActive, id]
  );

  return sendSuccess(response, { id, title: newTitle, message: newMessage, configuration: JSON.parse(newConfig), isActive: newIsActive });
}));

headlineRouter.patch('/:id/status', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const [existing] = await pool.query<HeadlineRow[]>(
    'SELECT is_active FROM master_data WHERE id = ? AND category IN ("HEADLINE", "NOTICE_BOARD", "TICKER")',
    [id]
  );
  const row = existing[0];
  if (!row) throw new ApiError(404, 'HEADLINE_NOT_FOUND', 'Headline notice not found');

  const nextStatus = !Boolean(row.is_active);
  await pool.execute('UPDATE master_data SET is_active = ? WHERE id = ?', [nextStatus, id]);

  return sendSuccess(response, { id, isActive: nextStatus });
}));

headlineRouter.delete('/:id', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => {
  const id = request.params.id as string;
  const [res] = await pool.execute<ResultSetHeader>('DELETE FROM master_data WHERE id = ? AND category IN ("HEADLINE", "NOTICE_BOARD", "TICKER")', [id]);
  if (res.affectedRows === 0) throw new ApiError(404, 'HEADLINE_NOT_FOUND', 'Headline notice not found');
  return sendSuccess(response, { deleted: true });
}));
