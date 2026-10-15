import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { assignPublicPartySchema, createPartySchema, listPartiesSchema, partyIdSchema, reviewPartySchema, updatePartyStatusSchema } from './party.schemas.js';
import { assignPublicParty, createParty, getParty, listParties, reviewParty, updatePartyStatus } from './party.service.js';

export const partyRouter = Router();
partyRouter.use(authenticate);

partyRouter.get('/', requirePermission('PARTY_READ'), validate(listPartiesSchema, 'query'), asyncHandler(async (request, response) => {
  return sendSuccess(response, await listParties(listPartiesSchema.parse(request.query)));
}));

partyRouter.get('/:id', requirePermission('PARTY_READ'), validate(partyIdSchema, 'params'), asyncHandler(async (request, response) => {
  return sendSuccess(response, await getParty(request.params.id as string));
}));

partyRouter.post('/', requirePermission('PARTY_CREATE'), validate(createPartySchema), asyncHandler(async (request, response) => {
  return sendSuccess(response, await createParty(createPartySchema.parse(request.body), request.auth!.userId), 201);
}));

partyRouter.patch('/:id/status', requirePermission('PARTY_STATUS_UPDATE'), validate(partyIdSchema, 'params'), validate(updatePartyStatusSchema), asyncHandler(async (request, response) => {
  const body = updatePartyStatusSchema.parse(request.body);
  return sendSuccess(response, await updatePartyStatus(request.params.id as string, body.accountStatus, body.reason, body.version, request.auth!.userId));
}));

partyRouter.post('/:id/review', requirePermission('PARTY_APPROVE'), validate(partyIdSchema, 'params'), validate(reviewPartySchema), asyncHandler(async (request, response) => {
  const body = reviewPartySchema.parse(request.body);
  return sendSuccess(response, await reviewParty(request.params.id as string, body.decision, body.reasonCode, body.remarks, body.version, request.auth!.userId));
}));

partyRouter.patch('/:id/assignment', requirePermission('PARTY_APPROVE'), validate(partyIdSchema, 'params'), validate(assignPublicPartySchema), asyncHandler(async (request, response) => {
  const input = assignPublicPartySchema.parse(request.body);
  return sendSuccess(response, await assignPublicParty(request.params.id as string, input.parentPartyId, input.version, request.auth!.userId));
}));
