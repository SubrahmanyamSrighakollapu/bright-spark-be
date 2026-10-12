import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import {
  listAuditLogs,
  getAuditLogSummary,
  getAuditLogById,
  getActionCatalog,
  exportAuditLogsCsv,
  traceAuditByReference,
} from './audit-log.service.js';
import {
  listAuditLogsSchema,
  auditLogIdSchema,
  exportAuditLogsSchema,
  actionCatalogSchema,
  traceAuditSchema,
} from './audit-log.schemas.js';

export const auditLogRouter = Router();
auditLogRouter.use(authenticate);

auditLogRouter.get(
  '/',
  requirePermission('AUDIT_READ'),
  validate(listAuditLogsSchema, 'query'),
  asyncHandler(async (request, response) => {
    const filters = listAuditLogsSchema.parse(request.query);
    const result = await listAuditLogs(filters, request.auth!);
    return sendSuccess(response, result);
  }),
);

auditLogRouter.get(
  '/summary',
  requirePermission('AUDIT_READ'),
  asyncHandler(async (request, response) => {
    return sendSuccess(response, await getAuditLogSummary(request.auth!));
  }),
);

auditLogRouter.get(
  '/action-catalog',
  requirePermission('AUDIT_READ'),
  validate(actionCatalogSchema, 'query'),
  asyncHandler(async (request, response) => {
    return sendSuccess(response, await getActionCatalog(request.auth!));
  }),
);

auditLogRouter.get(
  '/export.csv',
  requirePermission('AUDIT_READ'),
  requirePermission('EXPORT_CSV'),
  validate(exportAuditLogsSchema, 'query'),
  asyncHandler(async (request, response) => {
    const filters = exportAuditLogsSchema.parse(request.query);
    await exportAuditLogsCsv(filters, request.auth!, response);
  }),
);

auditLogRouter.get(
  '/trace',
  requirePermission('AUDIT_READ'),
  validate(traceAuditSchema, 'query'),
  asyncHandler(async (request, response) => {
    const { referenceId } = traceAuditSchema.parse(request.query);
    return sendSuccess(response, await traceAuditByReference(referenceId, request.auth!));
  }),
);

auditLogRouter.get(
  '/:id',
  requirePermission('AUDIT_READ'),
  validate(auditLogIdSchema, 'params'),
  asyncHandler(async (request, response) => {
    const { id } = auditLogIdSchema.parse(request.params);
    return sendSuccess(response, await getAuditLogById(id, request.auth!));
  }),
);
