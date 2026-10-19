import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool } from '../../database/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { renderInvoiceTemplate } from './invoice.service.js';

export const invoiceRouter = Router();
invoiceRouter.use(authenticate);
const adminOnly = (roles: string[]) => roles.includes('ADMIN') || roles.includes('SUPER_ADMIN');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (_req, file, cb) => {
  const extension = file.originalname.toLowerCase();
  const allowed = file.mimetype === 'text/html' || file.mimetype === 'image/png' || file.mimetype === 'image/jpeg'
    || extension.endsWith('.html') || extension.endsWith('.htm') || extension.endsWith('.png') || extension.endsWith('.jpg') || extension.endsWith('.jpeg');
  if (allowed) cb(null, true);
  else cb(new Error('Only HTML, PNG, and JPG invoice templates are supported'));
} });

const imageInvoiceTemplate = (mimeType: string, buffer: Buffer): string => `<!doctype html><html><head><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;padding:28px;font-family:Arial,sans-serif;color:#172033;background:#fff}.sheet{max-width:900px;margin:auto}
  .template-image{display:block;width:100%;max-height:620px;object-fit:contain;object-position:center top;margin-bottom:24px}
  .details{border:1px solid #dbe3ee;border-radius:12px;overflow:hidden}.title{padding:16px 20px;background:#174f86;color:#fff;font-size:20px;font-weight:700}
  .grid{display:grid;grid-template-columns:1fr 1fr}.field{padding:12px 20px;border-bottom:1px solid #e7edf4}.field:nth-child(odd){border-right:1px solid #e7edf4}
  .label{display:block;color:#64748b;font-size:11px;text-transform:uppercase;margin-bottom:4px}.value{font-size:14px;font-weight:700}.total{font-size:18px;color:#174f86}
  @media print{body{padding:0}.sheet{max-width:none}}
  </style></head><body><main class="sheet"><img class="template-image" src="data:${mimeType};base64,${buffer.toString('base64')}" alt="Invoice template">
  <section class="details"><div class="title">Invoice {{invoiceNumber}}</div><div class="grid">
  <div class="field"><span class="label">Transaction Reference</span><span class="value">{{transactionReference}}</span></div>
  <div class="field"><span class="label">Invoice Date</span><span class="value">{{invoiceDate}}</span></div>
  <div class="field"><span class="label">Customer</span><span class="value">{{customerName}} / {{customerMobile}}</span></div>
  <div class="field"><span class="label">Service</span><span class="value">{{serviceCategory}} - {{serviceProduct}}</span></div>
  <div class="field"><span class="label">Payment Method</span><span class="value">{{paymentMethod}}</span></div>
  <div class="field"><span class="label">Status</span><span class="value">{{status}}</span></div>
  <div class="field"><span class="label">Amount</span><span class="value">INR {{amount}}</span></div>
  <div class="field"><span class="label">Charges + GST</span><span class="value">INR {{totalDeductions}}</span></div>
  <div class="field" style="grid-column:1/-1;border-right:0"><span class="label">Net Amount</span><span class="value total">INR {{netAmount}}</span></div>
  </div></section></main></body></html>`;

const mapTemplate = (row: RowDataPacket) => ({ id: row.id, categoryId: row.service_category_id, categoryCode: row.category_code,
  categoryName: row.category_name, templateName: row.template_name, fileName: row.original_file_name,
  isActive: Boolean(row.is_active), updatedAt: row.updated_at });

