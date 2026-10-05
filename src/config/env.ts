import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_PREFIX: z.string().startsWith('/').default('/api/v1'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:3000'),
  DATABASE_HOST: z.string().min(1).default('127.0.0.1'),
  DATABASE_PORT: z.coerce.number().int().positive().default(3306),
  DATABASE_NAME: z.string().min(1).default('qin_star_pay'),
  DATABASE_USER: z.string().min(1).default('qin_star_pay'),
  DATABASE_PASSWORD: z.string().default(''),
  DATABASE_CONNECTION_LIMIT: z.coerce.number().int().min(1).max(100).default(10),
  JWT_ACCESS_SECRET: z.string().min(32).default('development-access-secret-change-me-123456'),
  JWT_REFRESH_SECRET: z.string().min(32).default('development-refresh-secret-change-me-12345'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  LOG_LEVEL: z.string().default('info'),
  SWAGGER_ENABLED: z.enum(['true', 'false']).optional().transform((value) => value === undefined ? undefined : value === 'true'),
  SEED_ADMIN_EMAIL: z.string().email().default('admin@qinstarpay.com'),
  SEED_ADMIN_PASSWORD: z.string().min(12).default('ChangeThisBeforeUse123!'),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_ACCESS_SECRET.includes('development')) {
  throw new Error('Production JWT secrets must be explicitly configured');
}

export const env = {
  ...parsed.data,
  SWAGGER_ENABLED: parsed.data.SWAGGER_ENABLED ?? parsed.data.NODE_ENV !== 'production',
};
