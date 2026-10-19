/** Public /cache migration witness: resolve either shape before reading mode. */
import { expect, it } from 'vitest';
import { promptCachingFor, type PromptCaching } from '../../src/cache/index.js';
import type { LLMProvider } from '../../src/index.js';

const complete: LLMProvider['complete'] = async () => ({
  content: '',
  toolCalls: [],
  usage: { input: 0, output: 0 },
  stopReason: 'stop',
});
const staticProvider: LLMProvider = {
  name: 'static',
  complete,
  promptCaching: { mode: 'automatic', reportsUsage: true },
};
const modelProvider: LLMProvider = {
  name: 'model-aware',
  complete,
  promptCaching: (model) =>
    model === 'supported'
      ? { mode: 'breakpoints', maxBreakpoints: 4, reportsUsage: true }
      : undefined,
};
const declarations: (PromptCaching | undefined)[] = [
  promptCachingFor(staticProvider),
  promptCachingFor(modelProvider, 'supported'),
];
for (const declaration of declarations)
  if (declaration?.mode === 'breakpoints') {
    const maximum: number = declaration.maxBreakpoints;
    void maximum;
  }
// @ts-expect-error The declaration can be a model function; resolve it first.
modelProvider.promptCaching?.mode;

it('the public cache resolver supports static declarations and model functions', () => {
  expect(declarations.map((declaration) => declaration?.mode)).toEqual([
    'automatic',
    'breakpoints',
  ]);
  expect(promptCachingFor(modelProvider, 'unknown')).toBeUndefined();
});
