import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import {
  createUserSchema,
  listUsersSchema,
  updateUserStatusSchema,
  userIdSchema,
  walletCreditDebitSchema,
  walletHoldSchema,
} from './user.schemas.js';
import {
  createUser,
  creditWallet,
  debitWallet,
  getUserById,
  holdWalletFunds,
  listUsers,
  updateUserStatus,
} from './user.service.js';

export const userRouter = Router();
userRouter.use(authenticate);

// GET /api/v1/users - Paginated user network directory
userRouter.get(
  '/',
  requirePermission('USER_READ'),
  validate(listUsersSchema, 'query'),
  asyncHandler(async (request, response) => {
    const query = listUsersSchema.parse(request.query);
    const result = await listUsers(query);
    return sendSuccess(response, result);
  })
);

// GET /api/v1/users/:id - Single user details
userRouter.get(
  '/:id',
  requirePermission('USER_READ'),
  validate(userIdSchema, 'params'),
  asyncHandler(async (request, response) => {
    const user = await getUserById(request.params.id as string);
    return sendSuccess(response, user);
  })
);

// POST /api/v1/users - Onboard new user (MD, DS, Retailer)
userRouter.post(
  '/',
  requirePermission('USER_WRITE'),
  validate(createUserSchema),
  asyncHandler(async (request, response) => {
    const body = createUserSchema.parse(request.body);
    const user = await createUser(body, request.auth!.userId);
    return sendSuccess(response, user, 201);
  })
);

// PATCH /api/v1/users/:id/status - Activate / Suspend / Update status
userRouter.patch(
  '/:id/status',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(updateUserStatusSchema),
  asyncHandler(async (request, response) => {
    const { status, reason } = updateUserStatusSchema.parse(request.body);
    const updated = await updateUserStatus(request.params.id as string, status, reason, request.auth!.userId);
    return sendSuccess(response, updated);
  })
);

// POST /api/v1/users/:id/wallet/credit - Top-up user wallet balance
userRouter.post(
  '/:id/wallet/credit',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(walletCreditDebitSchema),
  asyncHandler(async (request, response) => {
    const body = walletCreditDebitSchema.parse(request.body);
    const result = await creditWallet(request.params.id as string, body, request.auth!.userId);
    return sendSuccess(response, result);
  })
);

// POST /api/v1/users/:id/wallet/debit - Deduct from user wallet
userRouter.post(
  '/:id/wallet/debit',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(walletCreditDebitSchema),
  asyncHandler(async (request, response) => {
    const body = walletCreditDebitSchema.parse(request.body);
    const result = await debitWallet(request.params.id as string, body, request.auth!.userId);
    return sendSuccess(response, result);
  })
);

// POST /api/v1/users/:id/wallet/hold - Hold or release user wallet funds
userRouter.post(
  '/:id/wallet/hold',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(walletHoldSchema),
  asyncHandler(async (request, response) => {
    const body = walletHoldSchema.parse(request.body);
    const result = await holdWalletFunds(request.params.id as string, body, request.auth!.userId);
    return sendSuccess(response, result);
  })
);
