/**
 * Compile-level regression test — 7.27.1 untangled a duplicate type NAME.
 *
 * Two exported types were both called `WindowStrategy`:
 *
 *   - the package root's conversation-window seam (`{ name, plan(input) }`,
 *     public since 7.17.0, frozen);
 *   - the memory subsystem's window CONFIG (`{ kind: 'window', size }`),
 *     reachable only through `agentfootprint/memory`.
 *
 * Same name, incompatible shapes, two entry points — a trap for anyone who
 * imported from the wrong one, and a hard block on the release gate that
 * refuses duplicate exported type names. The memory one was renamed to
 * `MemoryWindowStrategy` and the old name kept as a deprecated alias through
 * 8.x. **9.0.0 removed the alias**, so the collision is gone in both
 * directions: `agentfootprint/memory` no longer exports a `WindowStrategy` at
 * all, and the only `WindowStrategy` in the package is the root's
 * conversation-window seam.
 *
 * Three things must stay true at the TYPE level, none of them observable at
 * runtime, so the real compiler pins them here (this file lives under
 * ./tsconfig.json, run via `npm run test:types`, while its name still matches
 * `test/**\/*.test.ts` so `npm test` runs the assertions too):
 *
 *   1. `MemoryWindowStrategy` is exported from the memory subpath and is a
 *      member of the `Strategy` union `defineMemory` accepts.
 *   2. The old name is GONE from the memory door — a rename that finished.
 *   3. The two are genuinely different types: the root's `WindowStrategy` is
 *      NOT assignable to the memory one, which is exactly why sharing a name
 *      was worth ending.
 */
import { describe, expect, it } from 'vitest';
import type { MemoryWindowStrategy, Strategy } from '../../src/memory/index';

// The pre-7.27.1 name is GONE from the memory door (9.0.0), and this
// suppression IS the assertion. `@ts-expect-error` fails the build when the
// line it guards has NO error — so if `WindowStrategy` is ever re-exported
// from `agentfootprint/memory`, this file stops compiling and the name
// collision has to be argued for again. Type-only, erased at runtime.
// @ts-expect-error WindowStrategy was renamed MemoryWindowStrategy in 7.27.1 and removed in 9.0.0
import type { WindowStrategy as _RemovedMemoryWindowStrategy } from '../../src/memory/index';

import { MEMORY_STRATEGIES } from '../../src/memory/index';
import type { WindowStrategy as ConversationWindowStrategy } from '../../src/index';

/** The name the `@ts-expect-error` import above stands guard over. */
const REMOVED_IN_9 = 'WindowStrategy';

describe('MemoryWindowStrategy — type regression', () => {
  it('is the memory window CONFIG and belongs to the Strategy union', () => {
    const window: MemoryWindowStrategy = { kind: MEMORY_STRATEGIES.WINDOW, size: 5 };
    const asStrategy: Strategy = window;
    expect(asStrategy.kind).toBe('window');
    expect(window.size).toBe(5);
  });

  it('the pre-7.27.1 name is GONE from the memory door (9.0.0)', () => {
    const current: MemoryWindowStrategy = { kind: MEMORY_STRATEGIES.WINDOW, size: 3 };
    expect(current.size).toBe(3);

    // The absence is pinned by the `@ts-expect-error` import at the top of
    // this file — see the note there.
    expect(REMOVED_IN_9).toBe('WindowStrategy');
  });

  it('is NOT the conversation-window seam — the shapes never met', () => {
    const seam = {
      name: 'every-other-turn',
      plan: async () => undefined,
    } as unknown as ConversationWindowStrategy;

    // @ts-expect-error the root's WindowStrategy has no `kind`/`size`
    const wrong: MemoryWindowStrategy = seam;
    void wrong;

    expect(seam.name).toBe('every-other-turn');
  });
});
