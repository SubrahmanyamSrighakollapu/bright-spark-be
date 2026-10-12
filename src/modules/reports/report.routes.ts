import { Router } from 'express';
import { authenticate, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../shared/async-handler.js';
import { sendSuccess } from '../../shared/response.js';
import {
  listByType,
  exportByType,
  reportTypeParamSchema,
} from './report.schemas.js';
import {
  getTransactionsReport,
  exportTransactionsCsv,
  getLedgerReport,
  exportLedgerCsv,
  getSettlementReport,
  exportSettlementCsv,
  getBalanceReport,
  exportBalanceCsv,
  getChargebackReport,
  exportChargebackCsv,
  getApiPerformanceReport,
  exportApiPerformanceCsv,
} from './report.service.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const reportHandlers = {
  transactions: { get: getTransactionsReport, export: exportTransactionsCsv, perms: ['REPORT_TRANSACTIONS_READ'] },
  ledger: { get: getLedgerReport, export: exportLedgerCsv, perms: ['REPORT_LEDGER_READ'] },
  settlements: { get: getSettlementReport, export: exportSettlementCsv, perms: ['REPORT_SETTLEMENTS_READ'] },
  balance: { get: getBalanceReport, export: exportBalanceCsv, perms: ['REPORT_BALANCE_READ'] },
  chargebacks: { get: getChargebackReport, export: exportChargebackCsv, perms: ['REPORT_CHARGEBACKS_READ'] },
  'api-performance': { get: getApiPerformanceReport, export: exportApiPerformanceCsv, perms: ['REPORT_API_PERFORMANCE_READ'] },
} as const;

for (const [type, handlers] of Object.entries(reportHandlers)) {
  reportsRouter.get(
    `/${type}`,
    requirePermission(...handlers.perms),
    validate(listByType, 'query'),
    asyncHandler(async (request, response) => {
      const filters = listByType.parse(request.query);
      const result = await handlers.get(filters, request.auth!);
      return sendSuccess(response, result);
    }),
  );

  reportsRouter.get(
    `/${type}/export.csv`,
    requirePermission(...handlers.perms, 'EXPORT_CSV'),
    validate(exportByType, 'query'),
    asyncHandler(async (request, response) => {
      const filters = exportByType.parse(request.query);
      await handlers.export(filters, request.auth!, response);
    }),
  );
}

reportsRouter.param('type', (request, _response, next, value) => {
  request.params.type = value;
  reportTypeParamSchema.parse(request.params);
  next();
});

