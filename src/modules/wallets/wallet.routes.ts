import { Router } from 'express';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { getCurrentWallet, getWalletForParty } from './wallet.service.js';

export const walletRouter = Router();
walletRouter.use(authenticate);

walletRouter.get('/balance', asyncHandler(async (request, response) => {
  return sendSuccess(response, await getCurrentWallet(request.auth!));
}));

walletRouter.get('/entity/:partyId', asyncHandler(async (request, response) => {
  return sendSuccess(response, await getWalletForParty(request.params.partyId as string, request.auth!));
}));
