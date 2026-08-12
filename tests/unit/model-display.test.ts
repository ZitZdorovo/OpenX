import { describe, expect, it } from 'vitest';
import {
  formatAutomaticModelName,
  groupConfiguredModels,
  parseModelVariant,
  resolveGroupVariant,
  resolveModelDisplayName,
} from '../../src/lib/model-display';
import type { ConfiguredModelOption } from '../../src/lib/model-options';

function option(modelRef: string): ConfiguredModelOption {
  return { modelRef, label: modelRef, runtimeProviderKey: 'custom-test', accountId: 'test' };
}

describe('model display preferences', () => {
  it('derives readable names and separates thinking suffixes', () => {
    expect(formatAutomaticModelName('custom-a/codex/gpt-5-6-sol-high')).toBe('GPT 5.6 Sol');
    expect(parseModelVariant('custom-a/codex/gpt-5-6-sol-high')).toMatchObject({ baseKey: 'gpt-5-6-sol', level: 'high' });
    expect(formatAutomaticModelName('provider/claude-3.5-sonnet-low')).toBe('Claude Sonnet 3.5');
  });

  it('groups variants and resolves the saved thinking effort', () => {
    const groups = groupConfiguredModels([option('provider/model-low'), option('provider/model-high')]);
    expect(groups).toHaveLength(1);
    expect(resolveGroupVariant(groups[0], 'high').modelRef).toBe('provider/model-high');
  });

  it('maps Gemini model aliases to encoded low and max variants automatically', () => {
    expect(parseModelVariant('custom-customdc/agy/gemini-3.1-pro-low')).toMatchObject({
      baseKey: 'gemini-pro-agent',
      level: 'low',
    });
    expect(parseModelVariant('custom-customdc/agy/gemeni-3.1-pro-low')).toMatchObject({
      baseKey: 'gemini-pro-agent',
      level: 'low',
    });
    expect(parseModelVariant('custom-customdc/agy/gemini-pro-agent')).toMatchObject({
      baseKey: 'gemini-pro-agent',
      level: 'max',
    });
    expect(groupConfiguredModels([
      option('custom-customdc/agy/gemini-3.1-pro-low'),
      option('custom-customdc/agy/gemini-pro-agent'),
    ])).toHaveLength(1);
  });

  it('prioritizes overrides and formats catalog labels that only repeat the raw id', () => {
    expect(resolveModelDisplayName('openai/gpt-5.6-sol', 'My coding model', 'gpt-5.6-sol')).toBe('My coding model');
    expect(resolveModelDisplayName('openai/gpt-5.6-sol', null, 'gpt-5.6-sol')).toBe('GPT 5.6 Sol');
    expect(resolveModelDisplayName('vendor/acme-model', null, 'Acme Official')).toBe('Acme Official');
  });
});
