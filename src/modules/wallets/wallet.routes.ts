import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../../middleware/auth.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import {
  getCurrentWallet,
  getWalletForParty,
  getAllWallets,
  creditWallet,
  debitWallet,
  holdFunds,
  toggleWalletStatus,
  getLedgerForParty,
  createDebitRequest,
  getDebitRequests,
  reviewDebitRequest,
} from './wallet.service.js';

export const walletRouter = Router();
walletRouter.use(authenticate);

// List all wallets (Admin/Accounts)
walletRouter.get('/', asyncHandler(async (request, response) => {
  const role = request.query.role ? String(request.query.role) : undefined;
  const status = request.query.status ? String(request.query.status) : undefined;
  const search = request.query.search ? String(request.query.search) : undefined;
  const page = request.query.page ? Number(request.query.page) : 1;
  const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 20;

  const result = await getAllWallets({ role, status, search, page, pageSize }, request.auth!);
  return sendSuccess(response, result);
}));

// Current user wallet
walletRouter.get('/balance', asyncHandler(async (request, response) => {
  return sendSuccess(response, await getCurrentWallet(request.auth!));
}));

// Debit Requests Queue
walletRouter.get('/debit-requests', asyncHandler(async (request, response) => {
  const status = request.query.status ? String(request.query.status) : undefined;
  const page = request.query.page ? Number(request.query.page) : 1;
  const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 20;

  const result = await getDebitRequests({ status, page, pageSize }, request.auth!);
  return sendSuccess(response, result);
}));

walletRouter.post('/debit-requests', asyncHandler(async (request, response) => {
  const schema = z.object({
    partyId: z.string().min(1),
    amount: z.number().positive(),
    reason: z.string().min(3),
  });
  const input = schema.parse(request.body);
  const result = await createDebitRequest(input.partyId, { amount: input.amount, reason: input.reason }, request.auth!);
  return sendSuccess(response, result, 201);
}));

walletRouter.post('/debit-requests/:id/review', asyncHandler(async (request, response) => {
  const schema = z.object({
    action: z.enum(['APPROVE', 'REJECT']),
    rejectionReason: z.string().optional(),
  });
  const input = schema.parse(request.body);
  const result = await reviewDebitRequest(request.params.id as string, input, request.auth!);
  return sendSuccess(response, result);
}));

// Single party wallet details
walletRouter.get('/entity/:partyId', asyncHandler(async (request, response) => {
  return sendSuccess(response, await getWalletForParty(request.params.partyId as string, request.auth!));
}));

// Party Ledger History
walletRouter.get('/entity/:partyId/ledger', asyncHandler(async (request, response) => {
  const type = request.query.type ? String(request.query.type) : undefined;
  const fromDate = request.query.fromDate ? String(request.query.fromDate) : undefined;
  const toDate = request.query.toDate ? String(request.query.toDate) : undefined;
  const page = request.query.page ? Number(request.query.page) : 1;
  const pageSize = request.query.pageSize ? Number(request.query.pageSize) : 20;

  const result = await getLedgerForParty(
    request.params.partyId as string,
    { type, page, pageSize, fromDate, toDate },
    request.auth!
  );
  return sendSuccess(response, result);
}));

// Manual Credit Wallet
walletRouter.post('/entity/:partyId/credit', asyncHandler(async (request, response) => {
  const schema = z.object({
    amount: z.number().positive(),
    referenceType: z.string().optional(),
    referenceId: z.string().optional(),
    narration: z.string().min(3),
  });
  const input = schema.parse(request.body);
  const result = await creditWallet(request.params.partyId as string, input, request.auth!);
  return sendSuccess(response, result);
}));

// Manual Debit Wallet
walletRouter.post('/entity/:partyId/debit', asyncHandler(async (request, response) => {
  const schema = z.object({
    amount: z.number().positive(),
    referenceType: z.string().optional(),
    referenceId: z.string().optional(),
    narration: z.string().min(3),
  });
  const input = schema.parse(request.body);
  const result = await debitWallet(request.params.partyId as string, input, request.auth!);
  return sendSuccess(response, result);
}));

// Hold or Release Funds
walletRouter.post('/entity/:partyId/hold', asyncHandler(async (request, response) => {
  const schema = z.object({
    mode: z.enum(['HOLD', 'RELEASE']),
    amount: z.number().positive(),
    reason: z.string().min(3),
  });
  const input = schema.parse(request.body);
  const result = await holdFunds(request.params.partyId as string, input, request.auth!);
  return sendSuccess(response, result);
}));

// Freeze / Unfreeze Wallet Status
walletRouter.patch('/entity/:partyId/status', asyncHandler(async (request, response) => {
  const schema = z.object({
    status: z.enum(['ACTIVE', 'FROZEN']),
    reason: z.string().min(3),
  });
  const input = schema.parse(request.body);
  const result = await toggleWalletStatus(request.params.partyId as string, input, request.auth!);
  return sendSuccess(response, result);
}));
