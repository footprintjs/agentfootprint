/**
 * `defineAgentRecipe` (9.48.0) — the declaration and its refusals.
 *
 * A recipe is a named, versioned composition over builder methods that already
 * exist. The declaration is the only place this library gets to check the two
 * fields a run manifest will be GROUPED by, so this file is mostly about what
 * it refuses and why.
 *
 * ## How this suite is two-sided, and why that matters
 *
 * The id and version rules are asserted from a TABLE with both arms: names
 * that must be ACCEPTED and names that must be REFUSED. That is deliberate.
 * A validator that accepted everything would pass a refusal-only suite; one
 * that threw on everything would pass an acceptance-only suite. Neither
 * vacuous implementation can satisfy both arms, so the table is worth what it
 * catches.
 *
 * Sections: Functional (the two-sided rules) · Integration (the same validator
 * at both doors) · Security & containment (the freeze) · Edge (shapes that are
 * not recipes at all) · Regression (the message teaches, it does not just say
 * "invalid").
 */

import { describe, expect, it } from 'vitest';
import {
  defineAgentRecipe,
  InvalidAgentRecipeError,
  type AgentRecipe,
} from '../../src/doors/recipes.js';
// Internals, imported by module path: the door publishes the AUTHORING
// vocabulary only, and these are the pieces `AgentBuilder` uses.
import { assertAgentRecipe } from '../../src/recipes/defineAgentRecipe.js';
import { isPlainRecipeId } from '../../src/recipes/identifier.js';
import { isSemverVersion } from '../../src/recipes/version.js';
import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';

/** The smallest legal declaration; each test varies exactly one field. */
const base = { id: 'support-desk', version: '1.2.0', configure: () => undefined };

const make = (over: Record<string, unknown>): AgentRecipe =>
  defineAgentRecipe({ ...base, ...over } as unknown as AgentRecipe);

// ─── 1. FUNCTIONAL — the two-sided rules ─────────────────────────────

describe('the id is a plain name', () => {
  // Accepted. One word, several words, digits inside a word.
  const ACCEPTED = ['triage', 'support-desk', 'refund-policy-v', 'oauth2', 's3-archive', 'sha256'];
  // Refused, each for a stated reason.
  const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['', 'empty'],
    ['SupportDesk', 'upper case'],
    ['support desk', 'a space'],
    ['support_desk', 'an underscore'],
    ['-support', 'a leading hyphen'],
    ['support-', 'a trailing hyphen'],
    ['support--desk', 'a double hyphen'],
    ['2fast', 'starts with a digit'],
    ['support-desk-2', 'a version suffix'],
    ['support-desk-v2', 'a v-version suffix'],
    ['v2', 'nothing but a version'],
    ['a'.repeat(65), 'longer than the 64-character bound'],
  ];

  for (const id of ACCEPTED) {
    it(`accepts '${id}'`, () => {
      expect(isPlainRecipeId(id)).toBe(true);
      expect(make({ id }).id).toBe(id);
    });
  }

  for (const [id, why] of REFUSED) {
    it(`refuses '${id}' — ${why}`, () => {
      expect(isPlainRecipeId(id)).toBe(false);
      expect(() => make({ id })).toThrow(InvalidAgentRecipeError);
    });
  }

  it('the version-suffix refusal points at the field that already exists', () => {
    // The fix is NOT "spell it differently" — it is "bump the version you
    // already have", so the message has to say the second thing.
    expect(() => make({ id: 'support-desk-2' })).toThrow(/version suffix/);
    expect(() => make({ id: 'support-desk-2' })).toThrow(/id: 'support-desk'/);
    expect(() => make({ id: 'support-desk-2' })).toThrow(/bump `version`/);
  });

  it('states its own limit honestly: a name that merely ends in a digit passes', () => {
    // `oauth2` and `sha256` are real words. Refusing them would be worse than
    // missing `triage2`, and the README says so rather than implying a check
    // that does not exist.
    expect(isPlainRecipeId('triage2')).toBe(true);
  });
});

describe('the version is strict SemVer', () => {
  const ACCEPTED = ['1.2.0', '0.0.1', '2.0.0-rc.1', '1.0.0+build.5', '10.20.30'];
  const REFUSED: ReadonlyArray<readonly [string, string]> = [
    ['', 'empty'],
    ['1.2', 'two parts'],
    ['1', 'one part'],
    ['v1.2.3', 'a leading v'],
    ['1.02.3', 'a leading zero'],
    ['latest', 'a channel, not a version'],
    ['^1.2.3', 'a range'],
    ['1.x', 'a range'],
    ['1.2.3.4', 'four parts'],
  ];

  for (const version of ACCEPTED) {
    it(`accepts '${version}'`, () => {
      expect(isSemverVersion(version)).toBe(true);
      expect(make({ version }).version).toBe(version);
    });
  }

  for (const [version, why] of REFUSED) {
    it(`refuses '${version}' — ${why}`, () => {
      expect(isSemverVersion(version)).toBe(false);
      expect(() => make({ version })).toThrow(InvalidAgentRecipeError);
    });
  }

  it('names the specific mistake rather than "invalid"', () => {
    expect(() => make({ version: '1.2' })).toThrow(/Did you mean '1.2.0'/);
    expect(() => make({ version: 'v1.2.3' })).toThrow(/Drop the leading 'v'/);
    expect(() => make({ version: '^1.2.3' })).toThrow(/RANGE, not a version/);
  });

  it('repairs nothing — a near-miss is refused, never padded', () => {
    // Padding '1.2' to '1.2.0' would stamp a version on the record that the
    // author never wrote, which is the one thing a manifest field may not do.
    expect(() => make({ version: '1.2' })).toThrow();
  });
});

