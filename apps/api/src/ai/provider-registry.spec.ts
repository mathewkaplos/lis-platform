import { afterEach, describe, expect, it } from 'vitest';
import { selectProvider } from './provider-registry';
import { StubProvider } from './providers/stub-provider';
import { TemplateProvider } from './providers/template-provider';

describe('ai.module: selectProvider (config-driven provider swap, FEAT-041 AC #2)', () => {
  const originalProvider = process.env.AI_PROVIDER;

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.AI_PROVIDER;
    } else {
      process.env.AI_PROVIDER = originalProvider;
    }
  });

  it('defaults to TemplateProvider when AI_PROVIDER is unset (FEAT-042)', () => {
    delete process.env.AI_PROVIDER;
    expect(selectProvider()).toBeInstanceOf(TemplateProvider);
  });

  it('selects the provider named by AI_PROVIDER, not a hardcoded default', () => {
    process.env.AI_PROVIDER = 'stub';
    expect(selectProvider()).toBeInstanceOf(StubProvider);
  });

  it('throws for an unregistered provider id, rather than silently falling back', () => {
    process.env.AI_PROVIDER = 'not-a-real-provider';
    expect(() => selectProvider()).toThrow(/Unknown AI_PROVIDER/);
  });
});
