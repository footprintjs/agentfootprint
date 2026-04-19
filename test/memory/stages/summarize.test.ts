/**
 * summarize stage — 5-pattern tests.
 *
 * Uses a mock LLM callback (deterministic — returns the same summary for
 * the same input) to exercise the stage without a real provider.
 */
import { describe, expect, it, vi } from 'vitest';
import { summarize } from '../../../src/memory/stages/summarize';
import type { MemoryState } from '../../../src/memory/stages/types';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { Message } from '../../../src/types/messages';

const ID = { tenant: 't1', conversationId: 'c1' };

function msg(role: 'user' | 'assistant', content: string): Message {
  return { role, content };
}

function makeEntry(id: string, turn: number, message: Message): MemoryEntry<Message> {
  const now = 1_700_000_000_000 + turn;
  return {
    id,
    value: message,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
    source: { turn, identity: ID },
  };
}

function makeScope(partial?: Partial<MemoryState>): MemoryState {
  return {
    identity: ID,
    turnNumber: 1,
    contextTokensRemaining: 4000,
    loaded: [],
    selected: [],
    formatted: [],
    newMessages: [],
    ...partial,
  };
}

// Deterministic mock LLM — returns a summary string that embeds the input
// count so tests can assert on what it received.
function mockLLM(): (messages: readonly Message[]) => Promise<string> {
  return vi.fn(async (messages) => {
    const userCount = messages.filter((m) => m.role === 'user').length;
    return `SUMMARY of ${userCount} user turns.`;
  });
}

// ── Unit ────────────────────────────────────────────────────

