import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.string().trim().min(1).default('loopback'),
  DATABASE_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PORT: z.coerce.number().int().positive().default(3306),
  DATABASE_NAME: z.string().min(1).default('bright_spark'),
  DATABASE_USER: z.string().min(1).default('root'),
  DATABASE_PASSWORD: z.string().default(''),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-123456'),
  JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-12345'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  LOG_LEVEL: z.string().default('info'),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@brightspark.com'),
  SEED_ADMIN_PASSWORD: z.string().min(8).default('ChangeThisBeforeUse123!'),
  NOBLE_AEPS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  NOBLE_API_KEY: z.string().trim().transform((value) => value.replace(/\s+/g, '')).optional(),
  NOBLE_API_VALUE: z.string().trim().optional(),
  NOBLE_AUTH_BASE_URL: z.string().url().default('https://service.noblewebstudio.in/api/v1.0'),
  NOBLE_AEPS_BASE_URL: z.string().url().default('https://aeapi.noblewebstudio.in/v2.0/aeps'),
  NOBLE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_ACCESS_SECRET.includes('development')) {
  throw new Error('Production JWT secrets must be explicitly configured');
}

if (parsed.data.NOBLE_AEPS_ENABLED && (!parsed.data.NOBLE_API_KEY || !parsed.data.NOBLE_API_VALUE)) {
  throw new Error('NOBLE_API_KEY and NOBLE_API_VALUE are required when NOBLE_AEPS_ENABLED=true');
}

export const env = {
  ...parsed.data,
  SWAGGER_ENABLED: parsed.data.SWAGGER_ENABLED ?? parsed.data.NODE_ENV !== 'production',
};
