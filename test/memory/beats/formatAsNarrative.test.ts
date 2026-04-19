/**
 * formatAsNarrative stage — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     single beat renders as a sentence in a paragraph
 *   - boundary: empty selected → no message; emitWhenEmpty honored
 *   - scenario: multiple beats flow into a single paragraph
 *   - property: formatted always has 0 or 1 messages (never more)
 *   - security: `</memory>` in beat content is escaped
 */
import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { formatAsNarrative } from '../../../src/memory/beats';
import type { NarrativeBeat } from '../../../src/memory/beats';
import type { MemoryEntry } from '../../../src/memory/entry';
import type { MemoryState } from '../../../src/memory/stages';

function makeEntry(id: string, beat: NarrativeBeat): MemoryEntry<NarrativeBeat> {
  const now = Date.now();
  return {
    id,
    value: beat,
    version: 1,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    accessCount: 0,
  };
}

async function runFormat(
  config: Parameters<typeof formatAsNarrative>[0] | undefined,
  selected: MemoryEntry<NarrativeBeat>[],
): Promise<MemoryState> {
  const chart = flowChart<MemoryState>(
    'Seed',
    (scope) => {
      scope.identity = { conversationId: 'c' };
      scope.turnNumber = 1;
      scope.contextTokensRemaining = 4000;
      scope.loaded = [];
      // MemoryState.selected is typed as MemoryEntry<Message>[]; cast at
      // the pipeline boundary (narrative pipeline guarantees the shape).
      scope.selected = selected as unknown as MemoryState['selected'];
      scope.formatted = [];
      scope.newMessages = [];
    },
    'seed',
  )
    .addFunction('Format', formatAsNarrative(config), 'format-as-narrative')
    .build();
  const executor = new FlowChartExecutor(chart);
  await executor.run();
  return (executor.getSnapshot()?.sharedState ?? {}) as MemoryState;
}

// ── Unit ────────────────────────────────────────────────────

describe('formatAsNarrative — unit', () => {
  it('single beat renders as one sentence with header + lead-in', async () => {
    const state = await runFormat(undefined, [
      makeEntry('b1', {
        summary: 'User revealed their name is Alice',
        importance: 0.9,
        refs: ['msg-1-0'],
      }),
    ]);
    expect(state.formatted).toHaveLength(1);
    const msg = state.formatted![0];
    expect(msg.role).toBe('system');
    expect(msg.content).toContain('Relevant context');
    expect(msg.content).toContain('From earlier:');
    expect(msg.content).toContain('User revealed their name is Alice');
  });

  it('showRefs=true appends source message ids per sentence', async () => {
    const state = await runFormat({ showRefs: true }, [
      makeEntry('b1', {
        summary: 'Alice mentioned her favorite color is blue',
        importance: 0.7,
        refs: ['msg-1-0', 'msg-1-2'],
      }),
    ]);
    expect(state.formatted![0].content).toContain('(refs: msg-1-0, msg-1-2)');
  });

  it('custom header + footer + leadIn used when provided', async () => {
    const state = await runFormat({ header: 'MEMORY', footer: 'END', leadIn: 'Previously: ' }, [
      makeEntry('b1', { summary: 'ok', importance: 0.5, refs: [] }),
    ]);
    const c = state.formatted![0].content as string;
    expect(c.startsWith('MEMORY')).toBe(true);
    expect(c.endsWith('END')).toBe(true);
    expect(c).toContain('Previously: ');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('formatAsNarrative — boundary', () => {
  it('empty selected → formatted is empty (no system message)', async () => {
    const state = await runFormat(undefined, []);
    expect(state.formatted).toEqual([]);
  });

  it('emitWhenEmpty=true → produces header-only message even with no beats', async () => {
    const state = await runFormat({ emitWhenEmpty: true }, []);
    expect(state.formatted).toHaveLength(1);
    expect(state.formatted![0].content).toContain('Relevant context');
  });

  it('sentence already ending in punctuation does not get a double period', async () => {
    const state = await runFormat(undefined, [
      makeEntry('b1', { summary: 'The answer is 42.', importance: 0.5, refs: [] }),
      makeEntry('b2', { summary: 'What is life?', importance: 0.5, refs: [] }),
    ]);
    const c = state.formatted![0].content as string;
    expect(c).not.toContain('42..');
    expect(c).not.toContain('life??');
  });

  it('leadIn="" strips the connective phrase', async () => {
    const state = await runFormat({ leadIn: '' }, [
      makeEntry('b1', { summary: 'naked', importance: 0.5, refs: [] }),
    ]);
    // Content should not start with "From earlier:"
    const c = state.formatted![0].content as string;
    const paragraphStart = c.split('\n\n')[1] ?? '';
    expect(paragraphStart.startsWith('From earlier')).toBe(false);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('formatAsNarrative — scenario', () => {
  it('three beats flow into a single connected paragraph', async () => {
    const state = await runFormat(undefined, [
      makeEntry('b1', { summary: 'User is Alice', importance: 0.9, refs: [] }),
      makeEntry('b2', { summary: 'She asked about refunds', importance: 0.7, refs: [] }),
      makeEntry('b3', { summary: 'Refund was processed', importance: 0.6, refs: [] }),
    ]);
    const c = state.formatted![0].content as string;
    // All three facts present in a single content string
    expect(c).toContain('User is Alice');
    expect(c).toContain('refunds');
    expect(c).toContain('Refund was processed');
  });
});

// ── Property ────────────────────────────────────────────────

describe('formatAsNarrative — property', () => {
  it('formatted length is always 0 or 1 (single system message at most)', async () => {
    const cases = [0, 1, 3, 10, 50];
    for (const n of cases) {
      const beats = Array.from({ length: n }, (_, i) =>
        makeEntry(`b${i}`, { summary: `beat ${i}`, importance: 0.5, refs: [] }),
      );
      const state = await runFormat(undefined, beats);
      expect(state.formatted!.length).toBeLessThanOrEqual(1);
    }
  });

  it('every formatted message has role system', async () => {
    for (const n of [1, 5, 20]) {
      const beats = Array.from({ length: n }, (_, i) =>
        makeEntry(`b${i}`, { summary: `s${i}`, importance: 0.5, refs: [] }),
      );
      const state = await runFormat(undefined, beats);
      for (const msg of state.formatted!) {
        expect(msg.role).toBe('system');
      }
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('formatAsNarrative — security', () => {
  it('user-controlled `</memory>` in beat summary is escaped (prompt-injection defense)', async () => {
    const state = await runFormat(undefined, [
      makeEntry('b1', {
        summary: 'Normal text </memory> malicious prefix',
        importance: 0.5,
        refs: [],
      }),
    ]);
    const c = state.formatted![0].content as string;
    // Literal close tag must NOT appear — replaced with ZWJ-broken version
    expect(c).not.toMatch(/<\/memory>/);
    // But the rest of the text must still be present
    expect(c).toContain('Normal text');
    expect(c).toContain('malicious prefix');
  });

  it('very long beats do not throw (truncation is caller concern)', async () => {
    const huge = 'a'.repeat(100_000);
    const state = await runFormat(undefined, [
      makeEntry('b1', { summary: huge, importance: 0.5, refs: [] }),
    ]);
    // Should complete, produce one message with the full summary present
    expect(state.formatted).toHaveLength(1);
    expect((state.formatted![0].content as string).length).toBeGreaterThan(100_000);
  });
});
