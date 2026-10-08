import { describe, expect, it } from 'vitest';
import { changePasswordSchema, loginSchema } from '../src/modules/auth/auth.schemas.js';

describe('first-login password validation', () => {
  it('allows the four-digit temporary employee password at login', () => {
    expect(loginSchema.safeParse({ identifier: '9876543210', password: '3210' }).success).toBe(true);
  });

  it('requires a strong and different permanent password', () => {
    expect(changePasswordSchema.safeParse({ currentPassword: '3210', newPassword: 'Qin@1234' }).success).toBe(true);
    expect(changePasswordSchema.safeParse({ currentPassword: '3210', newPassword: 'weakpassword' }).success).toBe(false);
    expect(changePasswordSchema.safeParse({ currentPassword: 'Secure@Password123', newPassword: 'Secure@Password123' }).success).toBe(false);
  });
});
