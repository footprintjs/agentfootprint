import { describe, expect, it } from 'vitest';
import {
  BEDROCK_CACHE_MODELS,
  bedrockCacheFacts,
} from '../../../src/adapters/llm/bedrockModels.js';

describe('Bedrock explicit Converse model table is fail-closed', () => {
  it('every listed model has four checkpoints and no prototype keys are models', () => {
    for (const [id, facts] of Object.entries(BEDROCK_CACHE_MODELS)) {
      expect(bedrockCacheFacts(id)).toBe(facts);
      expect(facts.maxBreakpoints).toBe(4);
      expect(Object.isFrozen(facts)).toBe(true);
      for (const profile of facts.profiles)
        expect(bedrockCacheFacts(`${profile}.${id}`)).toBe(facts);
    }
    for (const id of [
      '__proto__',
      'constructor',
      'toString',
      'anthropic.claude-sonnet-4-5',
      'bedrock',
      '',
    ])
      expect(bedrockCacheFacts(id)).toBeUndefined();
  });

  it('accepts only the model-specific profile list, never a geography cross product', () => {
    const haiku = 'anthropic.claude-haiku-4-5-20251001-v1:0';
    expect(bedrockCacheFacts(`in.${haiku}`)).toBeDefined();
    expect(bedrockCacheFacts(`apac.${haiku}`)).toBeUndefined();
    expect(bedrockCacheFacts('ca.amazon.nova-lite-v1:0')).toBeDefined();
    expect(bedrockCacheFacts('global.amazon.nova-2-lite-v1:0')).toBeDefined();
    expect(bedrockCacheFacts('global.amazon.nova-pro-v1:0')).toBeUndefined();
    expect(bedrockCacheFacts('apac.amazon.nova-micro-v1:0')).toBeUndefined();
    expect(bedrockCacheFacts('us.anthropic.claude-opus-5-5')).toBeUndefined();
  });

  it('does not guess an ARN, custom alias, suffix, or nested profile target', () => {
    const id = 'anthropic.claude-sonnet-4-5-20250929-v1:0';
    for (const unknown of [
      `us.us.${id}`,
      `arn:aws:bedrock:us-east-1::foundation-model/${id}`,
      `arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.${id}`,
      `${id}-alias`,
      `${id}\n`,
      id.toUpperCase(),
    ])
      expect(bedrockCacheFacts(unknown)).toBeUndefined();
  });
});
