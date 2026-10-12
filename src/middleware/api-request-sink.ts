import type { NextFunction, Request, Response } from 'express';
import { insertApiRequestLogVoid, type ApiRequestMethod } from '../shared/api-request-log.js';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f-]{27,}/i;
const NUMERIC_RE = /^\d+$/;

function normalizeRoute(req: Request): string {
  if (req.route && typeof req.route.path === 'string' && req.route.path.length > 0) {
    return req.route.path;
  }
  const basePath = (req.baseUrl ?? '') + (req.path ?? '');
  if (!basePath) {
    const method = (req.method ?? 'GET').toUpperCase();
    return `UNMATCHED_${method}`;
  }
  const segments = basePath.split('/').filter(Boolean);
  const normalized = segments.map((seg) => {
    if (UUID_RE.test(seg)) return ':id';
    if (NUMERIC_RE.test(seg)) return ':id';
    return seg;
  });
  return '/' + normalized.join('/');
}

function toMethodEnum(method: string | undefined): ApiRequestMethod {
  const m = (method ?? 'GET').toUpperCase();
  switch (m) {
    case 'GET':
    case 'POST':
    case 'PUT':
    case 'PATCH':
    case 'DELETE':
    case 'OPTIONS':
    case 'HEAD':
      return m;
    default:
      return 'GET';
  }
}

export function apiRequestSink(request: Request, response: Response, next: NextFunction): void {
  response.locals.apiRequestStartedAt = Date.now();

  response.on('finish', () => {
    try {
      const startedAt: number = Number(response.locals.apiRequestStartedAt) || Date.now();
      const responseTimeMs = Math.max(0, Date.now() - startedAt);
      const method = toMethodEnum(request.method);
      const routeTemplate = normalizeRoute(request);
      const fullUrl = request.originalUrl ?? null;
      const statusCode = Number(response.statusCode) || 0;
      const ipAddress = request.ip ?? null;
      const userAgent = (request.headers['user-agent'] as string | undefined) ?? null;
      const errorCodeHeader = response.getHeader('x-error-code');
      const errorCode = typeof errorCodeHeader === 'string' ? errorCodeHeader : null;

      const auth = request.auth;
      const actorUserId = auth?.userId ?? null;
      const actorPartyId = auth?.partyId ?? null;

      insertApiRequestLogVoid({
        requestId: request.requestId ?? null,
        actorUserId,
        actorPartyId,
        method,
        routeTemplate,
        fullUrl,
        statusCode,
        responseTimeMs,
        ipAddress,
        userAgent,
        errorCode,
      });
    } catch {
      // swallow — never block response
    }
  });

  next();
}
