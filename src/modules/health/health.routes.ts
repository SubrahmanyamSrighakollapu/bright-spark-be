import { Router } from 'express';
import { pool } from '../../database/pool.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';

export const healthRouter = Router();
healthRouter.get('/live', (_request, response) => sendSuccess(response, { status: 'ok' }));
healthRouter.get('/ready', asyncHandler(async (_request, response) => {
  await pool.query('SELECT 1');
  return sendSuccess(response, { status: 'ready', database: 'connected' });
}));
