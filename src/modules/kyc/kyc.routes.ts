import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { pool, withTransaction } from '../../database/pool.js';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { ApiError } from '../../shared/api-error.js';
import { sendSuccess } from '../../shared/response.js';

const uploadRoot = path.resolve(process.cwd(), 'uploads', 'kyc');
mkdirSync(uploadRoot, { recursive: true });
const acceptedMimeTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => callback(null, acceptedMimeTypes.has(file.mimetype)),
});

interface ApplicationRow extends RowDataPacket {
  id: string; party_id: string; application_reference: string; status: string; submitted_at: Date | null;
  decided_at: Date | null; decision_reason: string | null; created_at: Date; display_name: string; legal_name: string | null;
  party_type: string; code: string; reviewer_name: string | null;
}
interface DocumentRow extends RowDataPacket {
  id: string; application_id: string; document_type: string; document_number_masked: string | null;
  original_filename: string; mime_type: string; size_bytes: number; storage_key: string; status: string;
  rejection_reason: string | null; reviewed_at: Date | null; created_at: Date;
}

const listSchema = z.object({
  status: z.string().optional().default('ALL'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});
const idSchema = z.object({ id: z.string().uuid() });
const docParams = z.object({ appId: z.string().uuid(), docId: z.string().uuid() });
const uploadFields = z.object({ documentType: z.string().trim().min(1).max(100), documentNumberMasked: z.string().trim().max(100).optional() });
const remarksSchema = z.object({ remarks: z.string().trim().max(1000).optional() });
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(1000) });
const partyTypeQuery = z.object({ partyType: z.enum(['MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER']) });
const partyParams = z.object({ partyId: z.string().uuid() });

function statusForUi(value: string): string {
  return value === 'DRAFT' ? 'PENDING' : value === 'SUBMITTED' ? 'PENDING' : value === 'MORE_INFO_REQUIRED' ? 'REJECTED' : value;
}
function documentStatusForUi(value: string): string { return value === 'VERIFIED' ? 'VERIFIED' : value === 'REJECTED' ? 'REJECTED' : 'PENDING'; }

async function requirementsForParty(partyId: string) {
  const [partyRows] = await pool.query<(RowDataPacket & { party_type: string })[]>('SELECT party_type FROM parties WHERE id = ? AND deleted_at IS NULL', [partyId]);
  if (!partyRows[0]) throw new ApiError(404, 'PARTY_NOT_FOUND', 'Your account is not linked to an active party');
  return requirementsForPartyType(partyRows[0].party_type);
}

async function requirementsForPartyType(partyType: string) {
  const [rows] = await pool.query<(RowDataPacket & { id: string; code: string; label: string; description: string | null; configuration: unknown; sort_order: number })[]>(
    `SELECT id, code, label, description, configuration, sort_order FROM master_data
     WHERE category = 'KYC_DOCUMENT_TYPE' AND is_active = TRUE ORDER BY sort_order, label`,
  );
  return rows.filter((row) => {
    const config = typeof row.configuration === 'string' ? JSON.parse(row.configuration) : (row.configuration ?? {});
    return !Array.isArray(config.applicablePartyTypes) || config.applicablePartyTypes.includes(partyType);
  }).map((row) => ({ ...row, configuration: typeof row.configuration === 'string' ? JSON.parse(row.configuration) : (row.configuration ?? {}) }));
}

async function ensureApplication(partyId: string): Promise<string> {
  const [existing] = await pool.query<(RowDataPacket & { id: string })[]>('SELECT id FROM onboarding_applications WHERE party_id = ? LIMIT 1', [partyId]);
  if (existing[0]) return existing[0].id;
  const id = randomUUID();
  await pool.execute(
    `INSERT INTO onboarding_applications (id, party_id, application_reference, status) VALUES (?, ?, ?, 'DRAFT')`,
    [id, partyId, `KYC-${Date.now().toString(36).toUpperCase()}-${id.slice(0, 6).toUpperCase()}`],
  );
  return id;
}