// ─── 2. INTEGRATION — one validator, both doors ──────────────────────

describe('the validator is the SAME one `.recipe()` runs', () => {
  it('a hand-written literal cannot get past the checks the factory makes', () => {
    const handBuilt = {
      id: 'support-desk-2',
      version: '1.0.0',
      configure: () => undefined,
    } as unknown as AgentRecipe;

    // The factory refuses it…
    expect(() => defineAgentRecipe(handBuilt)).toThrow(InvalidAgentRecipeError);
    // …and so does the builder, which is what makes the factory optional
    // rather than a hole.
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).recipe(handBuilt),
    ).toThrow(InvalidAgentRecipeError);
  });

  it('a VALID hand-written literal is accepted at both doors', () => {
    // The control that keeps the assertion above from passing vacuously: if
    // `.recipe()` simply threw on everything, this would fail.
    const literal: AgentRecipe = { id: 'triage', version: '1.0.0', configure: () => undefined };
    expect(defineAgentRecipe(literal).id).toBe('triage');
    expect(() =>
      Agent.create({ provider: mock({ reply: 'ok' }), model: 'm' }).recipe(literal),
    ).not.toThrow();
  });

  it('names the call site in the refusal, so the reader knows which door said no', () => {
    expect(() => assertAgentRecipe({ ...base, version: 'nope' }, 'someOtherDoor')).toThrow(
      /^someOtherDoor: /,
    );
  });
});

// ─── 3. SECURITY & CONTAINMENT — the freeze ──────────────────────────

describe('a declared recipe is frozen', () => {
  it('cannot be edited after declaration', () => {
    const recipe = defineAgentRecipe({ ...base, description: 'as declared' });
    expect(Object.isFrozen(recipe)).toBe(true);
    expect(() => {
      (recipe as { description?: string }).description = 'edited';
    }).toThrow(TypeError);
    expect(recipe.description).toBe('as declared');
  });

  it('is a COPY, so editing the literal afterwards changes nothing', () => {
    // A recipe is handed to several agents. A mutable one is a shared object a
    // single consumer can edit for everybody — invisibly, because the manifest
    // reports the id and the version and both would still say what they said.
    const literal = { ...base, description: 'as declared' };
    const recipe = defineAgentRecipe(literal);
    literal.description = 'edited';
    expect(recipe.description).toBe('as declared');
  });
});

// ─── 4. EDGE — shapes that are not recipes at all ────────────────────

describe('shapes that are not a recipe', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'support-desk'],
    ['an array', [base]],
    ['a number', 7],
  ])('refuses %s', (_label, value) => {
    expect(() => defineAgentRecipe(value as unknown as AgentRecipe)).toThrow(
      InvalidAgentRecipeError,
    );
  });

  it('refuses a missing or non-function `configure`, and says what it would cost', () => {
    expect(() => make({ configure: undefined })).toThrow(/configure must be a function/);
    // The consequence, not just the rule: a recipe with no configure applies
    // cleanly, changes nothing, and still claims a manifest row.
    expect(() => make({ configure: undefined })).toThrow(/still put a row on the run manifest/);
    expect(() => make({ configure: 'nope' })).toThrow(InvalidAgentRecipeError);
  });

  it('refuses an unknown field, naming it — `name:` instead of `id:` is the real typo', () => {
    expect(() =>
      defineAgentRecipe({ name: 'support-desk', ...base } as unknown as AgentRecipe),
    ).toThrow(/unknown field 'name'/);
  });

  it('refuses a non-string description', () => {
    expect(() => make({ description: 42 })).toThrow(/description must be a string/);
  });

  it('accepts the four declared fields together — the control for the rule above', () => {
    const recipe = defineAgentRecipe({ ...base, description: 'what it is for' });
    expect(Object.keys(recipe).sort()).toEqual(['configure', 'description', 'id', 'version']);
  });
});

// ─── 5. REGRESSION — the error is catchable by class AND by field ────

describe('InvalidAgentRecipeError', () => {
  it('carries the field it refused, so a host can report it without parsing prose', () => {
    const fields: string[] = [];
    for (const bad of [{ id: '' }, { version: 'x' }, { configure: undefined }, { extra: 1 }]) {
      try {
        make(bad);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidAgentRecipeError);
        fields.push((error as InvalidAgentRecipeError).field);
      }
    }
    expect(fields).toEqual(['id', 'version', 'configure', 'shape']);
  });

  it('is an Error, and carries a stable code', () => {
    try {
      make({ id: '' });
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as InvalidAgentRecipeError).code).toBe('ERR_INVALID_AGENT_RECIPE');
      expect((error as Error).name).toBe('InvalidAgentRecipeError');
    }
  });
});
