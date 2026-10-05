import express from 'express';
import { randomUUID } from 'node:crypto';
import cors from 'cors';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { swaggerDocument } from './config/swagger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { requestContext } from './middleware/request-context.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { healthRouter } from './modules/health/health.routes.js';
import { masterDataRouter } from './modules/master-data/master-data.routes.js';
import { partyRouter } from './modules/parties/party.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(requestContext);
  app.use(pinoHttp({ logger, genReqId: (request) => request.id || randomRequestId(request.headers['x-request-id']) }));
  if (env.SWAGGER_ENABLED) {
    app.get('/api-docs.json', (_request, response) => response.json(swaggerDocument));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, {
      customSiteTitle: 'Qin Star Pay API Documentation',
      swaggerOptions: { persistAuthorization: true, displayRequestDuration: true },
    }));
  }
  app.use(helmet());
  app.use(cors({ origin: env.FRONTEND_ORIGIN.split(',').map((origin) => origin.trim()), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.use('/health', healthRouter);
  app.use(`${env.API_PREFIX}/auth`, authRouter);
  app.use(`${env.API_PREFIX}/parties`, partyRouter);
  app.use(`${env.API_PREFIX}/master-data`, masterDataRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function randomRequestId(value: string | string[] | undefined): string {
  if (typeof value === 'string' && value.length <= 100) return value;
  return randomUUID();
}
