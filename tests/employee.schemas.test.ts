import { describe, expect, it } from 'vitest';
import { createEmployeeSchema, resetEmployeePasswordSchema, updateEmployeeSchema, updateEmployeeStatusSchema } from '../src/modules/employees/employee.schemas.js';

describe('employee API validation', () => {
  it('accepts the complete employee creation contract including shift', () => {
    const result = createEmployeeSchema.safeParse({
      employeeCode: 'EMP_OPS_001', fullName: 'Operations User', email: 'ops@example.com',
      mobile: '9876543210', departmentCode: 'OPERATIONS', roleId: 5,
      joiningDate: '2026-10-08', shiftCode: 'EVENING',
    });
    expect(result.success).toBe(true);
  });

  it('requires an audit reason for profile and status changes', () => {
    expect(updateEmployeeStatusSchema.safeParse({ status: 'SUSPENDED' }).success).toBe(false);
    expect(updateEmployeeSchema.safeParse({
      fullName: 'Operations User', email: 'ops@example.com', departmentCode: 'OPERATIONS',
      roleId: 5, shiftCode: 'MORNING', reason: 'Role reassignment approved',
    }).success).toBe(true);
  });

  it('allows a generated reset password while requiring a reason', () => {
    expect(resetEmployeePasswordSchema.safeParse({ reason: 'Employee requested account recovery' }).success).toBe(true);
    expect(resetEmployeePasswordSchema.safeParse({}).success).toBe(false);
  });
});
