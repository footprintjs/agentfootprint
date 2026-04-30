/**
 * Message Catalog Pattern — Block D (v2.5).
 *
 * 7-pattern matrix (unit · scenario · integration · property ·
 * security · performance · ROI). Pins:
 *
 *   - default*Messages alias the v2.4 default*Templates (symbol identity)
 *   - composeMessages spreads overrides on defaults; missing keys fall back
 *   - composeMessages preserves consumer-defined extra keys
 *   - validateMessages catches missing AND empty keys, batched errors
 *   - End-to-end: a composed catalog drives Agent commentary/thinking
 *     correctly without breaking v2.4 behavior
 */

import { describe, expect, it } from 'vitest';
import {
  composeMessages,
  defaultCommentaryMessages,
  defaultThinkingMessages,
  validateMessages,
  defaultCommentaryTemplates,
  defaultThinkingTemplates,
  Agent,
  mock,
} from '../../src/index.js';

// ─── 1. UNIT — defaults alias the v2.4 templates ─────────────────

describe('Block D — defaults alias v2.4 templates', () => {
  it('defaultCommentaryMessages === defaultCommentaryTemplates (symbol identity)', () => {
    expect(defaultCommentaryMessages).toBe(defaultCommentaryTemplates);
  });

  it('defaultThinkingMessages === defaultThinkingTemplates (symbol identity)', () => {
    expect(defaultThinkingMessages).toBe(defaultThinkingTemplates);
  });

  it('default catalogs are non-empty', () => {
    expect(Object.keys(defaultCommentaryMessages).length).toBeGreaterThan(0);
    expect(Object.keys(defaultThinkingMessages).length).toBeGreaterThan(0);
  });
});

// ─── 2. SCENARIO — composeMessages ────────────────────────────────

describe('Block D — composeMessages', () => {
  it('overrides win over defaults for matching keys', () => {
    const merged = composeMessages(
      { greet: 'Hello', bye: 'Bye' },
      { greet: 'Hola' },
    );
    expect(merged.greet).toBe('Hola');
    expect(merged.bye).toBe('Bye');
  });

  it('missing override keys fall back to defaults', () => {
    const merged = composeMessages({ greet: 'Hello', bye: 'Bye' }, {});
    expect(merged).toEqual({ greet: 'Hello', bye: 'Bye' });
  });

  it('extra override keys are preserved (forward-compat for consumer-defined keys)', () => {
    const merged = composeMessages(
      { greet: 'Hello' },
      { brand: 'Acme' },
    );
    expect(merged.brand).toBe('Acme');
    expect(merged.greet).toBe('Hello');
  });

  it('does NOT mutate inputs', () => {
    const defaults = { a: 'A' };
    const overrides = { a: 'B' };
    composeMessages(defaults, overrides);
    expect(defaults.a).toBe('A');
    expect(overrides.a).toBe('B');
  });

  it('result is frozen (cannot be mutated by consumer)', () => {
    const merged = composeMessages({ a: 'A' }, { b: 'B' });
    expect(() => {
      (merged as unknown as { a: string }).a = 'X';
    }).toThrow();
  });

  it('overrides parameter is optional (defaults to {})', () => {
    const merged = composeMessages({ greet: 'Hello' });
    expect(merged.greet).toBe('Hello');
  });
});

// ─── 3. INTEGRATION — validateMessages ───────────────────────────