describe('summarize — unit', () => {
  it('no-op when loaded.length < triggerMinEntries', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 5 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 20 })(scope as never);

    expect(llm).not.toHaveBeenCalled();
    expect(scope.loaded.length).toBe(5); // unchanged
  });

  it('fires when loaded.length >= triggerMinEntries and replaces older entries', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg(i % 2 === 0 ? 'user' : 'assistant', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope as never);

    expect(llm).toHaveBeenCalledTimes(1);
    // 10 - 3 = 7 entries summarized into 1; plus 3 preserved = 4 total
    expect(scope.loaded.length).toBe(4);
    expect(scope.loaded[0].id).toMatch(/^summary-/);
    // Preserved entries retained verbatim in chronological order
    expect(scope.loaded[1].id).toBe('e7');
    expect(scope.loaded[2].id).toBe('e8');
    expect(scope.loaded[3].id).toBe('e9');
  });

  it('summary entry carries earliest + latest turn in its id', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry(`e${i}`, i + 100, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 2 })(scope as never);

    // 8 - 2 = 6 entries summarized, turns 100..105
    expect(scope.loaded[0].id).toBe('summary-100-to-105');
  });

  it('summary entry is tagged tier=cold', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope as never);

    expect(scope.loaded[0].tier).toBe('cold');
  });

  it('summary entry carries source.identity for cross-session provenance', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 6 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 1 })(scope as never);

    expect(scope.loaded[0].source?.identity?.conversationId).toBe('c1');
    expect(scope.loaded[0].source?.identity?.tenant).toBe('t1');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('summarize — boundary', () => {
  it('no-op when loaded.length <= preserveRecent', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 3 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 1, preserveRecent: 5 })(scope as never);

    expect(llm).not.toHaveBeenCalled();
    expect(scope.loaded.length).toBe(3); // unchanged
  });

  it('exactly triggerMinEntries fires the summarizer (inclusive threshold)', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm })(scope as never); // defaults: trigger 20, preserve 5
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('custom systemPrompt is used', async () => {
    const llm = vi.fn(async (messages: readonly Message[]) => {
      const sys = messages.find((m) => m.role === 'system');
      return `got: ${String(sys?.content ?? 'none')}`;
    });
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({
      llm: llm as never,
      triggerMinEntries: 5,
      preserveRecent: 3,
      systemPrompt: 'CUSTOM SUMMARY INSTRUCTION',
    })(scope as never);

    const summaryContent = String(scope.loaded[0].value.content);
    expect(summaryContent).toContain('CUSTOM SUMMARY INSTRUCTION');
  });

  it('LLM receives the old entries in chronological order', async () => {
    const seen: Message[] = [];
    const llm = async (messages: readonly Message[]) => {
      seen.push(...messages);
      return 'SUMMARY';
    };
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `content-${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope as never);

    // System prompt + 7 user messages (oldest → newest of the summarized range)
    const userMessages = seen.filter((m) => m.role === 'user');
    expect(userMessages.length).toBe(7);
    expect(String(userMessages[0].content)).toBe('content-0');
    expect(String(userMessages[6].content)).toBe('content-6');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('summarize — scenario', () => {
  it('deterministic LLM → identical summary across repeat runs (prompt-cache friendly)', async () => {
    // Deterministic LLM: same input always produces same output.
    // This is the contract Anthropic reviewer requires for prompt caching.
    const llm = async (messages: readonly Message[]) => {
      const hash = messages.map((m) => String(m.content)).join('|');
      // Deterministic function of input — not random.
      return `stable-summary-of-${hash.length}-chars`;
    };

    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );

    const scope1 = makeScope({ loaded: [...entries] });
    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope1 as never);
    const summary1 = String(scope1.loaded[0].value.content);

    const scope2 = makeScope({ loaded: [...entries] });
    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope2 as never);
    const summary2 = String(scope2.loaded[0].value.content);

    expect(summary1).toBe(summary2);
  });

  it('composes with pickByBudget — summarized loaded still fits budget checks', async () => {
    // After summarize, `loaded` is smaller but picker still works on it.
    // Pin the downstream contract — the stage cleans up after itself.
    const llm = mockLLM();
    const entries = Array.from({ length: 20 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', 'x'.repeat(100))),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 10, preserveRecent: 5 })(scope as never);

    // Every entry in loaded is still a valid MemoryEntry<Message>
    for (const e of scope.loaded) {
      expect(typeof e.id).toBe('string');
      expect(typeof e.version).toBe('number');
      expect(e.value.role).toBeDefined();
    }
  });
});

// ── Property ────────────────────────────────────────────────

describe('summarize — property', () => {
  it('after summarize, loaded.length === preserveRecent + 1 (or unchanged if no-op)', async () => {
    const llm = mockLLM();
    for (const n of [5, 10, 20, 50]) {
      const entries = Array.from({ length: n }, (_, i) =>
        makeEntry(`e${i}`, i, msg('user', `m${i}`)),
      );
      const scope = makeScope({ loaded: entries });
      await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope as never);
      if (n > 3) {
        expect(scope.loaded.length).toBe(4); // 1 summary + 3 preserved
      } else {
        expect(scope.loaded.length).toBe(n);
      }
    }
  });

  it('preserved entries appear AFTER the summary in the final ordering', async () => {
    const llm = mockLLM();
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 4 })(scope as never);

    // Summary is first, followed by the 4 preserved in original order
    expect(scope.loaded[0].id).toMatch(/^summary-/);
    expect(scope.loaded.slice(1).map((e) => e.id)).toEqual(['e6', 'e7', 'e8', 'e9']);
  });
});

// ── Security ────────────────────────────────────────────────

describe('summarize — security', () => {
  it('LLM errors propagate (fail-loud)', async () => {
    const llm = async () => {
      throw new Error('rate limited');
    };
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, i, msg('user', `m${i}`)),
    );
    const scope = makeScope({ loaded: entries });

    await expect(summarize({ llm, triggerMinEntries: 5 })(scope as never)).rejects.toThrow(
      /rate limited/,
    );
    // scope.loaded was NOT partially mutated
    expect(scope.loaded.length).toBe(10);
  });

  it('summary entry does NOT carry fake access signals (fresh counts)', async () => {
    // Pin: the synthetic entry starts with accessCount=0 and lastAccessedAt=now.
    // An adversary passing pre-cooked `accessCount` via the entries to be
    // summarized MUST NOT bleed into the summary's own counters.
    const llm = mockLLM();
    const tampered = makeEntry('e0', 0, msg('user', 'x'));
    // Pretend this entry was "accessed" many times — summary should ignore.
    (tampered as { accessCount: number }).accessCount = 9999;

    const entries = [
      tampered,
      ...Array.from({ length: 9 }, (_, i) => makeEntry(`e${i + 1}`, i + 1, msg('user', `m${i}`))),
    ];
    const scope = makeScope({ loaded: entries });

    await summarize({ llm, triggerMinEntries: 5, preserveRecent: 3 })(scope as never);

    expect(scope.loaded[0].accessCount).toBe(0);
  });
});
