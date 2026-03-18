import md5 from 'blueimp-md5';

export function getGravatarUrl(email?: string, size = 32): string | null {
  const normalizedEmail = email?.trim().toLowerCase();
  if (!normalizedEmail) return null;

  const params = new URLSearchParams({
    d: 'identicon',
    s: String(size),
  });

  return `https://www.gravatar.com/avatar/${md5(normalizedEmail)}?${params.toString()}`;
}
