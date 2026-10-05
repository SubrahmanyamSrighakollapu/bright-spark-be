import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const migrationDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

async function migrate(): Promise<void> {
  const connection = await mysql.createConnection({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  try {
    await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(100) PRIMARY KEY,
      applied_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
    ) ENGINE=InnoDB`);
    const [rows] = await connection.query<mysql.RowDataPacket[]>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => String(row.version)));
    const files = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      logger.info({ migration: file }, 'Applying database migration');
      const sql = await readFile(path.join(migrationDirectory, file), 'utf8');
      await connection.beginTransaction();
      try {
        await connection.query(sql);
        await connection.query('INSERT INTO schema_migrations (version) VALUES (?)', [file]);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      }
    }
  } finally {
    await connection.end();
  }
}

migrate().then(() => logger.info('Database migrations completed')).catch((error: unknown) => {
  logger.fatal({ err: error }, 'Database migration failed');
  process.exitCode = 1;
});
