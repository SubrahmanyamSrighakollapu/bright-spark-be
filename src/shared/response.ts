import type { Response } from 'express';

export function sendSuccess<T>(response: Response, data: T, statusCode = 200): Response {
  return response.status(statusCode).json({
    success: true,
    data,
    timestamp: new Date().toISOString(),
    requestId: response.req.requestId,
  });
}
