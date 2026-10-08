import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../shared/api-error.js';
import { verifyAccessToken } from '../modules/auth/auth.service.js';

export function authenticate(request: Request, _response: Response, next: NextFunction): void {
  const authorization = request.header('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Bearer access token is required'));
    return;
  }
  try {
    request.auth = verifyAccessToken(authorization.slice(7));
    const allowedDuringPasswordChange = ['/auth/me', '/auth/logout', '/auth/change-password'];
    if (request.auth.mustChangePassword && !allowedDuringPasswordChange.some((path) => request.originalUrl.startsWith(path))) {
      next(new ApiError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before continuing'));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requirePermission(...required: string[]) {
  return (request: Request, _response: Response, next: NextFunction): void => {
    if (!request.auth) return next(new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required'));
    if (request.auth.roles.includes('ADMIN') || required.every((permission) => request.auth?.permissions.includes(permission))) {
      next();
      return;
    }
    next(new ApiError(403, 'INSUFFICIENT_PERMISSION', 'You do not have permission to perform this action'));
  };
}
