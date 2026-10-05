import { z } from 'zod';

export const roleIdSchema = z.object({ id: z.coerce.number().int().positive() });
export const listRolesSchema = z.object({
  category: z.enum(['SYSTEM', 'NETWORK', 'EMPLOYEE']).optional(),
  includeInactive: z.coerce.boolean().default(false),
});
export const createRoleSchema = z.object({
  code: z.string().trim().min(2).max(50).regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  permissionCodes: z.array(z.string().trim().min(2).max(100)).min(1),
});
export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  permissionCodes: z.array(z.string().trim().min(2).max(100)).min(1).optional(),
  isActive: z.boolean().optional(),
  reason: z.string().trim().min(3).max(500),
});
