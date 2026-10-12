import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema } from '../src/modules/auth/auth.schemas.js';

describe('first-login password validation', () => {
  it('allows the four-digit temporary employee password at login', () => {
    expect(loginSchema.safeParse({ identifier: '9876543210', password: '3210' }).success).toBe(true);
  });

  it('accepts a pending asynchronous browser location decision', () => {
    expect(loginSchema.safeParse({ identifier: 'user@example.com', password: 'Password1!', locationStatus: 'PENDING' }).success).toBe(true);
  });

  it('requires complete coordinates when browser location is granted', () => {
    expect(loginSchema.safeParse({ identifier: 'user@example.com', password: 'Password1!', locationStatus: 'GRANTED' }).success).toBe(false);
    expect(loginSchema.safeParse({
      identifier: 'user@example.com', password: 'Password1!', locationStatus: 'GRANTED',
      latitude: 17.385, longitude: 78.4867, locationAccuracy: 25,
      locationCapturedAt: '2026-10-11T10:00:00.000Z',
    }).success).toBe(true);
  });

  it('requires a strong and different permanent password', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: '3210', newPassword: 'Qin@1234' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: '3210', newPassword: 'weakpassword' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'Secure@Password123', newPassword: 'Secure@Password123' }).success).toBe(false);
  });
});
