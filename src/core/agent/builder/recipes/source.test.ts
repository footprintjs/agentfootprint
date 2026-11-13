import { describe, expect, it } from 'vitest';
import { LOCAL_SOURCE } from '../../../../recipes/provenance.js';
import { currentRecipeSource, duplicateRegistration, type RecipeSourcePort } from './source.js';

describe('builder recipe attribution', () => {
  it('copies the current stack so later application cannot rewrite an earlier source', () => {
    const receiver: RecipeSourcePort = { recipeStack: [] };
    expect(currentRecipeSource(receiver)).toBe(LOCAL_SOURCE);
    receiver.recipeStack.push({ id: 'outer', version: '1.0.0' });
    const source = currentRecipeSource(receiver);
    receiver.recipeStack.push({ id: 'inner', version: '1.0.0' });
    expect(source).toEqual({ kind: 'recipe', stack: [{ id: 'outer', version: '1.0.0' }] });
  });

  it('preserves the existing local duplicate sentences for both registration kinds', () => {
    const receiver = { currentSource: () => LOCAL_SOURCE };
    const sources = new Map([['search', LOCAL_SOURCE]]);
    expect(duplicateRegistration(receiver, 'tool name', 'search', sources, 'unused')).toBe(
      "Agent.tool(): duplicate tool name 'search'",
    );
    expect(duplicateRegistration(receiver, 'injection id', 'search', sources, 'unused')).toBe(
      "Agent.injection(): duplicate id 'search'",
    );
  });
});
