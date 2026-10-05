import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export function requestContext(request: Request, response: Response, next: NextFunction): void {
  const incomingId = request.header('x-request-id');
  request.requestId = incomingId && incomingId.length <= 100 ? incomingId : randomUUID();
  response.setHeader('x-request-id', request.requestId);
  next();
}