async function getApplication(id: string) {
  const [rows] = await pool.query<ApplicationRow[]>(
    `SELECT a.*, p.display_name, p.legal_name, p.party_type, p.code, u.full_name reviewer_name
     FROM onboarding_applications a JOIN parties p ON p.id = a.party_id
     LEFT JOIN users u ON u.id = a.decided_by WHERE a.id = ?`, [id],
  );
  const app = rows[0];
  if (!app) throw new ApiError(404, 'KYC_APPLICATION_NOT_FOUND', 'KYC application was not found');
  const [documents] = await pool.query<DocumentRow[]>('SELECT * FROM kyc_documents WHERE application_id = ? ORDER BY created_at', [id]);
  const [events] = await pool.query<(RowDataPacket & { action: string; remarks: string | null; created_at: Date; actor_name: string })[]>(
    `SELECT e.action, e.remarks, e.created_at, u.full_name actor_name FROM approval_events e
     JOIN users u ON u.id = e.actor_user_id WHERE e.subject_type = 'KYC_APPLICATION' AND e.subject_id = ? ORDER BY e.created_at`, [id],
  );
  return {
    id: app.id, applicationReference: app.application_reference, entityId: app.party_id, entityCode: app.code,
    entityName: app.display_name, entityType: app.party_type,
    businessName: app.legal_name ?? app.display_name, businessType: app.party_type, panNumberMasked: '',
    status: statusForUi(app.status), submittedAt: app.submitted_at ?? app.created_at, reviewedAt: app.decided_at,
    reviewedBy: app.reviewer_name, remarks: app.decision_reason,
    documents: documents.map((doc) => ({ id: doc.id, type: doc.document_type, title: doc.document_type.replaceAll('_', ' '),
      documentNumberMasked: doc.document_number_masked ?? '', fileUrl: `/kyc/documents/${doc.id}/download`, uploadedAt: doc.created_at,
      status: documentStatusForUi(doc.status), rejectionReason: doc.rejection_reason, mimeType: doc.mime_type, fileName: doc.original_filename, sizeBytes: Number(doc.size_bytes) })),
    timeline: events.map((event) => ({ timestamp: event.created_at, event: event.action.replaceAll('_', ' '), user: event.actor_name, remarks: event.remarks })),
  };
}

function requirePartyId(partyId: string | null): string {
  if (!partyId) throw new ApiError(403, 'PARTY_REQUIRED', 'Your login is not linked to a network party');
  return partyId;
}

async function assertCanManagePartyKyc(partyId: string, auth: NonNullable<Express.Request['auth']>) {
  if (auth.roles.some((role) => role === 'ADMIN' || role === 'SUPER_ADMIN') || auth.permissions.includes('KYC_REVIEW')) return;
  const [rows] = await pool.query<(RowDataPacket & { created_by_user_id: string | null })[]>(
    'SELECT created_by_user_id FROM parties WHERE id = ? AND deleted_at IS NULL LIMIT 1', [partyId],
  );
  if (!rows[0]) throw new ApiError(404, 'PARTY_NOT_FOUND', 'The onboarding party was not found');
  if (rows[0].created_by_user_id !== auth.userId) {
    throw new ApiError(403, 'KYC_UPLOAD_FORBIDDEN', 'You can upload onboarding documents only for users created by your account');
  }
}

