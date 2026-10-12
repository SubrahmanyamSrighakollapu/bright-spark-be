const IPV4_MAPPED_IPV6_PREFIX = '::ffff:';

export function normalizeClientIp(ip: string | undefined | null): string | null {
  if (!ip) return null;
  const trimmed = ip.trim();
  if (!trimmed) return null;

  if (trimmed === '::1') return '127.0.0.1';
  if (trimmed.toLowerCase().startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    return trimmed.slice(IPV4_MAPPED_IPV6_PREFIX.length);
  }

  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    const inner = trimmed.slice(1, -1);
    if (inner === '::1') return '127.0.0.1';
    if (inner.toLowerCase().startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
      return inner.slice(IPV4_MAPPED_IPV6_PREFIX.length);
    }
  }

  return trimmed;
}
