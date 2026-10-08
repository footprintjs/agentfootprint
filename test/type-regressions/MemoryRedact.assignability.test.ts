/**
 * Compile-level regression — `redact` is gone from `defineMemory`, and so is
 * `MemoryRedactionPolicy`.
 *
 * The option was reserved, typed, stored on the definition and read by
 * nothing. It is refused rather than implemented (`src/memory/redactRefusal.ts`:
 * a memory is working state; the agent's own `redact` governs the record).
 * The runtime throw (`test/memory/redactRefusal.test.ts`) catches JavaScript
 * callers and casts; this file pins the half the compiler enforces — the
 * declaration is reported at the keystroke.
 */
import { describe, expect, it } from 'vitest';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../src/memory/index';
import * as memoryDoor from '../../src/memory/index';
import { InMemoryStore } from '../../src/memory/store/index';
import type { DefineMemoryOptions, MemoryDefinition } from '../../src/memory/index';

describe('memory `redact` no longer type-checks', () => {
  it('defineMemory rejects it at the declaration', () => {
    expect(() =>
      defineMemory({
        id: 'chat',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
        // @ts-expect-error — `redact` was reserved and never implemented; refused.
        redact: { patterns: [/\d{3}-\d{2}-\d{4}/] },
      }),
    ).toThrow(/`redact` is not implemented/);
  });

  it('neither the option types nor the definition carry the key', () => {
    // `Extract<keyof T, 'redact'>` is `never` when the key is gone.
    const noKey = <T>(_present: Extract<keyof T, 'redact'> extends never ? true : false): void =>
      void _present;
    noKey<DefineMemoryOptions>(true);
    noKey<MemoryDefinition>(true);
    expect(true).toBe(true);
  });

  it('`MemoryRedactionPolicy` is no longer exported', () => {
    // A type export leaves no runtime trace; the door's names are the check.
    expect(Object.keys(memoryDoor)).not.toContain('MemoryRedactionPolicy');
    // @ts-expect-error — the reserved type is removed with the option.
    type _Gone = memoryDoor.MemoryRedactionPolicy;
  });
});
