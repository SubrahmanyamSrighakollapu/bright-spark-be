import { randomBytes, randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate } from '../../middleware/auth.js';
import { ApiError } from '../../shared/api-error.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { contextFromAuth, writeAuditLog } from '../../shared/audit.js';
import { sendSuccess } from '../../shared/response.js';

export const paymentLinkRouter = Router();
export const publicPaymentLinkRouter = Router();

const createSchema = z.object({
  description: z.string().trim().min(2).max(300),
  fixedAmount: z.coerce.number().positive().max(2_000_000).nullable().optional(),
  expiresAt: z.string().datetime(),
}).superRefine((value, context) => {
  if (new Date(value.expiresAt).getTime() <= Date.now()) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Expiry must be in the future' });
});
const paymentSchema = z.object({
  payerName: z.string().trim().min(2).max(160),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  email: z.string().trim().email().optional().or(z.literal('')),
  amount: z.coerce.number().positive().max(2_000_000),
  paymentMethodId: z.string().uuid(),
  clientRequestId: z.string().trim().min(8).max(100),
});

function mapLink(row: RowDataPacket) {
  const expired = new Date(row.expires_at).getTime() <= Date.now();
  return { id: row.id, token: row.token, retailerId: row.party_id, businessName: row.business_name,
    description: row.description, fixedAmount: row.fixed_amount == null ? undefined : Number(row.fixed_amount),
    expiresAt: row.expires_at, status: expired ? 'EXPIRED' : row.status, createdAt: row.created_at,
    paymentCount: Number(row.payment_count ?? 0), collectedAmount: Number(row.collected_amount ?? 0) };
}
function mapPayment(row: RowDataPacket) {
  return { id: row.id, reference: row.payment_reference, linkDescription: row.description,
    payerName: row.payer_name, mobile: row.payer_mobile, email: row.payer_email ?? undefined,
    amount: Number(row.amount), paymentMethod: row.payment_method_name ?? row.payment_method_code,
    status: row.status, createdAt: row.created_at };
}

paymentLinkRouter.use(authenticate);
paymentLinkRouter.get('/', asyncHandler(async (request, response) => {
  if (!request.auth!.partyId || !request.auth!.roles.includes('RETAILER')) throw new ApiError(403, 'RETAILER_ONLY', 'Only Retailers can manage payment links');
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT l.*,COUNT(p.id) payment_count,
    COALESCE(SUM(CASE WHEN p.status='SUCCESS' THEN p.amount ELSE 0 END),0) collected_amount
    FROM payment_links l LEFT JOIN payment_link_payments p ON p.payment_link_id=l.id
    WHERE l.party_id=? GROUP BY l.id ORDER BY l.created_at DESC`, [request.auth!.partyId]);
  return sendSuccess(response, rows.map(mapLink));
}));
paymentLinkRouter.get('/payments', asyncHandler(async (request, response) => {
  if (!request.auth!.partyId || !request.auth!.roles.includes('RETAILER')) throw new ApiError(403, 'RETAILER_ONLY', 'Only Retailers can view payment-link collections');
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT p.*,l.description,m.method_name payment_method_name
    FROM payment_link_payments p JOIN payment_links l ON l.id=p.payment_link_id
    LEFT JOIN payment_methods m ON m.id=p.payment_method_id WHERE p.party_id=? ORDER BY p.created_at DESC LIMIT 100`, [request.auth!.partyId]);
  return sendSuccess(response, rows.map(mapPayment));
}));
paymentLinkRouter.post('/', asyncHandler(async (request, response) => {
  if (!request.auth!.partyId || !request.auth!.roles.includes('RETAILER')) throw new ApiError(403, 'RETAILER_ONLY', 'Only Retailers can create payment links');
  const input = createSchema.parse(request.body);
  const [parties] = await pool.query<RowDataPacket[]>("SELECT display_name,account_status FROM parties WHERE id=? AND party_type='RETAILER' AND deleted_at IS NULL", [request.auth!.partyId]);
  const party = parties[0];
  if (!party || party.account_status !== 'ACTIVE') throw new ApiError(403, 'RETAILER_INACTIVE', 'An active Retailer account is required');
  const id = randomUUID(); const token = randomBytes(24).toString('hex');
  await pool.execute(`INSERT INTO payment_links (id,token,party_id,created_by_user_id,business_name,description,fixed_amount,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`, [id, token, request.auth!.partyId, request.auth!.userId, party.display_name, input.description, input.fixedAmount ?? null, new Date(input.expiresAt)]);
  await writeAuditLog({ action: 'PAYMENT_LINK_CREATED', resourceType: 'PAYMENT_LINK', resourceId: id, afterData: { description: input.description, fixedAmount: input.fixedAmount, expiresAt: input.expiresAt } }, contextFromAuth(request.auth!));
  const [rows] = await pool.query<RowDataPacket[]>('SELECT *,0 payment_count,0 collected_amount FROM payment_links WHERE id=?', [id]);
  return sendSuccess(response, mapLink(rows[0]!), 201);
}));
paymentLinkRouter.patch('/:id/status', asyncHandler(async (request, response) => {
  if (!request.auth!.partyId || !request.auth!.roles.includes('RETAILER')) throw new ApiError(403, 'RETAILER_ONLY', 'Only Retailers can manage payment links');
  const id = z.string().uuid().parse(request.params.id); const { status } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']) }).parse(request.body);
  const [result] = await pool.execute<ResultSetHeader>('UPDATE payment_links SET status=? WHERE id=? AND party_id=?', [status, id, request.auth!.partyId]);
  if (!result.affectedRows) throw new ApiError(404, 'PAYMENT_LINK_NOT_FOUND', 'Payment link was not found');
  await writeAuditLog({ action: `PAYMENT_LINK_${status}`, resourceType: 'PAYMENT_LINK', resourceId: id, afterData: { status } }, contextFromAuth(request.auth!));
  return sendSuccess(response, { id, status });
}));