invoiceRouter.get('/service-templates', asyncHandler(async (req, res) => {
  if (!adminOnly(req.auth!.roles)) throw new ApiError(403, 'ACCESS_DENIED', 'Admin access is required');
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT t.*,c.code category_code,c.name category_name
    FROM service_invoice_templates t JOIN service_catalog_categories c ON c.id=t.service_category_id
    ORDER BY c.name`);
  return sendSuccess(res, rows.map(mapTemplate));
}));

invoiceRouter.post('/service-templates', upload.single('template'), asyncHandler(async (req, res) => {
  if (!adminOnly(req.auth!.roles)) throw new ApiError(403, 'ACCESS_DENIED', 'Admin access is required');
  const input = z.object({ categoryId: z.string().uuid(), templateName: z.string().trim().min(2).max(160) }).parse(req.body);
  if (!req.file) throw new ApiError(400, 'TEMPLATE_REQUIRED', 'Select an HTML invoice template');
  const isImage = req.file.mimetype === 'image/png' || req.file.mimetype === 'image/jpeg';
  const html = isImage ? imageInvoiceTemplate(req.file.mimetype, req.file.buffer) : req.file.buffer.toString('utf8').trim();
  if (!isImage && (!html.toLowerCase().includes('<html') || !html.includes('{{transactionReference}}'))) {
    throw new ApiError(422, 'INVALID_TEMPLATE', 'HTML templates must include {{transactionReference}}');
  }
  const [categories] = await pool.query<RowDataPacket[]>('SELECT id FROM service_catalog_categories WHERE id=?', [input.categoryId]);
  if (!categories[0]) throw new ApiError(404, 'CATEGORY_NOT_FOUND', 'Service category was not found');
  const id = randomUUID();
  await pool.execute(`INSERT INTO service_invoice_templates
    (id,service_category_id,template_name,original_file_name,mime_type,template_html,is_active,created_by,updated_by)
    VALUES (?,?,?,?,?,?,TRUE,?,?) ON DUPLICATE KEY UPDATE template_name=VALUES(template_name),original_file_name=VALUES(original_file_name),
    mime_type=VALUES(mime_type),template_html=VALUES(template_html),is_active=TRUE,updated_by=VALUES(updated_by)`,
    [id,input.categoryId,input.templateName,req.file.originalname,req.file.mimetype,html,req.auth!.userId,req.auth!.userId]);
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT t.*,c.code category_code,c.name category_name
    FROM service_invoice_templates t JOIN service_catalog_categories c ON c.id=t.service_category_id
    WHERE t.service_category_id=?`, [input.categoryId]);
  return sendSuccess(res, mapTemplate(rows[0]!), 201);
}));

invoiceRouter.patch('/service-templates/:id/status', asyncHandler(async (req, res) => {
  if (!adminOnly(req.auth!.roles)) throw new ApiError(403, 'ACCESS_DENIED', 'Admin access is required');
  const id = z.string().uuid().parse(req.params.id); const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
  const [result] = await pool.execute<ResultSetHeader>('UPDATE service_invoice_templates SET is_active=?,updated_by=? WHERE id=?', [isActive, req.auth!.userId, id]);
  if (!result.affectedRows) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Invoice template was not found');
  return sendSuccess(res, { id, isActive });
}));

invoiceRouter.get('/transactions/:transactionId', asyncHandler(async (req, res) => {
  const transactionId = z.string().uuid().parse(req.params.transactionId);
  const admin = adminOnly(req.auth!.roles); const params: unknown[] = [transactionId];
  const scope = admin ? '' : ' AND i.party_id=?'; if (!admin) params.push(req.auth!.partyId);
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT i.* FROM transaction_invoices i WHERE i.transaction_id=?${scope} LIMIT 1`, params);
  if (!rows[0]) throw new ApiError(404, 'INVOICE_NOT_FOUND', 'No configured invoice was generated for this transaction');
  const row = rows[0]; return sendSuccess(res, { id: row.id, invoiceNumber: row.invoice_number, transactionId: row.transaction_id,
    status: row.invoice_status, data: typeof row.invoice_data === 'string' ? JSON.parse(row.invoice_data) : row.invoice_data,
    renderedHtml: row.rendered_html, createdAt: row.created_at });
}));

invoiceRouter.post('/service-templates/:id/preview', asyncHandler(async (req, res) => {
  if (!adminOnly(req.auth!.roles)) throw new ApiError(403, 'ACCESS_DENIED', 'Admin access is required');
  const id = z.string().uuid().parse(req.params.id); const [rows] = await pool.query<RowDataPacket[]>('SELECT template_html FROM service_invoice_templates WHERE id=?', [id]);
  if (!rows[0]) throw new ApiError(404, 'TEMPLATE_NOT_FOUND', 'Invoice template was not found');
  return sendSuccess(res, { renderedHtml: renderInvoiceTemplate(rows[0].template_html, { invoiceNumber:'BSP-INV-PREVIEW',transactionReference:'BSPIN-PREVIEW-001',invoiceDate:new Date().toLocaleDateString('en-IN'),customerName:'Sample Customer',customerMobile:'9876543210',serviceCategory:'Sample Service',serviceProduct:'Sample Product',paymentMethod:'UPI',amount:'1000.00',charge:'17.50',gst:'3.15',totalDeductions:'20.65',netAmount:'979.35',status:'PENDING' }) });
}));
