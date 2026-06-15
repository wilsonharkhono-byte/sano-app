const LOCAL_LOGIN_DOMAIN = 'sano.local';

export function normalizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

export function resolveLoginEmail(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('Username atau email wajib diisi.');
  }

  if (trimmed.includes('@')) {
    return trimmed;
  }

  const username = normalizeUsername(trimmed);
  if (!username) {
    throw new Error('Username tidak valid.');
  }

  return `${username}@${LOCAL_LOGIN_DOMAIN}`;
}
