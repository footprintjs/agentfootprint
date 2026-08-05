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
 * `MemoryWindowStrategy` and the old name kept as a deprecated alias.
 *
 * Three things must stay true at the TYPE level, none of them observable at
 * runtime, so the real compiler pins them here (this file lives under
 * ./tsconfig.json, run via `npm run test:types`, while its name still matches
 * `test/**\/*.test.ts` so `npm test` runs the assertions too):
 *
 *   1. `MemoryWindowStrategy` is exported from the memory subpath and is a
 *      member of the `Strategy` union `defineMemory` accepts.
 *   2. The old name still compiles — the alias is a rename, not a removal.
 *      Code written against 7.27.0 must keep working unchanged.
 *   3. The two are genuinely different types: the root's `WindowStrategy` is
 *      NOT assignable to the memory one, which is exactly why sharing a name
 *      was worth ending.
 */
import { describe, expect, it } from 'vitest';
import type {
  MemoryWindowStrategy,
  Strategy,
  WindowStrategy as DeprecatedMemoryWindowStrategy,
} from '../../src/memory/index';
import { MEMORY_STRATEGIES } from '../../src/memory/index';
import type { WindowStrategy as ConversationWindowStrategy } from '../../src/index';

describe('MemoryWindowStrategy — type regression', () => {
  it('is the memory window CONFIG and belongs to the Strategy union', () => {
    const window: MemoryWindowStrategy = { kind: MEMORY_STRATEGIES.WINDOW, size: 5 };
    const asStrategy: Strategy = window;
    expect(asStrategy.kind).toBe('window');
    expect(window.size).toBe(5);
  });

  it('the pre-7.27.1 name still compiles (deprecated alias, not a removal)', () => {
    const legacy: DeprecatedMemoryWindowStrategy = { kind: MEMORY_STRATEGIES.WINDOW, size: 3 };
    const sameType: MemoryWindowStrategy = legacy; // structurally identical
    expect(sameType.size).toBe(3);
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
