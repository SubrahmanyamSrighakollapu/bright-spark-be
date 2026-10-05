import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ApiError } from '../shared/api-error.js';
import { logger } from '../config/logger.js';

export const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new ApiError(404, 'ROUTE_NOT_FOUND', `Route ${request.method} ${request.originalUrl} was not found`));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, request, response, next) => {
  void next;
  const apiError = error instanceof ApiError
    ? error
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
