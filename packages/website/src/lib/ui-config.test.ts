import { describe, it, expect } from 'vitest';
import { setUIConfig, getUIConfig, resetUIConfig } from './ui-config';

describe('UIConfig', () => {
  it('throws when getUIConfig is called before setUIConfig', () => {
    resetUIConfig();
    expect(() => getUIConfig()).toThrow('UIConfig not initialized');
  });

  it('returns config after setUIConfig', () => {
    resetUIConfig();
    const config = {
      baseDomain: 'example.com',
      Link: () => null,
    };
    setUIConfig(config);
    expect(getUIConfig()).toBe(config);
  });

  it('resets config', () => {
    resetUIConfig();
    setUIConfig({ baseDomain: 'test.com', Link: () => null });
    resetUIConfig();
    expect(() => getUIConfig()).toThrow('UIConfig not initialized');
  });
});
