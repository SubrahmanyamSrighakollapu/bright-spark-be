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
import { roleRouter } from './modules/roles/role.routes.js';
import { employeeRouter } from './modules/employees/employee.routes.js';
import { userRouter } from './modules/users/user.routes.js';
import { providerRouter } from './modules/providers/provider.routes.js';
import { serviceCategoryRouter } from './modules/service-categories/service-category.routes.js';
import { planRouter } from './modules/plans/plan.routes.js';
import { headlineRouter } from './modules/headlines/headline.routes.js';
import { settingRouter } from './modules/settings/setting.routes.js';

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
  const normalizeOrigin = (origin: string): string => {
    try { return new URL(origin.trim()).origin; } catch { return origin.trim().replace(/\/$/, ''); }
  };
  const allowedOrigins = env.FRONTEND_ORIGIN.split(',').map(normalizeOrigin).filter(Boolean);

  app.use(
    cors({
      origin: (origin, callback) => {
        let isDevelopmentOrigin = false;
        try {
          const url = origin ? new URL(origin) : null;
          const hostname = url?.hostname ?? '';
          const isPrivateNetwork = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
          isDevelopmentOrigin = env.NODE_ENV !== 'production' && url?.protocol === 'http:' &&
            (hostname === 'localhost' || hostname === '127.0.0.1' || isPrivateNetwork);
        } catch { /* invalid origins are rejected below */ }
        if (!origin || allowedOrigins.includes(normalizeOrigin(origin)) || isDevelopmentOrigin) {
          callback(null, true);
        } else callback(new Error('Origin is not allowed by CORS'));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'Accept',
        'Origin',
        'X-Client-Platform',
        'X-Request-ID',
      ],
      optionsSuccessStatus: 200,
      maxAge: 600,
    })
  );

  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'unsafe-none' },
    })
  );

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.use('/health', healthRouter);
  app.use(`${env.API_PREFIX}/auth`, authRouter);
  app.use(`${env.API_PREFIX}/users`, userRouter);
  app.use(`${env.API_PREFIX}/parties`, partyRouter);
  app.use(`${env.API_PREFIX}/master-data`, masterDataRouter);
  app.use(`${env.API_PREFIX}/roles`, roleRouter);
  app.use(`${env.API_PREFIX}/employees`, employeeRouter);
  app.use(`${env.API_PREFIX}/providers`, providerRouter);
  app.use(`${env.API_PREFIX}/service-categories`, serviceCategoryRouter);
  app.use(`${env.API_PREFIX}/plans`, planRouter);
  app.use(`${env.API_PREFIX}/headlines`, headlineRouter);
  app.use(`${env.API_PREFIX}/settings`, settingRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

function randomRequestId(value: string | string[] | undefined): string {
  if (typeof value === 'string' && value.length <= 100) return value;
  return randomUUID();
}
