import { describe, expect, it } from 'vitest';
import { Agent, AgentBuilder, type WindowStrategy } from '../../../../index.js';
import { mock } from '../../../../doors/providers.js';
import type { AgentRecipe } from '../../../../doors/recipes.js';
import type { Injection } from '../../../../doors/context.js';
import type { AgentOptions } from '../../types.js';

const create = () => Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' });

const tool = {
  schema: {
    name: 'already_there',
    description: 'A duplicate-name probe.',
    inputSchema: { type: 'object', properties: {} },
  },
  execute: async () => 'ok',
};

describe('public builder live receiver', () => {
  it('passes the Proxy into the recipe and looks up configure at its original phase', () => {
    const builder = create().tool(tool);
    const proxy = new Proxy(builder, {});
    let configureReads = 0;
    let configureCalls = 0;
    const recipe: AgentRecipe = {
      id: 'live-receiver',
      version: '1.0.0',
      get configure() {
        configureReads++;
        // Validation reads configure before the stack push. The actual call
        // reads it again AFTER the push; the refusal must name this recipe.
        if (configureReads === 2) {
          expect(() => proxy.tool(tool)).toThrow(/now by recipe 'live-receiver' 1\.0\.0/);
        }
        return function (this: AgentRecipe, configured: AgentBuilder): void {
          configureCalls++;
          expect(this).toBe(recipe);
          expect(configured).toBe(proxy);
          expect(configured.system('Keep the actual receiver.')).toBe(proxy);
        };
      },
    };

    expect(proxy.recipe(recipe)).toBe(proxy);
    expect(configureReads).toBe(2);
    expect(configureCalls).toBe(1);
    // The failed registration above did not poison later registration.
    expect(() => proxy.tool(tool)).toThrow(/^Agent\.tool\(\): duplicate tool name/);
  });

  it('looks up a delegated method before evaluating its argument getter', () => {
    const events: string[] = [];
    const proxy: AgentBuilder = new Proxy(create(), {
      get(target, key, receiver) {
        if (key === 'assertSummarizerIsNotTheAgentItself') {
          events.push('lookup summarizer guard');
          return function (this: AgentBuilder): void {
            expect(this).toBe(proxy);
            events.push('call summarizer guard');
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const strategy: WindowStrategy = {
      name: 'getter-order',
      plan: async () => undefined,
      get billing() {
        events.push('read billing');
        return undefined;
      },
    };

    expect(proxy.window(strategy)).toBe(proxy);
    expect(events).toEqual(['lookup summarizer guard', 'read billing', 'call summarizer guard']);
  });

  it('preserves a dynamic registration method result through the public sugar', () => {
    const sentinel = create();
    const proxy: AgentBuilder = new Proxy(create(), {
      get(target, key, receiver) {
        if (key === 'injection') {
          return function (this: AgentBuilder, injection: Injection): AgentBuilder {
            expect(this).toBe(proxy);
            expect(injection.id).toBe('delegation-sentinel');
            return sentinel;
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });
    const injection: Injection = {
      id: 'delegation-sentinel',
      flavor: 'instructions',
      trigger: { kind: 'always' },
      inject: { systemPrompt: 'A public registration probe.' },
    };

    expect(proxy.skill(injection)).toBe(sentinel);
    expect(proxy.instruction(injection)).toBe(sentinel);
  });

  it('retains a private delegation result and its actual Proxy receiver', () => {
    const injection: Injection = {
      id: 'duplicate-injection',
      flavor: 'instructions',
      trigger: { kind: 'always' },
      inject: { systemPrompt: 'A public registration probe.' },
    };
    const builder = create().injection(injection);
    const proxy: AgentBuilder = new Proxy(builder, {
      get(target, key, receiver) {
        if (key === 'duplicateRefusal') {
          return function (this: AgentBuilder): string {
            expect(this).toBe(proxy);
            return 'private delegation result survives';
          };
        }
        return Reflect.get(target, key, receiver);
      },
    });

    expect(() => proxy.injection(injection)).toThrow('private delegation result survives');
  });
});

describe('public builder assembly order', () => {
  it('keeps enforcement in its constructor-argument position', () => {
    const events: string[] = [];
    const stop = new Error('stop after enforcement argument');
    let constructorArgumentsStarted = false;
    const proxy: AgentBuilder = new Proxy(create(), {
      get(target, key, receiver) {
        if (key === 'systemPromptValue') constructorArgumentsStarted = true;
        if (constructorArgumentsStarted) events.push(String(key));
        if (key === 'resolveOutputEnforcement') {
          return function (this: AgentBuilder): undefined {
            expect(this).toBe(proxy);
            events.push('call enforcement');
            return undefined;
          };
        }
        if (constructorArgumentsStarted && key === 'skillGraphEdgeTargets') throw stop;
        return Reflect.get(target, key, receiver);
      },
    });

    expect(() => proxy.build()).toThrow(stop);
    expect(events).toEqual([
      'systemPromptValue',
      'registry',
      'memoryList',
      'outputSchemaParser',
      'systemPromptCachePolicy',
      'cachingDisabledValue',
      'cacheStrategyOverride',
      'outputFallbackCfg',
      'reliabilityConfig',
      'thinkingHandlerValue',
      'thinkingBudgetValue',
      'skillGraphNextSkill',
      'skillGraphReachable',
      'skillGraphScoreEntries',
      'checkInConfig',
      'runConfigFn',
      'windowStrategyValue',
      'toolMiddlewareList',
      'messageMiddlewareList',
      'resolveOutputEnforcement',
      'call enforcement',
      'skillGraphEdgeTargets',
    ]);
  });

  it('passes unarmed options through without copying or enumerating them', () => {
    const options: AgentOptions = { provider: mock({ reply: 'ok' }), model: 'm' };
    const sameOptions = new Proxy(options, {
      ownKeys() {
        throw new Error('unarmed options must not be copied');
      },
    });

    expect(() => Agent.create(sameOptions).build()).not.toThrow();
  });
});

describe('public builder object shape', () => {
  it('keeps the original own fields and direct prototype chain', () => {
    const builder = create();

    expect(Object.getPrototypeOf(builder)).toBe(AgentBuilder.prototype);
    expect(Object.getPrototypeOf(AgentBuilder.prototype)).toBe(Object.prototype);
    expect(Reflect.ownKeys(builder)).toEqual(ORIGINAL_FIELDS);
    expect(Reflect.ownKeys(AgentBuilder.prototype)).toEqual(ORIGINAL_PROTOTYPE_KEYS);
    expect(Object.getPrototypeOf(AgentBuilder)).toBe(Function.prototype);
  });
});

// Pinned from the original 05cbef67 class, not generated during the test.
const ORIGINAL_FIELDS = [
  'opts',
  'systemPromptValue',
  'systemPromptSet',
  'systemPromptCachePolicy',
  'systemPromptCacheExplicit',
  'cachingDisabledValue',
  'cacheStrategyOverride',
  'registry',
  'injectionList',
  'skillGraphNextSkill',
  'skillGraphReachable',
  'skillGraphScoreEntries',
  'skillGraphEdgeTargets',
  'skillGraphExplainNextSkill',
  'skillGraphSupersededEntries',
  'skillGraphIsTree',
  'skillGraphCascade',
  'skillGraphDeferredBodyContract',
  'skillGraphBrainOptions',
  'skillGraphNodeIds',
  'skillGraphDeclared',
  'mapsOptions',
  'claimsContract',
  'memoryList',
  'outputSchemaParser',
  'answerValidationConfig',
  'negativeClaimsConfig',
  'evidenceGate',
  'toolsFromActiveSkillValue',
  'limitsTravelValue',
  'scriptTravelValue',
  'inputsLayerValue',
  'inputsLayerSourcesValue',
  'resultsLayerValue',
  'answerLayerValue',
  'timeValue',
  'outputSchemaRetries',
  'outputSchemaStrategy',
  'outputSchemaJson',
  'outputFallbackCfg',
  'toolProviderRef',
  'maxIterationsOverride',
  'recorderList',
  'appNameValue',
  'commentaryOverrides',
  'thinkingOverrides',
  'reliabilityConfig',
  'thinkingHandlerValue',
  'thinkingBudgetValue',
  'selfExplainConfig',
  'checkInConfig',
  'runConfigFn',
  'windowStrategyValue',
  'windowStrategyDoor',
  'toolMiddlewareList',
  'messageMiddlewareList',
  'aroundTurnPort',
  'actCalled',
  'appliedRecipeList',
  'recipeStack',
  'toolSources',
  'injectionSources',
  'findingsValue',
  'toolChoiceValue',
  'ontologyValue',
];

const ORIGINAL_PROTOTYPE_KEYS = [
  'constructor',
  'system',
  'tool',
  'currentSource',
  'duplicateRefusal',
  'recipe',
  'tools',
  'toolProvider',
  'configure',
  'act',
  'window',
  'assertSummarizerIsNotTheAgentItself',
  'compaction',
  'assertNoWindowStrategy',
  'noteWindowStrategyDoor',
  'maxIterations',
  'watch',
  'appName',
  'commentaryTemplates',
  'thinkingTemplates',
  'injection',
  'skill',
  'skills',
  'skillGraph',
  'maps',
  'claims',
  'steering',
  'instruction',
  'instructions',
  'fact',
  'memory',
  'rag',
  'namesAndNumbersFromEvidence',
  'limitsTravelWithTheAnswer',
  'scriptTravelsWithTheAnswer',
  'inputsLayer',
  'resultsLayer',
  'answerLayer',
  'time',
  'toolsFromActiveSkill',
  'outputSchema',
  'findings',
  'toolChoice',
  'ontology',
  'outputFallback',
  'assertOutputFallbackCoherent',
  'reliability',
  'thinkingHandler',
  'thinking',
  'toolMiddleware',
  'assertToolMiddleware',
  'messageMiddleware',
  'aroundTurn',
  'assertMiddleware',
  'checkIn',
  'selfExplain',
  'resolveMapsPlan',
  'answerValidation',
  'negativeClaims',
  'resolveOutputEnforcement',
  'build',
];
