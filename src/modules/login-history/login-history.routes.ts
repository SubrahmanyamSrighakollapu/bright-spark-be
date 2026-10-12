import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { ApiError } from '../../shared/api-error.js';
import {
  list,
  summary,
  getById,
  exportCsv,
  updateLocationBySessionId,
} from './login-history.service.js';
import {
  listSchema,
  byIdSchema,
  exportSchema,
  sessionIdSchema,
  updateLocationSchema,
} from './login-history.schemas.js';

export const loginHistoryRouter = Router();
loginHistoryRouter.use(authenticate);

loginHistoryRouter.get(
  '/',
  validate(listSchema, 'query'),
  asyncHandler(async (request, response) => {
    const filters = listSchema.parse(request.query);
    const result = await list(filters, request.auth!);
    return sendSuccess(response, result);
  }),
);

loginHistoryRouter.get(
  '/summary',
  validate(listSchema, 'query'),
  asyncHandler(async (request, response) => {
    const filters = listSchema.parse(request.query);
    return sendSuccess(response, await summary(filters, request.auth!));
  }),
);

loginHistoryRouter.get(
  '/export.csv',
  validate(exportSchema, 'query'),
  asyncHandler(async (request, response) => {
    const auth = request.auth!;
    const filters = exportSchema.parse(request.query);
    const isOwnExport = !filters.userId || (filters.userId.length === 1 && filters.userId[0] === auth.userId);
    const hasExportPermission = auth.permissions.includes('EXPORT_CSV');
    const hasReadPermission = auth.permissions.includes('LOGIN_HISTORY_READ');
    const hasAdminRole = auth.roles.includes('ADMIN') || auth.roles.includes('SUPER_ADMIN') || auth.roles.includes('OPERATIONS') || auth.roles.includes('ACCOUNTS');

    if (!isOwnExport && !(hasExportPermission || (hasAdminRole && hasReadPermission))) {
      throw new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You do not have permission to export login history for other users');
    }

    return exportCsv(filters, auth, response);
  }),
);

loginHistoryRouter.patch(
  '/session/:sessionId/location',
  validate(sessionIdSchema, 'params'),
  validate(updateLocationSchema, 'body'),
  asyncHandler(async (request, response) => {
    const { sessionId } = sessionIdSchema.parse(request.params);
    const body = updateLocationSchema.parse(request.body);
    const result = await updateLocationBySessionId(sessionId, body, request.auth!);
    return sendSuccess(response, result);
  }),
);

loginHistoryRouter.get(
  '/:id',
  validate(byIdSchema, 'params'),
  asyncHandler(async (request, response) => {
    const { id } = byIdSchema.parse(request.params);
    return sendSuccess(response, await getById(id, request.auth!));
  }),
);
