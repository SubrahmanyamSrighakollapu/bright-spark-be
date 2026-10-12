import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { normalizeClientIp } from '../../shared/ip.js';
import { createPayoutChargeSchema, payoutChargeIdSchema, resolvePayoutChargeSchema, updatePayoutChargeSchema } from './payout-charge.schemas.js';
import { createRule, deleteRule, getRule, listRules, resolveRule, updateRule } from './payout-charge.service.js';

export const payoutChargeRouter = Router();
payoutChargeRouter.use(authenticate);
payoutChargeRouter.get('/', asyncHandler(async (_request, response) => sendSuccess(response, await listRules())));
payoutChargeRouter.get('/resolve', asyncHandler(async (request, response) => sendSuccess(response, await resolveRule(resolvePayoutChargeSchema.parse(request.query)))));
payoutChargeRouter.get('/:id', asyncHandler(async (request, response) => {
  const { id } = payoutChargeIdSchema.parse(request.params);
  return sendSuccess(response, await getRule(id));
}));
payoutChargeRouter.post('/', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => sendSuccess(response, await createRule(createPayoutChargeSchema.parse(request.body), request.auth!, request.requestId, normalizeClientIp(request.ip) ?? undefined, request.header('user-agent')), 201)));
payoutChargeRouter.put('/:id', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => { const { id } = payoutChargeIdSchema.parse(request.params); return sendSuccess(response, await updateRule(id, updatePayoutChargeSchema.parse(request.body), request.auth!, request.requestId, normalizeClientIp(request.ip) ?? undefined, request.header('user-agent'))); }));
payoutChargeRouter.delete('/:id', requirePermission('MASTER_DATA_WRITE'), asyncHandler(async (request, response) => { const { id } = payoutChargeIdSchema.parse(request.params); return sendSuccess(response, await deleteRule(id, request.auth!, request.requestId, normalizeClientIp(request.ip) ?? undefined, request.header('user-agent'))); }));