async function saveDocument(partyId: string, input: z.infer<typeof uploadFields>, file: Express.Multer.File) {
  const requirements = await requirementsForParty(partyId);
  const requirement = requirements.find((item) => item.code === input.documentType);
  if (!requirement) throw new ApiError(422, 'INVALID_DOCUMENT_TYPE', 'This document type is not configured for this account type');
  const configuration = requirement.configuration as { acceptedMimeTypes?: string[]; maxSizeMb?: number };
  if (configuration.acceptedMimeTypes?.length && !configuration.acceptedMimeTypes.includes(file.mimetype)) {
    throw new ApiError(422, 'INVALID_DOCUMENT_FORMAT', `${requirement.label} has an unsupported file format`);
  }
  const maxSizeBytes = (configuration.maxSizeMb ?? 5) * 1024 * 1024;
  if (file.size > maxSizeBytes) throw new ApiError(422, 'DOCUMENT_TOO_LARGE', `${requirement.label} must be within ${configuration.maxSizeMb ?? 5} MB`);
  const applicationId = await ensureApplication(partyId);
  const [apps] = await pool.query<(RowDataPacket & { status: string })[]>('SELECT status FROM onboarding_applications WHERE id = ?', [applicationId]);
  if (!['DRAFT', 'MORE_INFO_REQUIRED'].includes(apps[0]!.status)) throw new ApiError(409, 'KYC_NOT_EDITABLE', 'Documents cannot be changed while this application is under review');
  const id = randomUUID();
  const extension = file.mimetype === 'application/pdf' ? '.pdf' : file.mimetype === 'image/png' ? '.png' : '.jpg';
  const storageKey = `${partyId}/${id}${extension}`; const targetDir = path.join(uploadRoot, partyId); mkdirSync(targetDir, { recursive: true });
  const target = path.join(uploadRoot, storageKey); const checksum = createHash('sha256').update(file.buffer).digest('hex');
  const [oldRows] = await pool.query<DocumentRow[]>('SELECT * FROM kyc_documents WHERE application_id = ? AND document_type = ?', [applicationId, input.documentType]);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(target, file.buffer));
  try {
    await pool.execute(`INSERT INTO kyc_documents (id, application_id, document_type, document_number_masked, storage_key, original_filename, mime_type, size_bytes, checksum_sha256, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'UPLOADED') ON DUPLICATE KEY UPDATE id = VALUES(id), document_number_masked = VALUES(document_number_masked), storage_key = VALUES(storage_key), original_filename = VALUES(original_filename), mime_type = VALUES(mime_type), size_bytes = VALUES(size_bytes), checksum_sha256 = VALUES(checksum_sha256), status = 'UPLOADED', rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL`,
      [id, applicationId, input.documentType, input.documentNumberMasked ?? null, storageKey, file.originalname, file.mimetype, file.size, checksum]);
    const oldPath = oldRows[0] ? path.join(uploadRoot, oldRows[0].storage_key) : null;
    if (oldPath && oldPath !== target && existsSync(oldPath)) unlinkSync(oldPath);
  } catch (error) { if (existsSync(target)) unlinkSync(target); throw error; }
  return getApplication(applicationId);
}

async function submitForReview(partyId: string, actorUserId: string) {
  const applicationId = await ensureApplication(partyId); const requirements = await requirementsForParty(partyId);
  const requiredCodes = requirements.filter((item) => Boolean((item.configuration as { required?: boolean }).required)).map((item) => item.code);
  const [docs] = await pool.query<(RowDataPacket & { document_type: string })[]>('SELECT document_type FROM kyc_documents WHERE application_id = ?', [applicationId]);
  const uploaded = new Set(docs.map((doc) => doc.document_type)); const missing = requiredCodes.filter((code) => !uploaded.has(code));
  if (missing.length) throw new ApiError(422, 'KYC_DOCUMENTS_MISSING', `Upload all required documents: ${missing.join(', ')}`);
  await withTransaction(async (connection) => {
    await connection.execute(`UPDATE onboarding_applications SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP(6), decided_at = NULL, decided_by = NULL, decision_reason = NULL WHERE id = ? AND status IN ('DRAFT','MORE_INFO_REQUIRED')`, [applicationId]);
    await connection.execute(`UPDATE kyc_documents SET status = 'UNDER_REVIEW' WHERE application_id = ?`, [applicationId]);
    await connection.execute(`UPDATE parties SET kyc_status = 'PENDING' WHERE id = ?`, [partyId]);
    await connection.execute(`INSERT INTO approval_events (id, subject_type, subject_id, action, actor_user_id, remarks) VALUES (?, 'KYC_APPLICATION', ?, 'SUBMITTED', ?, 'KYC application submitted for review')`, [randomUUID(), applicationId, actorUserId]);
  });
  return getApplication(applicationId);
}

export const kycRouter = Router();
kycRouter.use(authenticate);

kycRouter.get('/requirements', asyncHandler(async (request, response) => sendSuccess(response, await requirementsForParty(requirePartyId(request.auth!.partyId)))));

kycRouter.get('/document-types', requirePermission('KYC_READ'), asyncHandler(async (request, response) => {
  const { partyType } = partyTypeQuery.parse(request.query);
  return sendSuccess(response, await requirementsForPartyType(partyType));
}));

kycRouter.get('/me', asyncHandler(async (request, response) => {
  const partyId = requirePartyId(request.auth!.partyId);
  return sendSuccess(response, await getApplication(await ensureApplication(partyId)));
}));

kycRouter.post('/documents', upload.single('file'), asyncHandler(async (request, response) => {
  const partyId = requirePartyId(request.auth!.partyId);
  const input = uploadFields.parse(request.body);
  if (!request.file) throw new ApiError(422, 'DOCUMENT_FILE_REQUIRED', 'Select a PDF, JPG or PNG file up to 5 MB');
  return sendSuccess(response, await saveDocument(partyId, input, request.file), 201);
}));

