import { describe, expect, it } from 'vitest';
import { applyRecipe, type RecipePort } from './apply.js';

describe('builder synchronous recipe application', () => {
  it('looks up configure after the push and gives it the actual Proxy and recipe receiver', () => {
    const receiver = new Proxy<RecipePort>({ recipeStack: [], appliedRecipeList: [] }, {});
    const lookups: string[][] = [];
    const recipe = {
      id: 'outer',
      version: '1.0.0',
      get configure() {
        lookups.push(receiver.recipeStack.map((row) => row.id));
        return function (this: unknown, builder: RecipePort) {
          expect(this).toBe(recipe);
          expect(builder).toBe(receiver);
          expect(receiver.recipeStack).toEqual([{ id: 'outer', version: '1.0.0' }]);
          expect(receiver.appliedRecipeList).toEqual([]);
        };
      },
    };

    expect(
      applyRecipe(receiver, recipe, undefined, () => recipe.configure(receiver), receiver),
    ).toBe(receiver);
    expect(lookups).toEqual([[], ['outer']]);
    expect(receiver.recipeStack).toEqual([]);
    expect(receiver.appliedRecipeList).toEqual([{ id: 'outer', version: '1.0.0' }]);
  });

  it('cleans the stack and records no applied row after a thrown or asynchronous configure', () => {
    const receiver: RecipePort = { recipeStack: [], appliedRecipeList: [] };
    const recipe = { id: 'broken', version: '1.0.0', configure: () => undefined };
    const failure = new Error('configure failed');
    expect(() =>
      applyRecipe(
        receiver,
        recipe,
        undefined,
        () => {
          throw failure;
        },
        receiver,
      ),
    ).toThrow(failure);
    expect(receiver.recipeStack).toEqual([]);
    expect(receiver.appliedRecipeList).toEqual([]);
    expect(() =>
      applyRecipe(receiver, recipe, undefined, () => ({ then: () => undefined }), receiver),
    ).toThrow('synchronous');
    expect(receiver.recipeStack).toEqual([]);
    expect(receiver.appliedRecipeList).toEqual([]);
  });
});
