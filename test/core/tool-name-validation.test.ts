/**
 * Tool-name validation — guard names no LLM provider accepts.
 *
 * OpenAI, Azure OpenAI, and Anthropic all require ^[a-zA-Z0-9_-]{1,64}$. A
 * non-conformant name 400-rejects the WHOLE request (every tool vanishes), which
 * reads as "my tool isn't visible". Default guard is a DEV-MODE WARN (non-breaking
 * — mocks/custom providers/namespaced names keep working); `assertValidToolName`
 * is the strict throwing opt-in.
 *
 * Convention-3 tiers (scoped to a pure validator): unit (charset rules),
 * functional (defineTool dev-warns; assert throws), property (any conformant
 * string passes; any with a forbidden char fails), security (no ReDoS / input).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { enableDevMode, disableDevMode } from 'footprintjs';
import { defineTool, assertValidToolName } from '../../src/index.js';

const ok = (name: string) =>
  defineTool({ name, description: 'd', inputSchema: { type: 'object' }, execute: () => 'x' });

describe('tool-name validation — unit (charset rules)', () => {
  it('accepts the legal charset: letters, digits, underscore, hyphen, ≤64 chars', () => {
    for (const name of ['get_status', 'influx-get_port', 'Tool42', 'a', 'A_B-9', 'x'.repeat(64)]) {
      expect(() => assertValidToolName(name)).not.toThrow();
    }
  });

  it('rejects the common real offenders (dot, space, slash, colon) naming the tool', () => {
    for (const bad of ['volume.lookup', 'get status', 'mds/health', 'influx:read', 'a.b.c']) {
      expect(() => assertValidToolName(bad)).toThrow(/tool name/);
      expect(() => assertValidToolName(bad)).toThrow(
        new RegExp(JSON.stringify(bad).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    }
  });

  it('rejects empty / non-string / >64 chars with a specific reason', () => {
    expect(() => assertValidToolName('')).toThrow(/non-empty string/);
    expect(() => assertValidToolName(undefined)).toThrow(/non-empty string/);
    expect(() => assertValidToolName('x'.repeat(65))).toThrow(/65 chars \(max 64\)/);
  });

  it('the message points at the fix (rename, the regex, and why)', () => {
    let msg = '';
    try {
      assertValidToolName('bad.name');
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain('/^[a-zA-Z0-9_-]{1,64}$/');
    expect(msg).toContain('400-reject');
    expect(msg).toMatch(/replace/i);
  });
});

describe('tool-name validation — functional (defineTool dev-warns, never throws)', () => {
  afterEach(() => {
    disableDevMode();
    vi.restoreAllMocks();
  });

  it('defineTool does NOT throw on a bad name (non-breaking: mocks / namespaced names keep working)', () => {
    expect(() => ok('list.volumes')).not.toThrow();
    expect(ok('slack.sendDM').schema.name).toBe('slack.sendDM'); // tool is still created
  });

  it('in DEV mode, defineTool warns about a name OpenAI/Anthropic will reject', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    ok('list.volumes');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('list.volumes');
    expect(warn.mock.calls[0][0]).toContain('400-reject');
  });

  it('a valid name never warns, even in dev mode', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    enableDevMode();
    const t = ok('list_volumes');
    expect(t.schema.name).toBe('list_volumes');
    expect(warn).not.toHaveBeenCalled();
  });

  it('assertValidToolName stays STRICT (throws) for consumers who want a hard failure', () => {
    expect(() => assertValidToolName('list.volumes')).toThrow(/400-reject/);
  });
});

describe('tool-name validation — property + security', () => {
  it('property: any string over the legal alphabet (1..64) passes; injecting one forbidden char fails', () => {
    const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-';
    for (let i = 0; i < 200; i++) {
      // deterministic pseudo-pick by index (no Math.random in this env)
      const len = 1 + (i % 64);
      let s = '';
      for (let j = 0; j < len; j++) s += alphabet[(i * 31 + j * 7) % alphabet.length];
      expect(() => assertValidToolName(s)).not.toThrow();
      expect(() => assertValidToolName(s + '.')).toThrow(); // one forbidden char ⇒ reject
    }
  });

  it('security: pathological inputs do not hang or wrongly pass', () => {
    expect(() => assertValidToolName('a'.repeat(100000))).toThrow(/max 64/); // bounded, no ReDoS
    expect(() => assertValidToolName('a\nb')).toThrow(); // newline is not in the class
    expect(() => assertValidToolName('emoji_🚀')).toThrow(); // non-ASCII rejected
  });
});
