import { createServer } from 'node:http';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { pool } from './database/pool.js';

const server = createServer(createApp());

server.listen(env.PORT, () => logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'Bright Spark API started'));

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Graceful shutdown started');
  server.close(async (error) => {
    if (error) logger.error({ err: error }, 'HTTP server shutdown failed');
    await pool.end();
    process.exit(error ? 1 : 0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
