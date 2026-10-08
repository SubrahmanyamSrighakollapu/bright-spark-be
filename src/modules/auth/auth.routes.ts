import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticate } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import { changePasswordSchema, loginSchema, refreshSchema } from './auth.schemas.js';
import { changePassword, login, logout, refresh } from './auth.service.js';

export const authRouter = Router();
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

authRouter.post('/login', authLimiter, validate(loginSchema), asyncHandler(async (request, response) => {
  const { identifier, password } = loginSchema.parse(request.body);
  const data = await login(identifier, password, { ipAddress: request.ip, userAgent: request.header('user-agent') });
  return sendSuccess(response, data);
}));

authRouter.post('/refresh', authLimiter, validate(refreshSchema), asyncHandler(async (request, response) => {
  const { refreshToken } = refreshSchema.parse(request.body);
  return sendSuccess(response, await refresh(refreshToken, { ipAddress: request.ip, userAgent: request.header('user-agent') }));
}));

authRouter.post('/logout', authenticate, validate(refreshSchema), asyncHandler(async (request, response) => {
  const { refreshToken } = refreshSchema.parse(request.body);
  await logout(refreshToken);
  return sendSuccess(response, { loggedOut: true });
}));

authRouter.get('/me', authenticate, (request, response) => sendSuccess(response, request.auth));

authRouter.post('/change-password', authenticate, validate(changePasswordSchema), asyncHandler(async (request, response) => {
  const { currentPassword, newPassword } = changePasswordSchema.parse(request.body);
  const data = await changePassword(request.auth!.userId, currentPassword, newPassword, {
    ipAddress: request.ip, userAgent: request.header('user-agent'),
  });
  return sendSuccess(response, data);
}));
