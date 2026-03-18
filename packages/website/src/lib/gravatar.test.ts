import { describe, expect, it } from 'vitest';
import { getGravatarUrl } from './gravatar';

describe('getGravatarUrl', () => {
  it('returns a gravatar URL for a normalized email address', () => {
    expect(getGravatarUrl(' User@example.com ')).toBe(
      'https://www.gravatar.com/avatar/b58996c504c5638798eb6b511e6f49af?d=identicon&s=32',
    );
  });

  it('returns null when no email is available', () => {
    expect(getGravatarUrl()).toBeNull();
    expect(getGravatarUrl('   ')).toBeNull();
  });
});
