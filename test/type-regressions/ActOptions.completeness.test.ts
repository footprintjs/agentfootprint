/**
 * Compile-level regression test — 7.24's completeness lock.
 *
 * `.act()` claims to be the whole steering wheel: one key per moment of the
 * loop, and no moment without a key. A claim like that survives exactly as
 * long as somebody remembers it, so it is pinned by the compiler instead:
 *
 *   1. **The bundle's keys ARE the moments.** `keyof ActOptions` is checked
 *      both ways against `ActKey<LoopMoment>`. Add a sixth moment to
 *      `LOOP_MOMENTS` without a key here and the build fails naming it;
 *      add a key that is not a moment and it fails the other way.
 *   2. **The mapping is mechanical.** `'before-tool'` → `beforeTool`, by
 *      type-level string manipulation rather than a hand-written pair list
 *      that could go stale.
 *   3. **Each key takes what its door takes** — the bundle is sugar, so the
 *      value types are the doors' argument types, not looser copies.
 *   4. The runtime twin agrees with the type (`actKeyFor` over
 *      `LOOP_MOMENTS`), which is what makes the validator underivable from
 *      anything else.
 *
 * Lives under ./tsconfig.json (`npm run test:types`) while its name still
 * matches `test/**\/*.test.ts`, so `npm test` runs the runtime half too.
 */
import { describe, expect, it } from 'vitest';
import type {
  ActKey,
  ActOptions,
  LoopMoment,
  MessageMiddleware,
  ToolMiddleware,
  WindowStrategy,
} from '../../src/index';
import { ACT_KEYS, LOOP_MOMENTS, actKeyFor } from '../../src/index';

// ─── 1 + 2. The lock ──────────────────────────────────────────────

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

/** Both directions: no moment without a key, no key without a moment. */
const _keysAreTheMoments: Exact<keyof ActOptions, ActKey<LoopMoment>> = true;
void _keysAreTheMoments;

/** And spelled out, so a reader sees the five without running anything. */
const _theFive: Exact<
  keyof ActOptions,
  'input' | 'beforeTool' | 'afterTool' | 'window' | 'output'
> = true;
void _theFive;

/** The mapping itself. */
const _kebabToCamel: Exact<ActKey<'before-tool'>, 'beforeTool'> = true;
const _plainStaysPlain: Exact<ActKey<'input'>, 'input'> = true;
void _kebabToCamel;
void _plainStaysPlain;

// ─── 3. Each key takes what its door takes ────────────────────────

const _shape: ActOptions = {
  input: [] as readonly MessageMiddleware[],
  beforeTool: [] as readonly ToolMiddleware[],
  afterTool: [] as readonly ToolMiddleware[],
  window: undefined as unknown as WindowStrategy,
  output: [] as readonly MessageMiddleware[],
};
void _shape;

// A moment that does not exist is not a key.
// @ts-expect-error `beforeLLM` is not a moment of the loop.
const _notAMoment: ActOptions = { beforeLLM: [] };
void _notAMoment;

// A tool rule does not fit a message moment.
// @ts-expect-error `onToolCall` is not `onMessage`.
const _wrongDoor: ActOptions = { input: [{ name: 'x', onToolCall: () => ({ kind: 'allow' }) }] };
void _wrongDoor;

// ─── 4. The runtime twin ──────────────────────────────────────────

describe('act — the completeness lock', () => {
  it('the accepted keys are derived from the moment list, not typed beside it', () => {
    expect(ACT_KEYS).toEqual(LOOP_MOMENTS.map(actKeyFor));
  });

  it('every moment maps to exactly one key, and the keys are unique', () => {
    const keys = LOOP_MOMENTS.map(actKeyFor);
    expect(new Set(keys).size).toBe(LOOP_MOMENTS.length);
  });

  it('the runtime list and the type agree on how many moments there are', () => {
    // If this number changes, `ActOptions` has already refused to compile
    // without its new key — this is the reminder of why.
    expect(LOOP_MOMENTS.length).toBe(5);
  });
});
