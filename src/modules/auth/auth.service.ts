import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import {
  findUserForAuthentication,
  insertRefreshToken,
  recordFailedLogin,
  recordSuccessfulLogin,
  revokeRefreshToken,
  revokeAllRefreshTokens,
  rotateRefreshToken,
} from './auth.repository.js';
import type { AuthenticatedUser } from './auth.types.js';

const issuer = 'qin-star-pay-api';
const audience = 'qin-star-pay-web';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function ttlToMilliseconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl);
  if (!match) throw new Error(`Unsupported token TTL: ${ttl}`);
  const value = Number(match[1]);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return value * multipliers[match[2] as keyof typeof multipliers];
}

type RequestContext = { ipAddress?: string | undefined; userAgent?: string | undefined };

function signAccessToken(user: AuthenticatedUser): string {
  return jwt.sign(
    { partyId: user.partyId, email: user.email, roles: user.roles, permissions: user.permissions, mustChangePassword: user.mustChangePassword },
    env.JWT_ACCESS_SECRET,
    { subject: user.userId, issuer, audience, expiresIn: env.JWT_ACCESS_TTL as NonNullable<SignOptions['expiresIn']> },
  );
}

function signRefreshToken(userId: string, tokenId: string): string {
  return jwt.sign({ tokenId, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
    subject: userId,
    issuer,
    audience,
    expiresIn: env.JWT_REFRESH_TTL as NonNullable<SignOptions['expiresIn']>,
  });
}

async function buildTokenPair(user: AuthenticatedUser, context: RequestContext) {
  const tokenId = randomUUID();
  const refreshToken = signRefreshToken(user.userId, tokenId);
  const expiresAt = new Date(Date.now() + ttlToMilliseconds(env.JWT_REFRESH_TTL));
  return {
    accessToken: signAccessToken(user),
    refreshToken,
    refreshRecord: { id: tokenId, userId: user.userId, tokenHash: hashToken(refreshToken), expiresAt, ...context },
  };
}

export async function login(identifier: string, password: string, context: RequestContext) {
  const user = await findUserForAuthentication(identifier);
  if (!user) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email, mobile, or password');
  if (user.status !== 'ACTIVE') throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active');
  if (user.lockedUntil && user.lockedUntil > new Date()) throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    await recordFailedLogin(user.userId);
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email, mobile, or password');
  }

  await recordSuccessfulLogin(user.userId);
  const authUser: AuthenticatedUser = {
    userId: user.userId,
    partyId: user.partyId,
    email: user.email,
    roles: user.roles,
    permissions: user.permissions,
    mustChangePassword: user.mustChangePassword,
  };
  const pair = await buildTokenPair(authUser, context);
  await withTransaction((connection) => insertRefreshToken(connection, pair.refreshRecord));
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL, user: { ...authUser, name: user.fullName } };
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer, audience }) as JwtPayload;
    if (!decoded.sub) throw new Error('Missing subject');
    return {
      userId: decoded.sub,
      partyId: typeof decoded.partyId === 'string' ? decoded.partyId : null,
      email: String(decoded.email),
      roles: Array.isArray(decoded.roles) ? decoded.roles.map(String) : [],
      permissions: Array.isArray(decoded.permissions) ? decoded.permissions.map(String) : [],
      mustChangePassword: decoded.mustChangePassword === true,
    };
  } catch {
    throw new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid or expired');
  }
}

export async function refresh(refreshToken: string, context: RequestContext) {
  let decoded: JwtPayload;
  try {
    decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, { issuer, audience }) as JwtPayload;
  } catch {
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }
  if (!decoded.sub || decoded.type !== 'refresh') throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  const user = await findUserForAuthentication(decoded.sub);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is no longer valid');
  const authUser = { userId: user.userId, partyId: user.partyId, email: user.email, roles: user.roles, permissions: user.permissions, mustChangePassword: user.mustChangePassword };
  const pair = await buildTokenPair(authUser, context);
  const rotated = await withTransaction((connection) => rotateRefreshToken(connection, hashToken(refreshToken), pair.refreshRecord));
  if (!rotated) throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used or revoked');
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL };
}

export async function logout(refreshToken: string): Promise<void> {
  await revokeRefreshToken(hashToken(refreshToken));
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, context: RequestContext) {
  const user = await findUserForAuthentication(userId);
  if (!user || user.status !== 'ACTIVE') throw new ApiError(404, 'USER_NOT_FOUND', 'Active user account not found');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ApiError(401, 'CURRENT_PASSWORD_INVALID', 'Current password is incorrect');
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new ApiError(422, 'PASSWORD_UNCHANGED', 'New password must be different from the current password');
  }
  const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);
  const authUser: AuthenticatedUser = { ...user, mustChangePassword: false };
  const pair = await buildTokenPair(authUser, context);
  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6), must_change_password = FALSE,
       failed_login_count = 0, locked_until = NULL, version = version + 1 WHERE id = ?`,
      [passwordHash, userId],
    );
    await revokeAllRefreshTokens(connection, userId);
    await insertRefreshToken(connection, pair.refreshRecord);
    await connection.execute(
      `INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, outcome)
       VALUES (?, 'PASSWORD_CHANGED', 'USER', ?, 'SUCCESS')`,
      [userId, userId],
    );
  });
  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL };
}