kycRouter.post('/parties/:partyId/documents', upload.single('file'), asyncHandler(async (request, response) => {
  const { partyId } = partyParams.parse(request.params); const input = uploadFields.parse(request.body);
  await assertCanManagePartyKyc(partyId, request.auth!);
  if (!request.file) throw new ApiError(422, 'DOCUMENT_FILE_REQUIRED', 'Select a PDF, JPG or PNG file up to 5 MB');
  return sendSuccess(response, await saveDocument(partyId, input, request.file), 201);
}));

kycRouter.post('/submit', asyncHandler(async (request, response) => {
  const partyId = requirePartyId(request.auth!.partyId);
  return sendSuccess(response, await submitForReview(partyId, request.auth!.userId));
}));

kycRouter.post('/parties/:partyId/submit', asyncHandler(async (request, response) => {
  const { partyId } = partyParams.parse(request.params);
  await assertCanManagePartyKyc(partyId, request.auth!);
  return sendSuccess(response, await submitForReview(partyId, request.auth!.userId));
}));

kycRouter.get('/applications', requirePermission('KYC_READ'), asyncHandler(async (request, response) => {
  const query = listSchema.parse(request.query); const conditions: string[] = []; const values: unknown[] = [];
  if (query.status !== 'ALL') {
    if (query.status === 'PENDING') conditions.push("a.status IN ('DRAFT','SUBMITTED')");
    else { conditions.push('a.status = ?'); values.push(query.status); }
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [ids] = await pool.query<(RowDataPacket & { id: string })[]>(`SELECT a.id FROM onboarding_applications a ${where} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`, [...values, query.pageSize, (query.page - 1) * query.pageSize]);
  const [count] = await pool.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) total FROM onboarding_applications a ${where}`, values);
  const items = await Promise.all(ids.map((row) => getApplication(row.id))); const totalItems = Number(count[0]?.total ?? 0);
  return sendSuccess(response, { items, pagination: { page: query.page, pageSize: query.pageSize, totalItems, totalPages: Math.ceil(totalItems / query.pageSize) || 1 } });
}));

kycRouter.get('/applications/:id', requirePermission('KYC_READ'), asyncHandler(async (request, response) => sendSuccess(response, await getApplication(idSchema.parse(request.params).id))));

kycRouter.post('/applications/:appId/docs/:docId/verify', requirePermission('KYC_REVIEW'), asyncHandler(async (request, response) => {
  const { appId, docId } = docParams.parse(request.params);
  await pool.execute(`UPDATE kyc_documents SET status = 'VERIFIED', rejection_reason = NULL, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND application_id = ?`, [request.auth!.userId, docId, appId]);
  await pool.execute(`UPDATE onboarding_applications SET status = 'UNDER_REVIEW' WHERE id = ? AND status = 'SUBMITTED'`, [appId]);
  return sendSuccess(response, await getApplication(appId));
}));

kycRouter.post('/applications/:appId/docs/:docId/reject', requirePermission('KYC_REVIEW'), asyncHandler(async (request, response) => {
  const { appId, docId } = docParams.parse(request.params); const { reason } = reasonSchema.parse(request.body);
  await pool.execute(`UPDATE kyc_documents SET status = 'REJECTED', rejection_reason = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND application_id = ?`, [reason, request.auth!.userId, docId, appId]);
  return sendSuccess(response, await getApplication(appId));
}));

kycRouter.post('/applications/:id/approve', requirePermission('KYC_REVIEW'), asyncHandler(async (request, response) => {
  const { id } = idSchema.parse(request.params); const { remarks } = remarksSchema.parse(request.body);
  const [applications] = await pool.query<(RowDataPacket & { status: string; party_id: string })[]>('SELECT status, party_id FROM onboarding_applications WHERE id = ?', [id]);
  if (!applications[0] || !['SUBMITTED', 'UNDER_REVIEW'].includes(applications[0].status)) throw new ApiError(409, 'KYC_NOT_REVIEWABLE', 'Only a submitted application can be approved');
  const requirements = await requirementsForParty(applications[0].party_id);
  const requiredCodes = requirements.filter((item) => Boolean((item.configuration as { required?: boolean }).required)).map((item) => item.code);
  const [verified] = await pool.query<(RowDataPacket & { document_type: string })[]>(`SELECT document_type FROM kyc_documents WHERE application_id = ? AND status = 'VERIFIED'`, [id]);
  const verifiedCodes = new Set(verified.map((doc) => doc.document_type));
  if (requiredCodes.some((code) => !verifiedCodes.has(code))) throw new ApiError(422, 'REQUIRED_DOCUMENTS_NOT_VERIFIED', 'All required documents must be uploaded and verified before approval');
  const [unverified] = await pool.query<(RowDataPacket & { total: number })[]>(`SELECT COUNT(*) total FROM kyc_documents WHERE application_id = ? AND status <> 'VERIFIED'`, [id]);
  if (Number(unverified[0]?.total)) throw new ApiError(422, 'DOCUMENTS_NOT_VERIFIED', 'Verify every uploaded document before approving KYC');
  await withTransaction(async (connection) => {
    await connection.execute(`UPDATE onboarding_applications SET status = 'APPROVED', decided_at = CURRENT_TIMESTAMP(6), decided_by = ?, decision_reason = ? WHERE id = ?`, [request.auth!.userId, remarks ?? null, id]);
    await connection.execute(`UPDATE parties p JOIN onboarding_applications a ON a.party_id = p.id SET p.kyc_status = 'APPROVED', p.approval_status = 'PENDING_APPROVAL', p.account_status = 'PENDING', p.version = p.version + 1 WHERE a.id = ?`, [id]);
    await connection.execute(`INSERT INTO approval_events (id, subject_type, subject_id, action, actor_user_id, remarks) VALUES (?, 'KYC_APPLICATION', ?, 'APPROVED', ?, ?)`, [randomUUID(), id, request.auth!.userId, remarks ?? null]);
  });
  return sendSuccess(response, await getApplication(id));
}));

kycRouter.post('/applications/:id/reject', requirePermission('KYC_REVIEW'), asyncHandler(async (request, response) => {
  const { id } = idSchema.parse(request.params); const { reason } = reasonSchema.parse(request.body);
  await withTransaction(async (connection) => {
    await connection.execute(`UPDATE onboarding_applications SET status = 'REJECTED', decided_at = CURRENT_TIMESTAMP(6), decided_by = ?, decision_reason = ? WHERE id = ?`, [request.auth!.userId, reason, id]);
    await connection.execute(`UPDATE parties p JOIN onboarding_applications a ON a.party_id = p.id SET p.kyc_status = 'REJECTED', p.approval_status = 'PENDING_APPROVAL', p.account_status = 'INACTIVE', p.version = p.version + 1 WHERE a.id = ?`, [id]);
    await connection.execute(`UPDATE users u JOIN onboarding_applications a ON a.party_id = u.party_id SET u.status = 'INACTIVE', u.version = u.version + 1 WHERE a.id = ? AND u.deleted_at IS NULL`, [id]);
    await connection.execute(`INSERT INTO approval_events (id, subject_type, subject_id, action, actor_user_id, remarks) VALUES (?, 'KYC_APPLICATION', ?, 'REJECTED', ?, ?)`, [randomUUID(), id, request.auth!.userId, reason]);
  });
  return sendSuccess(response, await getApplication(id));
}));

kycRouter.get('/documents/:id/download', asyncHandler(async (request, response) => {
  const { id } = idSchema.parse(request.params);
  const [rows] = await pool.query<(DocumentRow & { party_id: string })[]>(`SELECT d.*, a.party_id FROM kyc_documents d JOIN onboarding_applications a ON a.id = d.application_id WHERE d.id = ?`, [id]);
  const doc = rows[0]; if (!doc) throw new ApiError(404, 'KYC_DOCUMENT_NOT_FOUND', 'Document was not found');
  const reviewer = request.auth!.roles.includes('ADMIN') || request.auth!.permissions.includes('KYC_READ');
  if (!reviewer && request.auth!.partyId !== doc.party_id) throw new ApiError(403, 'KYC_DOCUMENT_FORBIDDEN', 'You cannot access this document');
  const filePath = path.resolve(uploadRoot, doc.storage_key);
  if (!filePath.startsWith(`${uploadRoot}${path.sep}`) || !existsSync(filePath)) throw new ApiError(404, 'KYC_FILE_NOT_FOUND', 'The stored file is unavailable');
  const safeFilename = doc.original_filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  response.setHeader('Content-Type', doc.mime_type); response.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
  createReadStream(filePath).pipe(response);
}));
