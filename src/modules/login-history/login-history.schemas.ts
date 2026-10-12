import { z } from 'zod';

export const LOGIN_HISTORY_RESULTS = ['SUCCESS', 'FAILED', 'LOCKED', 'LOGGED_OUT', 'REFRESH'] as const;

export const listSchema = z.object({
  userId: z.array(z.string().trim().min(1)).optional(),
  result: z.array(z.enum(LOGIN_HISTORY_RESULTS)).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  ip: z.string().optional(),
  keyword: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(20),
});

export const byIdSchema = z.object({
  id: z.string().trim().min(1),
});

export const sessionIdSchema = z.object({
  sessionId: z.string().trim().min(1),
});

const locationStatusEnum = z.enum(['GRANTED', 'DENIED', 'TIMEOUT', 'UNSUPPORTED', 'ERROR', 'PENDING', 'UNAVAILABLE']);

export const updateLocationSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  locationAccuracy: z.coerce.number().min(0).max(100000).optional(),
  locationStatus: locationStatusEnum,
  locationCapturedAt: z.string().datetime().optional(),
}).superRefine((value, context) => {
  if (value.locationStatus === 'GRANTED' &&
      (value.latitude === undefined || value.longitude === undefined || value.locationCapturedAt === undefined)) {
    context.addIssue({ code: 'custom', path: ['locationStatus'], message: 'GRANTED location requires latitude, longitude, and locationCapturedAt' });
  }
});

export const exportSchema = z.object({
  userId: z.array(z.string().trim().min(1)).optional(),
  result: z.array(z.enum(LOGIN_HISTORY_RESULTS)).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  ip: z.string().optional(),
  keyword: z.string().trim().max(100).optional(),
});
