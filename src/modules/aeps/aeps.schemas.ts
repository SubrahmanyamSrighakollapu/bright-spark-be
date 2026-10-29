import { z } from 'zod';

const aadhaar = z.string().regex(/^\d{12}$/, 'Aadhaar must contain 12 digits');
const mobile = z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid Indian mobile number');
const location = { latitude: z.coerce.number().min(-90).max(90), longitude: z.coerce.number().min(-180).max(180), mobileDeviceId: z.string().trim().min(1).max(200) };
export const bioSchema = z.object({ bioType: z.enum(['0', '1', '2']), pidData: z.string().min(20).max(100_000), ...location });

export const onboardingSchema = z.object({
  transactionId: z.string().trim().min(8).max(100), name: z.string().trim().min(2).max(160), mobile, email: z.string().email(),
  pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}\d{4}[A-Z]$/), aadhaar, dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  agentCode: z.string().trim().min(2).max(100), address: z.string().trim().min(5).max(500), state: z.string().trim().min(2).max(100),
  city: z.string().trim().min(2).max(100), pin: z.string().regex(/^\d{6}$/), bankName: z.string().trim().min(2).max(160),
  accountNumber: z.string().regex(/^\d{6,20}$/), ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/),
  shopName: z.string().trim().min(2).max(200), shopAddress: z.string().trim().min(5).max(500), isPhysicalVerified: z.boolean(), ...location,
});
export const eligibilitySchema = z.object({ ...location });
export const otpSchema = z.object({ transactionId: z.string().trim().min(8).max(100), amount: z.coerce.number().positive().max(100_000), bankIin: z.string().regex(/^\d{5,12}$/), mobile, aadhaar, ...location });
export const transactionSchema = z.object({
  transactionId: z.string().trim().min(8).max(100), serviceType: z.enum(['CASH_WITHDRAWAL','BALANCE_ENQUIRY','MINI_STATEMENT']),
  amount: z.coerce.number().min(0).max(100_000).optional(), bankName: z.string().trim().min(2).max(160), bankIin: z.string().regex(/^\d{5,12}$/),
  mobile, aadhaar, otpReference: z.string().trim().max(200).optional(), bioType: z.enum(['0','1','2']), pidData: z.string().min(20).max(100_000), ...location,
}).superRefine((value, ctx) => { if (value.serviceType === 'CASH_WITHDRAWAL' && (!value.amount || value.amount <= 0)) ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Amount is required for cash withdrawal' }); });
