import pino from 'pino';
import { env } from './env.js';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'password',
      '*.password',
      '*.passwordHash',
      '*.accessToken',
      '*.refreshToken',
      '*.accountNumber',
      '*.panNumber',
      '*.aadhaarNumber',
    ],
    censor: '[REDACTED]',
  },
});
