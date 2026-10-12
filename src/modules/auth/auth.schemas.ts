import { z } from 'zod';

const locationStatusEnum = z.enum(['GRANTED', 'DENIED', 'TIMEOUT', 'UNSUPPORTED', 'ERROR', 'PENDING', 'UNAVAILABLE']);

export const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
  password: z.string().min(4).max(128),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  locationAccuracy: z.coerce.number().min(0).max(100000).optional(),
  locationStatus: locationStatusEnum.optional(),
  locationCapturedAt: z.string().datetime().optional(),
}).superRefine((value, context) => {
  if (value.locationStatus === 'GRANTED' &&
      (value.latitude === undefined || value.longitude === undefined || value.locationCapturedAt === undefined)) {
    context.addIssue({ code: 'custom', path: ['locationStatus'], message: 'GRANTED location requires latitude, longitude, and locationCapturedAt' });
  }
});

export type LoginRequest = z.infer<typeof loginSchema>;

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