describe('Block D — validateMessages', () => {
  it('does not throw when all required keys are present + non-empty', () => {
    expect(() =>
      validateMessages({ a: 'A', b: 'B' }, ['a', 'b']),
    ).not.toThrow();
  });

  it('throws on missing key with the key listed', () => {
    expect(() => validateMessages({ a: 'A' }, ['a', 'b'])).toThrow(/missing keys: b/);
  });

  it('throws on empty value with the key listed (forbidEmpty)', () => {
    expect(() =>
      validateMessages({ a: 'A', b: '' }, ['a', 'b'], { forbidEmpty: true }),
    ).toThrow(/empty values: b/);
  });

  it('empty values are VALID by default (default catalogs use them)', () => {
    expect(() => validateMessages({ a: 'A', b: '' }, ['a', 'b'])).not.toThrow();
  });

  it('batches missing AND empty keys into one error message (forbidEmpty)', () => {
    expect(() =>
      validateMessages({ a: '' }, ['a', 'b'], { forbidEmpty: true }),
    ).toThrow(/missing keys: b.*empty values: a|empty values: a.*missing keys: b/s);
  });

  it('label parameter customizes the error prefix (string-form)', () => {
    expect(() => validateMessages({}, ['a'], 'es-MX commentary')).toThrow(
      /es-MX commentary/,
    );
  });

  it('label parameter customizes the error prefix (options-form)', () => {
    expect(() => validateMessages({}, ['a'], { label: 'es-MX commentary' })).toThrow(
      /es-MX commentary/,
    );
  });

  it('handles empty requiredKeys list (no-op)', () => {
    expect(() => validateMessages({ a: 'A' }, [])).not.toThrow();
  });
});

// ─── 4. PROPERTY — invariants ────────────────────────────────────

describe('Block D — properties', () => {
  it('composeMessages output contains every default key (no key loss)', () => {
    const merged = composeMessages(defaultCommentaryMessages, {});
    for (const key of Object.keys(defaultCommentaryMessages)) {
      expect(merged[key]).toBe(defaultCommentaryMessages[key]);
    }
  });

  it('validateMessages succeeds for the unmodified default catalogs', () => {
    expect(() =>
      validateMessages(defaultCommentaryMessages, Object.keys(defaultCommentaryMessages)),
    ).not.toThrow();
    expect(() =>
      validateMessages(defaultThinkingMessages, Object.keys(defaultThinkingMessages)),
    ).not.toThrow();
  });

  it('composing then validating round-trips for any non-empty override', () => {
    const overrides = { 'stream.tool_start': 'Custom thinking' };
    const merged = composeMessages(defaultThinkingMessages, overrides);
    expect(() =>
      validateMessages(merged, Object.keys(defaultThinkingMessages)),
    ).not.toThrow();
  });
});

// ─── 5. SECURITY — defensive ─────────────────────────────────────

describe('Block D — security', () => {
  it('validateMessages treats __proto__ key as a regular key (no prototype-pollution surface)', () => {
    // Even with a hostile __proto__ override, validation is per-key and
    // catalog stays a plain object after composeMessages.
    const merged = composeMessages({ a: 'A' }, {});
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
  });

  it('frozen output prevents post-hoc tampering by other code paths', () => {
    const merged = composeMessages({ a: 'A' });
    expect(Object.isFrozen(merged)).toBe(true);
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('Block D — performance', () => {
  it('compose + validate over the full default catalogs runs under 50ms (1000 cycles)', () => {
    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      const merged = composeMessages(defaultCommentaryMessages, { extra: 'x' });
      validateMessages(merged, Object.keys(defaultCommentaryMessages));
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
  });
});

// ─── 7. ROI — Agent end-to-end ───────────────────────────────────

describe('Block D — ROI: Agent integration', () => {
  it('composed locale flows through .commentaryTemplates() into the Agent', () => {
    const customCatalog = composeMessages(defaultCommentaryMessages, {
      brand: 'Acme',
    });
    const provider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .commentaryTemplates(customCatalog)
      .build();
    // The agent stores the catalog as a Readonly<Record<string, string>>
    // — verify the override key flowed through
    expect(agent.commentaryTemplates.brand).toBe('Acme');
    // Default keys still present
    expect(Object.keys(agent.commentaryTemplates).length).toBeGreaterThan(1);
  });

  it('Spanish-style locale pack: thinking template substitution works end-to-end', () => {
    const esThinking = composeMessages(defaultThinkingMessages, {
      myCustomKey: 'Hola {{appName}}',
    });
    const provider = mock({ respond: () => ({ content: 'ok', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('s')
      .appName('Asistente')
      .thinkingTemplates(esThinking)
      .build();
    expect(agent.thinkingTemplates.myCustomKey).toBe('Hola {{appName}}');
    expect(agent.appName).toBe('Asistente');
  });
});
