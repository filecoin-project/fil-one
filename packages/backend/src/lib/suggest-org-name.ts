/**
 * Suggests an organization name based on the user's email address.
 *
 * This function is intentionally isolated so it can be easily changed or removed.
 * It is best-effort only — the suggested name is never blocking.
 */

export const PUBLIC_EMAIL_DOMAINS = new Set([
  // Google
  'gmail.com',
  'googlemail.com',
  // Microsoft
  'outlook.com',
  'hotmail.com',
  'hotmail.co.uk',
  'live.com',
  'msn.com',
  // Yahoo
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'ymail.com',
  // Apple
  'icloud.com',
  'me.com',
  'mac.com',
  // AOL
  'aol.com',
  // Proton
  'proton.me',
  'protonmail.com',
  'pm.me',
  // Other Western providers
  'zoho.com',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com',
  'tutanota.com',
  'tutamail.com',
  'tuta.io',
  'hey.com',
  // Russian providers
  'mail.ru',
  'yandex.com',
  // Chinese providers
  'qq.com',
  '163.com',
  '126.com',
]);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function suggestOrgName(email: string): string | undefined {
  const [localPart, rawDomain] = email.split('@');
  const domain = rawDomain?.toLowerCase();
  if (!domain || !localPart) return undefined;

  if (PUBLIC_EMAIL_DOMAINS.has(domain)) {
    // Public provider — use the local part as a best-effort name.
    // e.g. "alice@gmail.com" → "Alice"
    return capitalize(localPart.toLowerCase());
  }

  // Corporate domain — use the second-level domain label as the org name.
  // e.g. "alice@acme.com" → "Acme", "dev@eng.bigcorp.co.uk" → "Bigcorp"
  const parts = domain.split('.');
  const COMPOUND_TLDS = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);
  // Walk backwards: skip the TLD, skip compound SLD (co.uk, com.au, etc.)
  let idx = parts.length - 2;
  if (idx > 0 && COMPOUND_TLDS.has(parts[idx]!)) {
    idx--;
  }
  const name = parts[idx];
  if (!name) return undefined;

  return capitalize(name);
}
