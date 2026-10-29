import { env } from '../../config/env.js';
import { ApiError } from '../../shared/api-error.js';

type ProviderObject = Record<string, unknown>;
type TokenCache = { value: string; expiresAt: number } | null;

let tokenCache: TokenCache = null;

const timestamp = () => new Date().toISOString().slice(0, 19);
const objectValue = (value: unknown): ProviderObject => value && typeof value === 'object' && !Array.isArray(value) ? value as ProviderObject : {};
const stringValue = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

function providerError(status: number, body: unknown): ApiError {
  const root = objectValue(body); const data = objectValue(root.data); const error = objectValue(root.error);
  const message = stringValue(root.message) || stringValue(root.description) || stringValue(data.message)
    || stringValue(error.message) || 'The AEPS provider rejected the request';
  return new ApiError(status >= 400 && status < 600 ? status : 502, 'AEPS_PROVIDER_ERROR', message);
}

async function fetchJson(url: string, init: RequestInit): Promise<{ body: unknown; headers: Headers; status: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.NOBLE_HTTP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let body: unknown = {};
    if (text) { try { body = JSON.parse(text); } catch { body = { message: text.slice(0, 500) }; } }
    if (!response.ok) throw providerError(response.status, body);
    return { body, headers: response.headers, status: response.status };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.name === 'AbortError') throw new ApiError(504, 'AEPS_PROVIDER_TIMEOUT', 'The AEPS provider did not respond in time');
    throw new ApiError(502, 'AEPS_PROVIDER_UNAVAILABLE', 'The AEPS provider is currently unavailable');
  } finally { clearTimeout(timeout); }
}

function assertEnabled(): void {
  if (!env.NOBLE_AEPS_ENABLED) throw new ApiError(503, 'AEPS_PROVIDER_NOT_CONFIGURED', 'AEPS provider integration is not enabled');
  if (!env.NOBLE_API_KEY || !env.NOBLE_API_VALUE) throw new ApiError(503, 'AEPS_PROVIDER_NOT_CONFIGURED', 'AEPS provider credentials are not configured');
}

async function authenticate(): Promise<string> {
  assertEnabled();
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) return tokenCache.value;
  const result = await fetchJson(`${env.NOBLE_AUTH_BASE_URL.replace(/\/$/, '')}/client_auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Timestamp': timestamp() },
    body: JSON.stringify({ apiKey: env.NOBLE_API_KEY, apiValue: env.NOBLE_API_VALUE }),
  });
  const root = objectValue(result.body); const data = objectValue(root.data);
  const authorization = stringValue(result.headers.get('authorization'))?.replace(/^Bearer\s+/i, '');
  const token = authorization || stringValue(result.headers.get('x-auth-token')) || stringValue(root.accessToken)
    || stringValue(result.headers.get('token')) || stringValue(root.token) || stringValue(root.authToken)
    || stringValue(data.accessToken) || stringValue(data.token) || stringValue(data.authToken) || stringValue(data.jwtToken);
  if (!token) throw new ApiError(502, 'AEPS_AUTH_RESPONSE_INVALID', 'AEPS authorization succeeded without returning an access token');
  const expiresIn = Number(root.expiresIn ?? data.expiresIn);
  tokenCache = { value: token, expiresAt: Date.now() + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn * 1000 : 5 * 60_000) };
  return token;
}

export async function nobleAepsRequest(path: string, payload: ProviderObject, options: { retryAuthentication?: boolean } = {}): Promise<unknown> {
  const token = await authenticate();
  try {
    const result = await fetchJson(`${env.NOBLE_AEPS_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Timestamp': timestamp(), Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    return result.body;
  } catch (error) {
    if (options.retryAuthentication !== false && error instanceof ApiError && error.statusCode === 401) {
      tokenCache = null;
      const refreshed = await authenticate();
      const result = await fetchJson(`${env.NOBLE_AEPS_BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Timestamp': timestamp(), Authorization: `Bearer ${refreshed}` },
        body: JSON.stringify(payload),
      });
      return result.body;
    }
    throw error;
  }
}

export const nobleAepsConfiguration = () => ({ enabled: env.NOBLE_AEPS_ENABLED, provider: 'NOBLE', environment: env.NODE_ENV });
