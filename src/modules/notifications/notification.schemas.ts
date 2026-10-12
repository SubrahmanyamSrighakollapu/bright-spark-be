import { z } from 'zod';

export const NOTIFICATION_CATEGORIES = [
  'TRANSACTION',
  'KYC',
  'WALLET',
  'USER',
  'SETTLEMENT',
  'CHARGEBACK',
  'PROVIDER',
  'APPROVAL',
  'INVOICE',
  'RECONCILIATION',
  'SECURITY',
  'SYSTEM',
  'NOTIFICATION',
] as const;

export const NOTIFICATION_SEVERITIES = ['INFO', 'SUCCESS', 'WARNING', 'CRITICAL'] as const;
export const NOTIFICATION_STATUSES = ['UNREAD', 'READ', 'ALL'] as const;

export const ROLE_SELECTOR = [
  'ADMIN',
  'MASTER_DISTRIBUTOR',
  'DISTRIBUTOR',
  'RETAILER',
  'OPERATIONS',
  'ACCOUNTS',
  'KYC',
  'SALES',
  'SUPPORT',
] as const;

export const listNotificationsSchema = z.object({
  category: z.enum([...NOTIFICATION_CATEGORIES, 'ALL'] as const).optional().default('ALL'),
  severity: z.enum([...NOTIFICATION_SEVERITIES, 'ALL'] as const).optional().default('ALL'),
  status: z.enum(NOTIFICATION_STATUSES).optional().default('ALL'),
  actionRequired: z.enum(['true', 'false', 'ALL']).optional().default('ALL'),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().trim().optional(),
  searchQuery: z.string().trim().optional(),
  excludeDismissed: z.enum(['true', 'false']).optional().default('false'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

export const notificationIdSchema = z.object({
  id: z.string().trim().min(1),
});

export const eventCodeSchema = z.object({
  eventCode: z.string().trim().min(1).max(80),
});

export const markAsReadSchema = z.object({}).strict().optional();
export const markAsUnreadSchema = z.object({}).strict().optional();
export const dismissSchema = z.object({}).strict().optional();
export const clickedSchema = z.object({}).strict().optional();

export const markAllReadSchema = z.object({
  category: z.enum(NOTIFICATION_CATEGORIES).optional(),
});

export const targetByUserIdsSchema = z.object({
  kind: z.literal('USER_IDS'),
  userIds: z.array(z.string().trim().min(1)).min(1).max(5000),
});

export const targetByRolesSchema = z.object({
  kind: z.literal('ROLES'),
  roles: z.array(z.enum(ROLE_SELECTOR)).min(1),
});

export const targetAllSchema = z.object({
  kind: z.literal('ALL'),
});

export const targetByHierarchySchema = z.object({
  kind: z.literal('HIERARCHY'),
  ownerUserId: z.string().trim().min(1),
  includeOwner: z.boolean().default(true),
});

export const targetSchema = z.discriminatedUnion('kind', [
  targetByUserIdsSchema,
  targetByRolesSchema,
  targetAllSchema,
  targetByHierarchySchema,
]);

export const publishAnnouncementSchema = z.object({
  target: targetSchema,
  title: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(2000),
  severity: z.enum(NOTIFICATION_SEVERITIES).default('INFO'),
  actionRequired: z.boolean().default(false),
  entityType: z.string().trim().max(50).optional(),
  entityId: z.string().trim().max(100).optional(),
  relatedEntity: z.string().trim().max(200).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const updatePreferenceSchema = z.object({
  inAppEnabled: z.boolean().optional(),
  emailEnabled: z.boolean().optional(),
  smsEnabled: z.boolean().optional(),
  pushEnabled: z.boolean().optional(),
}).refine(
  (value) =>
    typeof value.inAppEnabled === 'boolean'
    || typeof value.emailEnabled === 'boolean'
    || typeof value.smsEnabled === 'boolean'
    || typeof value.pushEnabled === 'boolean',
  { message: 'At least one preference flag must be provided' },
);
