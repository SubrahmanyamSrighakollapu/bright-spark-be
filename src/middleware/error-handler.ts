import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../shared/api-error.js';
import { logger } from '../config/logger.js';

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Route ${request.method} ${request.originalUrl} was not found`));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  void next;
  const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : undefined;
  const apiError = error instanceof ApiError
    ? error
    : databaseCode === 'ER_DUP_ENTRY'
      ? new ApiError(409, 'DUPLICATE_RESOURCE', 'A record with the same unique identifier already exists')
      : databaseCode === 'ER_ROW_IS_REFERENCED_2'
        ? new ApiError(409, 'RESOURCE_IN_USE', 'This record is currently used by another configuration and cannot be deleted')
        : databaseCode === 'ER_NO_REFERENCED_ROW_2'
          ? new ApiError(422, 'INVALID_REFERENCE', 'One or more selected records do not exist or are inactive')
      : new ApiError(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred');

  if (apiError.statusCode >= 500) {
    logger.error({ err: error, requestId: request.requestId }, 'Request failed');
  }

  response.status(apiError.statusCode).json({
    success: false,
    error: {
      code: apiError.code,
      message: apiError.message,
      ...(apiError.details === undefined ? {} : { details: apiError.details }),
    },
    timestamp: new Date().toISOString(),
    requestId: request.requestId,
  });
};
