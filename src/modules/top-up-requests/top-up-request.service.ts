import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { pool, withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import { contextFromAuth, writeAuditLog } from '../../shared/audit.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';

const uploadRoot = path.resolve(process.cwd(), 'uploads', 'top-ups');
mkdirSync(uploadRoot, { recursive: true });

interface TopUpRow extends RowDataPacket {
  id: string; request_reference: string; party_id: string; wallet_id: string; amount: string | number;
  payment_mode: string; payment_reference: string; remarks: string | null; proof_storage_key: string;
  proof_original_filename: string; proof_mime_type: string; proof_size_bytes: number; status: string;
  review_remarks: string | null; reviewed_at: Date | null; ledger_entry_id: string | null; created_at: Date;
  retailer_name: string; retailer_code: string; requester_name: string; reviewer_name: string | null;
}

const isAdmin = (actor: AuthenticatedUser) => actor.roles.includes('ADMIN') || actor.roles.includes('SUPER_ADMIN');
const mapRow = (r: TopUpRow) => ({
  id: r.id, requestReference: r.request_reference, retailerId: r.party_id, retailerCode: r.retailer_code,
  retailerName: r.retailer_name, walletId: r.wallet_id, amount: Number(r.amount), paymentMode: r.payment_mode,
  paymentReference: r.payment_reference, remarks: r.remarks ?? '', proofName: r.proof_original_filename,
  proofMimeType: r.proof_mime_type, proofSizeBytes: r.proof_size_bytes, status: r.status,
  requesterName: r.requester_name, reviewRemarks: r.review_remarks, reviewedAt: r.reviewed_at,
  reviewedBy: r.reviewer_name, ledgerEntryId: r.ledger_entry_id, createdAt: r.created_at,
});

const selectSql = `SELECT t.*, p.display_name retailer_name, p.code retailer_code,
 req.full_name requester_name, rev.full_name reviewer_name FROM wallet_top_up_requests t
 JOIN parties p ON p.id=t.party_id JOIN users req ON req.id=t.requested_by_user_id
 LEFT JOIN users rev ON rev.id=t.reviewed_by_user_id`;

export async function createTopUp(input: { amount: number; paymentMode: string; paymentReference: string; remarks?: string | undefined; file: Express.Multer.File }, actor: AuthenticatedUser) {
  if (!actor.partyId || !actor.roles.includes('RETAILER')) throw new ApiError(403, 'RETAILER_ONLY', 'Only a linked Retailer account can submit a top-up request');
  const [partyRows] = await pool.query<(RowDataPacket & { party_type: string; party_status: string })[]>(
    `SELECT p.party_type,p.account_status party_status FROM parties p WHERE p.id=? AND p.deleted_at IS NULL LIMIT 1`, [actor.partyId]);
  const party = partyRows[0];
  if (!party || party.party_type !== 'RETAILER') throw new ApiError(403, 'RETAILER_ONLY', 'Your login is not linked to a valid Retailer account');
  if (party.party_status !== 'ACTIVE') throw new ApiError(400, 'RETAILER_INACTIVE', 'The Retailer account must be active before requesting a wallet top-up');

  // Older seeded/legacy Retailers may pre-date automatic wallet provisioning.
  // The party identity and ACTIVE Retailer status are verified above; the unique
  // party/currency key makes this safe if two first requests arrive together.
  await pool.execute(
    `INSERT INTO wallets (id,party_id,currency,status,available_balance,hold_balance,ledger_balance)
     VALUES (?,?,'INR','ACTIVE',0,0,0)
     ON DUPLICATE KEY UPDATE party_id=VALUES(party_id)`,
    [randomUUID(), actor.partyId],
  );
  const [walletRows] = await pool.query<(RowDataPacket & { wallet_id: string; wallet_status: string })[]>(
    `SELECT id wallet_id,status wallet_status FROM wallets WHERE party_id=? AND currency='INR' LIMIT 1`, [actor.partyId]);
  const wallet = walletRows[0];
  if (!wallet) throw new ApiError(500, 'WALLET_PROVISIONING_FAILED', 'The Retailer wallet could not be prepared. Please contact support');
  if (wallet.wallet_status !== 'ACTIVE') throw new ApiError(400, 'WALLET_INACTIVE', 'The Retailer wallet must be active before requesting a top-up');
  const id = randomUUID();
  const storageKey = `${id}${path.extname(input.file.originalname).toLowerCase()}`;
  const absolutePath = path.join(uploadRoot, storageKey);
  writeFileSync(absolutePath, input.file.buffer, { flag: 'wx' });
  const reference = input.paymentReference.trim().toUpperCase();
  const requestReference = `TUP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${id.slice(0,8).toUpperCase()}`;
  try {
    await pool.execute(`INSERT INTO wallet_top_up_requests
      (id,request_reference,party_id,wallet_id,requested_by_user_id,amount,payment_mode,payment_reference,remarks,proof_storage_key,proof_original_filename,proof_mime_type,proof_size_bytes,proof_checksum_sha256)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, requestReference, actor.partyId, wallet.wallet_id, actor.userId, input.amount, input.paymentMode, reference, input.remarks?.trim() || null, storageKey, input.file.originalname, input.file.mimetype, input.file.size, createHash('sha256').update(input.file.buffer).digest('hex')]);
  } catch (error: unknown) {
    if (existsSync(absolutePath)) unlinkSync(absolutePath);
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'DUPLICATE_PAYMENT_REFERENCE', 'This payment reference has already been submitted');
    throw error;
  }
  await writeAuditLog({ action: 'TOP_UP_REQUEST_CREATED', resourceType: 'WALLET_TOP_UP', resourceId: id, afterData: { requestReference, amount: input.amount, paymentMode: input.paymentMode, paymentReference: reference } }, contextFromAuth(actor));
  return getTopUp(id, actor);
}

export async function listTopUps(filters: { status?: string | undefined; search?: string | undefined; page: number; pageSize: number }, actor: AuthenticatedUser) {
  const where: string[] = []; const params: unknown[] = [];
  if (!isAdmin(actor)) { if (!actor.partyId) throw new ApiError(403, 'ACCESS_DENIED', 'No party linked'); where.push('t.party_id=?'); params.push(actor.partyId); }
  if (filters.status && filters.status !== 'ALL') { where.push('t.status=?'); params.push(filters.status); }
  if (filters.search?.trim()) { const q=`%${filters.search.trim()}%`; where.push('(t.request_reference LIKE ? OR t.payment_reference LIKE ? OR p.display_name LIKE ? OR p.code LIKE ?)'); params.push(q,q,q,q); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const page=Math.max(1,filters.page); const pageSize=Math.min(100,Math.max(1,filters.pageSize)); const offset=(page-1)*pageSize;
  const [counts] = await pool.query<(RowDataPacket & { total:number; pending:number; approved:number; rejected:number })[]>(`SELECT COUNT(*) total,SUM(t.status='PENDING') pending,SUM(t.status='APPROVED') approved,SUM(t.status='REJECTED') rejected FROM wallet_top_up_requests t JOIN parties p ON p.id=t.party_id ${clause}`, params);
  const [rows] = await pool.query<TopUpRow[]>(`${selectSql} ${clause} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`, [...params,pageSize,offset]);
  const c=counts[0]; return { items: rows.map(mapRow), summary:{ total:Number(c?.total||0), pending:Number(c?.pending||0), approved:Number(c?.approved||0), rejected:Number(c?.rejected||0) }, pagination:{page,pageSize,totalItems:Number(c?.total||0),totalPages:Math.max(1,Math.ceil(Number(c?.total||0)/pageSize))} };
}

export async function getTopUp(id: string, actor: AuthenticatedUser) {
  const [rows] = await pool.query<TopUpRow[]>(`${selectSql} WHERE t.id=? LIMIT 1`, [id]); const row=rows[0];
  if (!row) throw new ApiError(404,'TOP_UP_NOT_FOUND','Top-up request was not found');
  if (!isAdmin(actor) && row.party_id !== actor.partyId) throw new ApiError(403,'ACCESS_DENIED','You cannot access this top-up request');
  return mapRow(row);
}

export async function getProof(id: string, actor: AuthenticatedUser) {
  const [rows] = await pool.query<TopUpRow[]>(`${selectSql} WHERE t.id=? LIMIT 1`,[id]); const row=rows[0];
  if (!row) throw new ApiError(404,'TOP_UP_NOT_FOUND','Top-up request was not found');
  if (!isAdmin(actor) && row.party_id !== actor.partyId) throw new ApiError(403,'ACCESS_DENIED','You cannot access this proof');
  const filePath=path.join(uploadRoot,path.basename(row.proof_storage_key)); if(!existsSync(filePath)) throw new ApiError(404,'PROOF_NOT_FOUND','Payment proof file was not found');
  return { stream:createReadStream(filePath), filename:row.proof_original_filename, mimeType:row.proof_mime_type };
}

export async function reviewTopUp(id: string, input: { decision:'APPROVED'|'REJECTED'; remarks:string }, actor: AuthenticatedUser) {
  if (!isAdmin(actor)) throw new ApiError(403,'ACCESS_DENIED','Only Admin can review top-up requests');
  const result = await withTransaction(async connection => {
    const [requests]=await connection.query<TopUpRow[]>('SELECT * FROM wallet_top_up_requests WHERE id=? FOR UPDATE',[id]); const request=requests[0];
    if(!request) throw new ApiError(404,'TOP_UP_NOT_FOUND','Top-up request was not found');
    if(request.status!=='PENDING') throw new ApiError(409,'TOP_UP_ALREADY_REVIEWED',`This request is already ${request.status}`);
    let ledgerEntryId:string|null=null;
    if(input.decision==='APPROVED') {
      const [wallets]=await connection.query<(RowDataPacket & { id:string;party_id:string;status:string;available_balance:string;hold_balance:string;ledger_balance:string })[]>('SELECT id,party_id,status,available_balance,hold_balance,ledger_balance FROM wallets WHERE id=? FOR UPDATE',[request.wallet_id]); const wallet=wallets[0];
      if(!wallet) throw new ApiError(404,'WALLET_NOT_FOUND','Retailer wallet was not found'); if(wallet.status!=='ACTIVE') throw new ApiError(400,'WALLET_INACTIVE','Only an active wallet can be credited');
      const amount=Number(request.amount), before=Number(wallet.available_balance), hold=Number(wallet.hold_balance), after=before+amount; ledgerEntryId=randomUUID();
      await connection.execute('UPDATE wallets SET available_balance=?,ledger_balance=?,version=version+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?',[after,after+hold,wallet.id]);
      await connection.execute(`INSERT INTO ledger_entries (id,wallet_id,party_id,entry_type,amount,available_balance_before,available_balance_after,hold_balance_before,hold_balance_after,reference_type,reference_id,narration,created_by_user_id) VALUES (?,?,?,'CREDIT',?,?,?,?,?,'TOP_UP_REQUEST',?,?,?)`,[ledgerEntryId,wallet.id,wallet.party_id,amount,before,after,hold,hold,request.request_reference,`Approved wallet top-up (${request.payment_reference})`,actor.userId]);
      await writeAuditLog({ action:'WALLET_CREDIT',resourceType:'WALLET',resourceId:wallet.id,beforeData:{availableBalance:before,holdBalance:hold},afterData:{availableBalance:after,holdBalance:hold},metadata:{amount,topUpRequestId:id,requestReference:request.request_reference,paymentReference:request.payment_reference} },contextFromAuth(actor),connection);
    }
    await connection.execute('UPDATE wallet_top_up_requests SET status=?,review_remarks=?,reviewed_by_user_id=?,reviewed_at=CURRENT_TIMESTAMP(6),ledger_entry_id=? WHERE id=?',[input.decision,input.remarks.trim(),actor.userId,ledgerEntryId,id]);
    await writeAuditLog({action:`TOP_UP_REQUEST_${input.decision}`,resourceType:'WALLET_TOP_UP',resourceId:id,beforeData:{status:'PENDING'},afterData:{status:input.decision,ledgerEntryId},metadata:{remarks:input.remarks.trim()}},contextFromAuth(actor),connection);
    return { id,status:input.decision,ledgerEntryId };
  });
  return result;
}