publicPaymentLinkRouter.get('/:token', asyncHandler(async (request, response) => {
  const token = z.string().regex(/^[a-f0-9]{48}$/).parse(request.params.token);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT *,0 payment_count,0 collected_amount FROM payment_links WHERE token=? LIMIT 1', [token]);
  const row = rows[0]; if (!row) throw new ApiError(404, 'PAYMENT_LINK_NOT_FOUND', 'This payment link is invalid');
  const link = mapLink(row);
  if (link.status !== 'ACTIVE') throw new ApiError(410, 'PAYMENT_LINK_UNAVAILABLE', link.status === 'EXPIRED' ? 'This payment link has expired' : 'This payment link is inactive');
  const [methods] = await pool.query<RowDataPacket[]>(`SELECT DISTINCT m.id,m.method_name name,m.method_code code
    FROM payment_methods m JOIN gateway_method_mappings gm ON gm.method_id=m.id AND gm.is_active=TRUE
    JOIN payment_gateways g ON g.id=gm.gateway_id AND g.is_active=TRUE WHERE m.is_active=TRUE ORDER BY m.method_name`);
  return sendSuccess(response, { link, paymentMethods: methods });
}));
publicPaymentLinkRouter.post('/:token/payments', asyncHandler(async (request, response) => {
  const token = z.string().regex(/^[a-f0-9]{48}$/).parse(request.params.token); const input = paymentSchema.parse(request.body);
  const result = await withTransaction(async (connection) => {
    const [links] = await connection.query<RowDataPacket[]>('SELECT * FROM payment_links WHERE token=? FOR UPDATE', [token]); const link = links[0];
    if (!link) throw new ApiError(404, 'PAYMENT_LINK_NOT_FOUND', 'This payment link is invalid');
    if (link.status !== 'ACTIVE' || new Date(link.expires_at).getTime() <= Date.now()) throw new ApiError(410, 'PAYMENT_LINK_UNAVAILABLE', 'This payment link is inactive or expired');
    const expected = link.fixed_amount == null ? input.amount : Number(link.fixed_amount);
    if (Math.abs(expected - input.amount) > 0.009) throw new ApiError(422, 'PAYMENT_AMOUNT_MISMATCH', 'The amount does not match this payment link');
    const [methods] = await connection.query<RowDataPacket[]>(`SELECT DISTINCT m.id,m.method_code FROM payment_methods m
      JOIN gateway_method_mappings gm ON gm.method_id=m.id AND gm.is_active=TRUE JOIN payment_gateways g ON g.id=gm.gateway_id AND g.is_active=TRUE
      WHERE m.id=? AND m.is_active=TRUE LIMIT 1`, [input.paymentMethodId]); const method = methods[0];
    if (!method) throw new ApiError(422, 'PAYMENT_METHOD_UNAVAILABLE', 'Selected payment method is unavailable');
    const [existing] = await connection.query<RowDataPacket[]>('SELECT * FROM payment_link_payments WHERE client_request_id=? LIMIT 1', [input.clientRequestId]);
    if (existing[0]) return { reference: existing[0].payment_reference, amount: Number(existing[0].amount), status: existing[0].status };
    const id = randomUUID(); const reference = `QSPL${new Date().toISOString().slice(0,10).replaceAll('-','')}${id.slice(0,8).toUpperCase()}`;
    await connection.execute(`INSERT INTO payment_link_payments (id,payment_reference,client_request_id,payment_link_id,party_id,payer_name,payer_mobile,payer_email,amount,payment_method_id,payment_method_code)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id, reference, input.clientRequestId, link.id, link.party_id, input.payerName, input.mobile, input.email || null, input.amount, method.id, method.method_code]);
    return { reference, amount: input.amount, status: 'PENDING' as const };
  });
  return sendSuccess(response, result, 201);
}));
