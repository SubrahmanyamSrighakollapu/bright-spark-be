import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(4).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(4).max(128),
  newPassword: z.string().min(8).max(128)
    .regex(/[a-z]/, 'Password must contain a lowercase letter')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/\d/, 'Password must contain a number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain a special character'),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'New password must be different from the current password', path: ['newPassword'],
});
