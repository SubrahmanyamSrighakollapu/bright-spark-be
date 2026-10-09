import { z } from 'zod';

export const listEmployeesSchema = z.object({
  search: z.string().trim().max(100).optional(),
  departmentCode: z.string().trim().max(100).optional(),
  roleId: z.coerce.number().int().positive().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const createEmployeeSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  mobile: z.string().trim().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number'),
  departmentCode: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_-]+$/),
  managerUserId: z.string().uuid().optional(),
  joiningDate: z.string().date(),
  shiftCode: z.enum(['MORNING', 'EVENING', 'NIGHT']).default('MORNING'),
});

export const employeeIdSchema = z.object({ id: z.string().uuid() });

export const updateEmployeeSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254),
  mobile: z.string().trim().regex(/^\+?[1-9]\d{7,14}$/).nullable().optional(),
  departmentCode: z.string().trim().min(2).max(100).regex(/^[A-Z0-9_-]+$/),
  roleId: z.number().int().positive(),
  designation: z.string().trim().max(120).nullable().optional(),
  managerUserId: z.string().uuid().nullable().optional(),
  joiningDate: z.string().date().nullable().optional(),
  shiftCode: z.enum(['MORNING', 'EVENING', 'NIGHT']),
  reason: z.string().trim().min(3).max(500),
});

export const updateEmployeeStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'TERMINATED']),
  reason: z.string().trim().min(3).max(500),
});

export const resetEmployeePasswordSchema = z.object({
  password: z.string().min(8).max(128).optional(),
  reason: z.string().trim().min(3).max(500),
});

