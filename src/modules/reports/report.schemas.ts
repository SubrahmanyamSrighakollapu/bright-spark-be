import { z } from 'zod';

export const reportType = z.enum([
  'transactions',
  'ledger',
  'settlements',
  'balance',
  'chargebacks',
  'api-performance',
]);

export const REPORT_TYPES = reportType.options;

export const commonDateRange = z.object({
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO datetime' }),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO datetime' }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

export const listByType = commonDateRange.extend({
  role: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  service: z.string().trim().optional(),
  transactionStatus: z.string().trim().optional(),
  chargebackStatus: z.string().trim().optional(),
  settlementCycle: z.string().trim().optional(),
});

export const exportByType = commonDateRange.extend({
  role: z.string().trim().optional(),
  userId: z.string().trim().optional(),
  status: z.string().trim().optional(),
  service: z.string().trim().optional(),
  transactionStatus: z.string().trim().optional(),
  chargebackStatus: z.string().trim().optional(),
  settlementCycle: z.string().trim().optional(),
}).omit({ page: true, pageSize: true });

export const reportTypeParamSchema = z.object({
  type: reportType,
});

export type ReportType = z.infer<typeof reportType>;
export type ListByTypeFilters = z.infer<typeof listByType>;
export type ExportByTypeFilters = z.infer<typeof exportByType>;
