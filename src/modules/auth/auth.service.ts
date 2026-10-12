import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { withTransaction } from '../../database/pool.js';
import { ApiError } from '../../shared/api-error.js';
import { writeAuditLog, writeAuditLogVoid } from '../../shared/audit.js';
import { insertLoginHistoryVoid, insertLoginHistory } from '../../shared/login-history.js';
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
import { dispatchEvent } from '../notifications/notification.service.js';

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

type RequestContext = {
  ip?: string | undefined;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
  grantScopes?: string[] | null | undefined;
  latitude?: number | null | undefined;
  longitude?: number | null | undefined;
  locationAccuracy?: number | null | undefined;
  locationStatus?: 'GRANTED' | 'DENIED' | 'TIMEOUT' | 'UNSUPPORTED' | 'ERROR' | 'PENDING' | 'UNAVAILABLE' | undefined;
  locationCapturedAt?: string | null | undefined;
};

const getIp = (ctx?: RequestContext): string | null | undefined => {
  if (!ctx) return undefined;
  return ctx.ip ?? ctx.ipAddress;
};

const getUserAgent = (ctx?: RequestContext): string | null | undefined => {
  if (!ctx) return undefined;
  return ctx.userAgent;
};

const forLoginHistory = (v: string | null | undefined): string | null => v ?? null;
const forRefreshRecord = (v: string | null | undefined): string | undefined => (v === null ? undefined : v ?? undefined);

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
    refreshRecord: { id: tokenId, userId: user.userId, tokenHash: hashToken(refreshToken), expiresAt, ipAddress: forRefreshRecord(getIp(context)), userAgent: forRefreshRecord(getUserAgent(context)) },
  };
}

