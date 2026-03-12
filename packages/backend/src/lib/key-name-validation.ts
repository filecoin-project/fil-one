import validator from 'validator';

/** Minimum length for an access key name (after trimming). */
export const KEY_NAME_MIN_LENGTH = 1;

/** Maximum length for an access key name (after trimming). */
export const KEY_NAME_MAX_LENGTH = 256;

export interface KeyNameValidationResult {
  valid: boolean;
  sanitized: string;
  error?: string;
}

/**
 * Validates and sanitizes an access key name.
 *
 * - Trims whitespace
 * - Escapes HTML entities to prevent XSS
 * - Enforces min/max length
 */
export function validateKeyName(raw: unknown): KeyNameValidationResult {
  if (typeof raw !== 'string') {
    return { valid: false, sanitized: '', error: 'Key name must be a string.' };
  }

  const trimmed = validator.trim(raw);

  if (!validator.isLength(trimmed, { min: KEY_NAME_MIN_LENGTH })) {
    return {
      valid: false,
      sanitized: trimmed,
      error: `Key name must be at least ${KEY_NAME_MIN_LENGTH} character.`,
    };
  }

  if (!validator.isLength(trimmed, { max: KEY_NAME_MAX_LENGTH })) {
    return {
      valid: false,
      sanitized: trimmed,
      error: `Key name must be at most ${KEY_NAME_MAX_LENGTH} characters.`,
    };
  }

  const sanitized = validator.escape(trimmed);

  return { valid: true, sanitized };
}
