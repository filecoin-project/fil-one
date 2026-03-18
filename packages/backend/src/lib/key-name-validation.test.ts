import { describe, it, expect } from 'vitest';
import {
  validateKeyName,
  KEY_NAME_MIN_LENGTH,
  KEY_NAME_MAX_LENGTH,
} from './key-name-validation.js';

describe('validateKeyName', () => {
  it('accepts a simple valid name', () => {
    expect(validateKeyName('my-key')).toEqual({
      valid: true,
      sanitized: 'my-key',
    });
  });

  it('trims whitespace', () => {
    expect(validateKeyName('  hello  ')).toEqual({
      valid: true,
      sanitized: 'hello',
    });
  });

  it('rejects non-string input', () => {
    const result = validateKeyName(123);
    expect(result).toEqual({
      valid: false,
      sanitized: '',
      error: 'Key name must be a string.',
    });
  });

  it('rejects empty string', () => {
    const result = validateKeyName('');
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`at least ${KEY_NAME_MIN_LENGTH}`);
  });

  it('rejects whitespace-only string', () => {
    const result = validateKeyName('   ');
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`at least ${KEY_NAME_MIN_LENGTH}`);
  });

  it('rejects string exceeding max length', () => {
    const result = validateKeyName('a'.repeat(KEY_NAME_MAX_LENGTH + 1));
    expect(result.valid).toBe(false);
    expect(result.error).toContain(`at most ${KEY_NAME_MAX_LENGTH}`);
  });

  it('preserves special characters without HTML-encoding them', () => {
    const result = validateKeyName("joe's key & <stuff>");
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe("joe's key & <stuff>");
  });

  it('accepts a name exactly at max length', () => {
    const result = validateKeyName('a'.repeat(KEY_NAME_MAX_LENGTH));
    expect(result.valid).toBe(true);
    expect(result.sanitized).toBe('a'.repeat(KEY_NAME_MAX_LENGTH));
  });
});
