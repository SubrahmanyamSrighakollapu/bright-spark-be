import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../shared/api-error.js';

type RequestSource = 'body' | 'params' | 'query';

export function validate(schema: ZodType, source: RequestSource = 'body') {
  return (request: Request, _response: Response, next: NextFunction): void => {
    const result = schema.safeParse(request[source]);
    if (!result.success) {
      next(new ApiError(422, 'VALIDATION_ERROR', 'Request validation failed', result.error.flatten()));
      return;
    }
    Object.assign(request[source], result.data);
    next();
  };
}