export async function login(identifier: string, password: string, ctx: RequestContext) {
  const user = await findUserForAuthentication(identifier);
  const ipAddress = getIp(ctx);
  const userAgent = getUserAgent(ctx);
  const requestId = ctx?.requestId;
  const grantScopes = ctx?.grantScopes ?? null;
  const locationFields = {
    latitude: ctx?.latitude ?? null,
    longitude: ctx?.longitude ?? null,
    locationAccuracy: ctx?.locationAccuracy ?? null,
    locationStatus: ctx?.locationStatus ?? 'UNAVAILABLE',
    locationCapturedAt: ctx?.locationCapturedAt ?? null,
  } as const;

  if (!user) {
    const failReason = 'NOT_FOUND';
    insertLoginHistoryVoid({
      userId: null,
      result: 'FAILED',
      failReason,
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'PASSWORD',
      ...locationFields,
    });
    writeAuditLogVoid(
      {
        action: 'LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: null,
        outcome: 'FAILURE',
        metadata: { identifier, failReason, ...locationFields },
      },
      { requestId, ipAddress, userAgent },
    );
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email, mobile, or password');
  }

  const resolvedUserId = user.userId;
  const roles = user.roles;

  if (user.status !== 'ACTIVE') {
    const failReason = user.status === 'INACTIVE' ? 'NOT_FOUND' : 'UNVERIFIED';
    insertLoginHistoryVoid({
      userId: resolvedUserId,
      result: 'FAILED',
      failReason,
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'PASSWORD',
      ...locationFields,
    });
    writeAuditLogVoid(
      {
        action: 'LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: resolvedUserId,
        outcome: 'FAILURE',
        metadata: { identifier, failReason, ...locationFields },
      },
      { actorUserId: resolvedUserId, requestId, ipAddress, userAgent },
    );
    throw new ApiError(403, 'ACCOUNT_NOT_ACTIVE', 'This account is not active');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const failReason = 'LOCKED';
    insertLoginHistoryVoid({
      userId: resolvedUserId,
      result: 'FAILED',
      failReason,
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'PASSWORD',
      ...locationFields,
    });
    writeAuditLogVoid(
      {
        action: 'LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: resolvedUserId,
        outcome: 'FAILURE',
        metadata: { identifier, failReason, ...locationFields },
      },
      { actorUserId: resolvedUserId, requestId, ipAddress, userAgent },
    );
    throw new ApiError(423, 'ACCOUNT_LOCKED', 'Account is temporarily locked');
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    await recordFailedLogin(user.userId);
    const failReason = 'BAD_PASSWORD';
    insertLoginHistoryVoid({
      userId: resolvedUserId,
      result: 'FAILED',
      failReason,
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'PASSWORD',
      ...locationFields,
    });
    writeAuditLogVoid(
      {
        action: 'LOGIN_FAILED',
        resourceType: 'USER',
        resourceId: resolvedUserId,
        outcome: 'FAILURE',
        metadata: { identifier, failReason, ...locationFields },
      },
      { actorUserId: resolvedUserId, requestId, ipAddress, userAgent },
    );
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
  const pair = await buildTokenPair(authUser, ctx);
  await withTransaction((connection) => insertRefreshToken(connection, pair.refreshRecord));

  const userId = resolvedUserId;
  await insertLoginHistory({
    userId,
    sessionId: pair.refreshRecord.id,
    result: 'SUCCESS',
    ipAddress: forLoginHistory(ipAddress),
    userAgent: forLoginHistory(userAgent),
    loginMethod: 'PASSWORD',
    metadata: { roles },
    ...locationFields,
  });
  await writeAuditLog(
    {
      action: 'LOGIN_SUCCESS',
      resourceType: 'USER',
      resourceId: userId,
      metadata: { sessionId: pair.refreshRecord.id, roles, grant_scopes: grantScopes, ...locationFields },
    },
    { actorUserId: userId, requestId, ipAddress, userAgent },
  );

  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL, sessionId: pair.refreshRecord.id, user: { ...authUser, name: user.fullName } };
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

export async function refresh(refreshToken: string, ctx: RequestContext) {
  const ipAddress = getIp(ctx);
  const userAgent = getUserAgent(ctx);
  const requestId = ctx?.requestId;

  let decoded: JwtPayload;
  let resolvedUserId: string | null = null;

  try {
    decoded = jwt.verify(refreshToken, env.JWT_REFRESH_SECRET, { issuer, audience }) as JwtPayload;
    if (decoded.sub) resolvedUserId = decoded.sub;
  } catch {
    insertLoginHistoryVoid({
      userId: null,
      result: 'FAILED',
      failReason: 'TOKEN_EXPIRED',
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'REFRESH_TOKEN',
    });
    writeAuditLogVoid(
      {
        action: 'REFRESH_FAILED',
        resourceType: 'SESSION',
        resourceId: null,
        outcome: 'FAILURE',
        metadata: { failReason: 'TOKEN_EXPIRED' },
      },
      { requestId, ipAddress, userAgent },
    );
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired');
  }

  if (!decoded.sub || decoded.type !== 'refresh') {
    insertLoginHistoryVoid({
      userId: resolvedUserId,
      result: 'FAILED',
      failReason: 'TAMPERED',
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'REFRESH_TOKEN',
    });
    writeAuditLogVoid(
      {
        action: 'REFRESH_FAILED',
        resourceType: 'SESSION',
        resourceId: resolvedUserId,
        outcome: 'FAILURE',
        metadata: { failReason: 'TAMPERED' },
      },
      { actorUserId: resolvedUserId ?? undefined, requestId, ipAddress, userAgent },
    );
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  const user = await findUserForAuthentication(decoded.sub);
  if (!user || user.status !== 'ACTIVE') {
    insertLoginHistoryVoid({
      userId: resolvedUserId,
      result: 'FAILED',
      failReason: 'NOT_FOUND',
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'REFRESH_TOKEN',
    });
    writeAuditLogVoid(
      {
        action: 'REFRESH_FAILED',
        resourceType: 'SESSION',
        resourceId: resolvedUserId,
        outcome: 'FAILURE',
        metadata: { failReason: 'NOT_FOUND' },
      },
      { actorUserId: resolvedUserId ?? undefined, requestId, ipAddress, userAgent },
    );
    throw new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is no longer valid');
  }

  const authUser = { userId: user.userId, partyId: user.partyId, email: user.email, roles: user.roles, permissions: user.permissions, mustChangePassword: user.mustChangePassword };
  const pair = await buildTokenPair(authUser, ctx);
  const rotated = await withTransaction((connection) => rotateRefreshToken(connection, hashToken(refreshToken), pair.refreshRecord));
  if (!rotated) {
    insertLoginHistoryVoid({
      userId: user.userId,
      result: 'FAILED',
      failReason: 'REVOKED',
      ipAddress: forLoginHistory(ipAddress),
      userAgent: forLoginHistory(userAgent),
      loginMethod: 'REFRESH_TOKEN',
      refreshJti: decoded.tokenId ? String(decoded.tokenId) : null,
    });
    writeAuditLogVoid(
      {
        action: 'REFRESH_FAILED',
        resourceType: 'SESSION',
        resourceId: user.userId,
        outcome: 'FAILURE',
        metadata: { failReason: 'REVOKED' },
      },
      { actorUserId: user.userId, requestId, ipAddress, userAgent },
    );
    throw new ApiError(401, 'REFRESH_TOKEN_REUSED', 'Refresh token has already been used or revoked');
  }

  insertLoginHistoryVoid({
    userId: user.userId,
    sessionId: pair.refreshRecord.id,
    result: 'REFRESH',
    ipAddress: forLoginHistory(ipAddress),
    userAgent: forLoginHistory(userAgent),
    loginMethod: 'REFRESH_TOKEN',
    refreshJti: pair.refreshRecord.id,
  });
  writeAuditLogVoid(
    {
      action: 'REFRESH_SUCCESS',
      resourceType: 'SESSION',
      resourceId: user.userId,
      metadata: { refreshJti: pair.refreshRecord.id },
    },
    { actorUserId: user.userId, requestId, ipAddress, userAgent },
  );

  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL };
}

export async function logout(refreshToken: string, ctx?: RequestContext & { userId?: string | null }): Promise<void> {
  const ipAddress = getIp(ctx);
  const userAgent = getUserAgent(ctx);
  const requestId = ctx?.requestId;
  const actorUserId = ctx?.userId ?? null;

  let decodedJti: string | null = null;
  let decodedUserId: string | null = null;

  try {
    const decoded = jwt.decode(refreshToken) as JwtPayload | null;
    if (decoded) {
      if (decoded.tokenId) decodedJti = String(decoded.tokenId);
      if (decoded.sub) decodedUserId = decoded.sub;
    }
  } catch {
    // best effort
  }

  const effectiveUserId = actorUserId ?? decodedUserId;

  await revokeRefreshToken(hashToken(refreshToken));

  // TODO: if logout endpoint later exposes session_id or a full session listing,
  // link LOGOUT rows to the original SUCCESS/REFRESH row via session_id foreign key.
  insertLoginHistoryVoid({
    userId: effectiveUserId,
    result: 'LOGGED_OUT',
    ipAddress: forLoginHistory(ipAddress),
    userAgent: forLoginHistory(userAgent),
    loginMethod: 'REFRESH_TOKEN',
    refreshJti: decodedJti,
  });
  writeAuditLogVoid(
    {
      action: 'LOGOUT',
      resourceType: 'SESSION',
      resourceId: effectiveUserId,
      metadata: { refreshJti: decodedJti },
    },
    { actorUserId: effectiveUserId ?? undefined, requestId, ipAddress, userAgent },
  );
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, ctx?: RequestContext) {
  const ipAddress = getIp(ctx);
  const userAgent = getUserAgent(ctx);
  const requestId = ctx?.requestId;

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
  const pair = await buildTokenPair(authUser, ctx ?? {});
  await withTransaction(async (connection) => {
    await connection.execute(
      `UPDATE users SET password_hash = ?, password_changed_at = UTC_TIMESTAMP(6), must_change_password = FALSE,
       failed_login_count = 0, locked_until = NULL, version = version + 1 WHERE id = ?`,
      [passwordHash, userId],
    );
    await revokeAllRefreshTokens(connection, userId);
    await insertRefreshToken(connection, pair.refreshRecord);
    await writeAuditLog(
      { action: 'PASSWORD_CHANGED', resourceType: 'USER', resourceId: userId, outcome: 'SUCCESS' },
      { actorUserId: userId, actorPartyId: user.partyId ?? null, requestId, ipAddress, userAgent },
      connection
    );
  });

  insertLoginHistoryVoid({
    userId,
    sessionId: pair.refreshRecord.id,
    result: 'SUCCESS',
    loginMethod: 'PASSWORD',
    ipAddress: forLoginHistory(ipAddress),
    userAgent: forLoginHistory(userAgent),
    metadata: { changedBy: 'SELF' },
  });
  // NOTE: for ADMIN_RESET password flow, add a parallel insertLoginHistoryVoid
  // with changedBy: 'ADMIN' and actorUserId set to the admin performing the reset.

  // Best-effort password-change notification (never auth flow failures)
  try {
    void dispatchEvent(
      {
        type: 'PASSWORD_CHANGED',
        category: 'USER',
        severity: 'WARNING',
        title: 'Your password was changed',
        message: 'Your Qin Star Pay account password was just updated. If you did not perform this action, contact support immediately.',
        entityType: 'USER',
        entityId: userId,
        metadata: { ip: ipAddress || null, userAgent: userAgent || null },
      },
      { kind: 'USER_IDS', userIds: [userId] },
      userId
    );
  } catch {
    // never propagate
  }

  return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, tokenType: 'Bearer', expiresIn: env.JWT_ACCESS_TTL };
}
