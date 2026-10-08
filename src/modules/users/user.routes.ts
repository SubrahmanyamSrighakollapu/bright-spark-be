import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import {
  createUserSchema,
  listUsersSchema,
  updateUserSchema,
  swapUserRoleSchema,
  updateUserStatusSchema,
  userIdSchema,
  walletCreditDebitSchema,
  walletHoldSchema,
  blockUserSchema,
  resetPasswordSchema,
} from './user.schemas.js';
import {
  createUser,
  creditWallet,
  debitWallet,
  getUserById,
  holdWalletFunds,
  listUsers,
  updateUser,
  swapUserRole,
  updateUserStatus,
  blockUser,
  unblockUser,
  resetPassword,
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

// PUT /api/v1/users/:id - Update user details
userRouter.put(
  '/:id',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(updateUserSchema),
  asyncHandler(async (request, response) => {
    const body = updateUserSchema.parse(request.body);
    const updated = await updateUser(request.params.id as string, body, request.auth!.userId);
    return sendSuccess(response, updated);
  })
);

// PATCH /api/v1/users/:id/role - Swap user role / parent
userRouter.patch(
  '/:id/role',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(swapUserRoleSchema),
  asyncHandler(async (request, response) => {
    const body = swapUserRoleSchema.parse(request.body);
    const updated = await swapUserRole(request.params.id as string, body, request.auth!.userId);
    return sendSuccess(response, updated);
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

// POST /api/v1/users/:id/block - Block user account
userRouter.post(
  '/:id/block',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(blockUserSchema),
  asyncHandler(async (request, response) => {
    const { reason } = blockUserSchema.parse(request.body);
    const updated = await blockUser(request.params.id as string, reason, request.auth!.userId);
    return sendSuccess(response, updated);
  })
);

// POST /api/v1/users/:id/unblock - Unblock user account
userRouter.post(
  '/:id/unblock',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  asyncHandler(async (request, response) => {
    const updated = await unblockUser(request.params.id as string, request.auth!.userId);
    return sendSuccess(response, updated);
  })
);

// POST /api/v1/users/:id/reset-password - Reset password
userRouter.post(
  '/:id/reset-password',
  requirePermission('USER_WRITE'),
  validate(userIdSchema, 'params'),
  validate(resetPasswordSchema),
  asyncHandler(async (request, response) => {
    const { mode } = resetPasswordSchema.parse(request.body);
    const result = await resetPassword(request.params.id as string, mode, request.auth!.userId);
    return sendSuccess(response, result);
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

