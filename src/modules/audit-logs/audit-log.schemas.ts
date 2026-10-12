import { z } from 'zod';

export const listAuditLogsSchema = z.object({
  actorUserId: z.string().trim().min(1).optional(),
  action: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]).optional().transform((v) => {
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v : [v];
  }),
  resourceType: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]).optional().transform((v) => {
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v : [v];
  }),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  resourceId: z.string().trim().min(1).optional(),
  ipAddress: z.string().trim().min(1).optional(),
  actorRole: z.string().trim().min(1).optional(),
  keyword: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

export const auditLogIdSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .transform((v) => {
      const upper = v.toUpperCase();
      if (upper.startsWith('ACT_')) {
        const afterPrefix = v.slice(4);
        if (/^\d+$/.test(afterPrefix)) return Number(afterPrefix);
      }
      return v;
    }),
});

export const exportAuditLogsSchema = z.object({
  actorUserId: z.string().trim().min(1).optional(),
  action: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]).optional().transform((v) => {
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v : [v];
  }),
  resourceType: z.union([z.string().trim().min(1), z.array(z.string().trim().min(1))]).optional().transform((v) => {
    if (v === undefined) return undefined;
    return Array.isArray(v) ? v : [v];
  }),
  outcome: z.enum(['SUCCESS', 'FAILURE']).optional(),
  startDate: z.string().trim().optional(),
  endDate: z.string().trim().optional(),
  resourceId: z.string().trim().min(1).optional(),
  ipAddress: z.string().trim().min(1).optional(),
  actorRole: z.string().trim().min(1).optional(),
  keyword: z.string().trim().max(100).optional(),
});

export const actionCatalogSchema = z.object({}).strict().optional();

export const traceAuditSchema = z.object({
  referenceId: z.string().trim().min(1).max(120),
});

