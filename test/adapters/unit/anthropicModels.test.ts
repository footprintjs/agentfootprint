/** Hard capability refusals need a complete known model id, not an alias substring. */
import { describe, expect, it } from 'vitest';

import {
  ANTHROPIC_MODELS,
  ANTHROPIC_THINKING_MODES,
  anthropicModelFacts,
  anthropicModelFamily,
  anthropicTakesForcedToolChoice,
  anthropicThinkingMode,
} from '../../../src/adapters/llm/anthropicModels.js';

describe('Anthropic model facts: complete identifiers only', () => {
  it.each(Object.entries(ANTHROPIC_MODELS))('uses the one frozen row for %s', (family, facts) => {
    expect(anthropicModelFamily(family)).toBe(family);
    expect(anthropicModelFacts(family)).toBe(facts);
    expect(anthropicThinkingMode(family)).toBe(facts.thinking);
    expect(ANTHROPIC_THINKING_MODES[family]).toBe(facts.thinking);
    expect(anthropicTakesForcedToolChoice(family)).toBe(facts.forcedToolChoice);
    expect(Object.isFrozen(facts)).toBe(true);
    const bound = [
      'claude-fable-5-1',
      'claude-opus-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-5-5',
    ].includes(family);
    expect(facts.thinkingPrefixBinding).toBe(bound ? true : undefined);
    expect(Object.keys(facts).sort()).toEqual(
      bound
        ? ['forcedToolChoice', 'thinking', 'thinkingPrefixBinding']
        : ['forcedToolChoice', 'thinking'],
    );
  });

  it.each([
    ['claude-opus-4-5-20251101', 'claude-opus-4-5'],
    ['claude-opus-4-0', 'claude-opus-4'],
    ['claude-sonnet-4-0', 'claude-sonnet-4'],
    ['claude-3-7-sonnet-latest', 'claude-3-7-sonnet'],
    ['anthropic.claude-opus-5-5', 'claude-opus-5-5'],
    ['global.anthropic.claude-opus-4-6-v1', 'claude-opus-4-6'],
    ['us.anthropic.claude-opus-5-5', 'claude-opus-5-5'],
    ['eu.anthropic.claude-sonnet-4-5-20250929-v1:0', 'claude-sonnet-4-5'],
    ['apac.anthropic.claude-3-haiku-20240307-v1:0', 'claude-3-haiku'],
    ['au.anthropic.claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['jp.anthropic.claude-sonnet-4-6', 'claude-sonnet-4-6'],
    ['arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-opus-5-5', 'claude-opus-5-5'],
    [
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0',
      'claude-haiku-4-5',
    ],
    [
      'arn:aws-us-gov:bedrock:us-gov-west-1::foundation-model/anthropic.claude-3-haiku-20240307-v1:0',
      'claude-3-haiku',
    ],
    ['claude-opus-4-5@20251101', 'claude-opus-4-5'],
    ['publishers/anthropic/models/claude-opus-4-1@20250805', 'claude-opus-4-1'],
    [
      'projects/my-project/locations/us-east5/publishers/anthropic/models/claude-sonnet-5-5',
      'claude-sonnet-5-5',
    ],
  ])('recognizes the full platform id %s', (id, family) => {
    expect(anthropicModelFamily(id)).toBe(family);
    expect(anthropicModelFacts(id)).toBe(ANTHROPIC_MODELS[family]);
    expect(anthropicTakesForcedToolChoice(id)).toBe(ANTHROPIC_MODELS[family].forcedToolChoice);
  });

  it.each(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-mythos-5-1'])(
    'refuses forced tools for known %s, but not arbitrary aliases mentioning it',
    (family) => {
      expect(anthropicTakesForcedToolChoice(family)).toBe(false);
      for (const alias of [`my-${family}`, `${family}-deployment`, `${family}:deployment`]) {
        expect(anthropicModelFacts(alias)).toBeUndefined();
        expect(anthropicTakesForcedToolChoice(alias)).toBe(true);
      }
    },
  );

  it.each([
    '',
    'my-team-deployment',
    'gpt-5',
    'claude-opus-6',
    'claude-opus-5-50',
    'claude-opus-5-5-1',
    'prefix/anthropic.claude-opus-5-5',
    'my-claude-opus-5-5',
    'anthropic/claude-opus-5-5',
    'claude-opus-5.5',
    'CLAUDE-OPUS-5-5',
    'claude-opus-5-5[1m]',
    'claude-opus-5-5:alias',
    'claude-opus-5-5-latest-gateway',
    'claude-opus-5-5-20260101-custom',
    'claude-opus-5-5-202601010',
    'claude-opus-5-5@20260101-deployment',
    'claude-opus-5-5-v1:0',
    'anthropic.claude-opus-5-5-v1:0-custom',
    'team.anthropic.claude-opus-5-5',
    'global.anthropic.claude-opus-5-5\n',
    'claude-opus-5-5\n',
    ' claude-opus-5-5',
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/my-claude-opus-5-5',
    'arn:aws:bedrock:us-east-1:123456789012:application-inference-profile/anthropic.claude-opus-5-5',
    'arn:aws:bedrock:us-east-1:123456789012:custom-model/anthropic.claude-opus-5-5',
    'arn:aws:bedrock:us-east-1:123456789012:inference-profile/my-claude-opus-5-5',
    'arn:aws:bedrock:us-east-1:1:inference-profile/us.anthropic.claude-opus-5-5',
    'projects/project/locations/us-east5/endpoints/claude-opus-5-5',
    'projects/project/locations/us-east5/publishers/other/models/claude-opus-5-5',
    'publishers/anthropic/models/claude-opus-5-5/alias',
  ])('leaves opaque or incomplete id %j to the provider instead of asserting facts', (id) => {
    expect(anthropicModelFamily(id)).toBeUndefined();
    expect(anthropicModelFacts(id)).toBeUndefined();
    expect(anthropicTakesForcedToolChoice(id)).toBe(true);
  });

  it('does not infer hard facts from the historical adaptive thinking default', () => {
    expect(anthropicThinkingMode('my-team-deployment')).toBe('adaptive');
    expect(anthropicModelFacts('my-team-deployment')).toBeUndefined();
    expect(anthropicTakesForcedToolChoice('my-team-deployment')).toBe(true);
  });

  it.each([
    ['claude-sonnet-4.5', 'budget'],
    ['anthropic/claude-3.7-sonnet', 'budget'],
    ['CLAUDE-HAIKU-4-5', 'budget'],
    ['claude-3.5-haiku', 'none'],
    ['claude-opus-5-5[1m]', 'adaptive'],
    ['deployment/claude-sonnet-4-5:alias', 'budget'],
    ['arn:aws:bedrock:eu-west-1:1:inference-profile/eu.anthropic.claude-3-haiku-v2', 'none'],
  ])('preserves the existing thinking-only compatibility lookup for %s', (id, mode) => {
    expect(anthropicThinkingMode(id)).toBe(mode);
    expect(anthropicModelFacts(id)).toBeUndefined();
  });
});
