import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../src/database/pool.js', () => ({ pool: { query } }));
import { findUserForAuthentication } from '../src/modules/auth/auth.repository.js';

const user = {
  id: 'a-user-uuid', party_id: 'a-party-uuid', email: 'employee@example.com',
  full_name: 'Employee', password_hash: 'hash', status: 'ACTIVE',
  failed_login_count: 0, locked_until: null, must_change_password: 1,
  roles: 'OPERATIONS', permissions: 'EMPLOYEE_READ',
};

describe('authentication lookup', () => {
  beforeEach(() => query.mockReset());

  it.each(['EMPOPS001', 'EMPACC001', 'EMPKYC001', 'EMPSAL001', 'MD123', 'DST123', 'RET123', 'employee@example.com'])(
    'resolves %s to the same account and password record', async (identifier) => {
      query.mockResolvedValue([[user]]);
      const result = await findUserForAuthentication(` ${identifier} `, true);
      expect(query.mock.calls[0]?.[1]).toEqual(Array(4).fill(identifier));
      expect(result).toMatchObject({ userId: user.id, passwordHash: 'hash', mustChangePassword: true });
    },
  );

  it('rejects ambiguous identifiers instead of picking an account', async () => {
    query.mockResolvedValue([[user, { ...user, id: 'another-user' }]]);
    expect(await findUserForAuthentication('RET123', true)).toBeNull();
  });

  it('returns no account for unknown identifiers', async () => {
    query.mockResolvedValue([[]]);
    expect(await findUserForAuthentication('UNKNOWN', true)).toBeNull();
  });

  it('limits internal refresh and password lookups to the exact user UUID', async () => {
    query.mockResolvedValue([[user]]);
    await findUserForAuthentication(user.id);
    expect(query.mock.calls[0]?.[0]).toContain('WHERE u.deleted_at IS NULL AND u.id = ?');
    expect(query.mock.calls[0]?.[1]).toEqual([user.id]);
  });

  it('guards public alternative identifiers against admin and shared platform accounts', async () => {
    query.mockResolvedValue([[]]);
    await findUserForAuthentication('EMPOPS001', true);
    const sql = query.mock.calls[0]?.[0] as string;
    expect(sql).toContain("admin_role.code IN ('ADMIN', 'SUPER_ADMIN')");
    expect(sql).toContain('ep.user_id = u.id AND ep.employee_code = ?');
    expect(sql).toContain("party.party_type IN ('MASTER_DISTRIBUTOR', 'DISTRIBUTOR', 'RETAILER')");
    expect(sql).not.toContain('u.id = ?');
  });
});
