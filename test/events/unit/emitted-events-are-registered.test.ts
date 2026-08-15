/**
 * The registry tells the truth about what the runtime emits.
 *
 * Pattern: Test-as-specification, derived — not hand-maintained.
 * Role:    Close the ONE hole every other test in test/events/ shares.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `test/events/unit/registry.test.ts` checks that `ALL_EVENT_TYPES` is
 * internally consistent: it matches `EVENT_NAMES`, it has no duplicates, every
 * entry is a key of `AgentfootprintEventMap`, and the count matches a pin.
 * Every one of those assertions reads the registry and only the registry. So a
 * list that is internally perfect and simply MISSING an event the runtime
 * really fires passes all of them — the omission is invisible by construction.
 *
 * That is not hypothetical. `agentfootprint.resilience.output_fallback_triggered`
 * and `agentfootprint.resilience.output_canned_used` were emitted from
 * `src/core/outputFallback.ts` from 8.18.0, documented on the site as "two
 * typed events for observability", and absent from `ALL_EVENT_TYPES` the whole
 * time — so `runner.on(<either name>)` did not compile. The suite was green
 * throughout. `test/core/outputFallback.test.ts` even asserted both events fire
 * at runtime, but had to write `.on(name as never)` to get past the type — the
 * cast silenced the very error that would have reported the bug.
 *
 * This test derives the emitted set from `src/` instead, so the registry is
 * checked against the code rather than against itself.
 *
 * DIRECTION OF THE ASSERTION
 * --------------------------
 * emitted ⊆ registered. One direction only, deliberately.
 *
 * The reverse (registered ⊆ emitted) is NOT asserted, because a static scan
 * cannot see events dispatched through a variable — the `EmitBridge` forwards
 * whole domains by prefix, and recorders re-dispatch a `type` they were handed.
 * ~24 legitimately-registered events are emitted only that way. Asserting the
 * reverse would fail on all of them and the test would be deleted within a
 * week. The subset direction has no false positives: a string literal sitting
 * in an emit call IS an event the runtime can fire.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ALL_EVENT_TYPES } from '../../../src/events/registry.js';

const ROOT = join(__dirname, '../../..');
const SRC = join(ROOT, 'src');

/** Every `agentfootprint.<domain>.<action>` literal. */
const EVENT_PATTERN = String.raw`agentfootprint\.[a-z0-9_]+\.[a-z0-9_]+`;

/**
 * A call whose callee ENDS in an emit-ish verb, then optionally a first
 * argument (the scope, for `typedEmit(scope, name, …)`), then the event
 * literal. `[\s\S]` rather than `.` so a call broken across lines — which is
 * the normal formatting for these — is still matched. A line-anchored scan
 * would miss them, which is exactly the blind spot that let this ship.
 */
const EMIT_CALL = new RegExp(
  String.raw`\b([A-Za-z_$][\w$.]*)\s*\(\s*(?:[A-Za-z_$][\w$.\[\]'"]*\s*,\s*)?['"](` +
    EVENT_PATTERN +
    String.raw`)['"]`,
  'g',
);

const EMIT_VERB = /^(emit|dispatch|\$emit|typedEmit|emitEvent|publish|fire)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * Blank out comment BODIES, preserving length and newlines so reported line
 * numbers stay true. Without this, the `Emits:` header every module carries
 * and the `@example` blocks would register as emit sites and the test would
 * report events that no code path can reach.
 */
function stripComments(text: string): string {
  let out = '';
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  for (let i = 0; i < text.length; ) {
    const c = text[i] as string;
    const c2 = text[i + 1];
    if (state === 'code') {
      if (c === '/' && c2 === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && c2 === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'") state = 'sq';
      else if (c === '"') state = 'dq';
      else if (c === '`') state = 'tpl';
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += c;
      } else out += ' ';
      i += 1;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && c2 === '/') {
        state = 'code';
        out += '  ';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // inside a string literal
    if (c === '\\') {
      out += c + (c2 ?? '');
      i += 2;
      continue;
    }
    if (
      (state === 'sq' && c === "'") ||
      (state === 'dq' && c === '"') ||
      (state === 'tpl' && c === '`')
    ) {
      state = 'code';
    }
    out += c;
    i += 1;
  }
  return out;
}

/** event name → every `file:line` that emits it. */
function deriveEmittedEvents(): Map<string, string[]> {
  const emitted = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    const raw = readFileSync(file, 'utf8');
    if (!raw.includes('agentfootprint.')) continue;
    const code = stripComments(raw);
    for (const m of code.matchAll(EMIT_CALL)) {
      const callee = (m[1] as string).split('.').pop() as string;
      if (!EMIT_VERB.test(callee)) continue;
      const event = m[2] as string;
      const line = code.slice(0, m.index).split('\n').length;
      const where = `${relative(ROOT, file)}:${line}`;
      const seen = emitted.get(event);
      if (seen) seen.push(where);
      else emitted.set(event, [where]);
    }
  }
  return emitted;
}

describe('ALL_EVENT_TYPES is complete — derived from src, not from itself', () => {
  const emitted = deriveEmittedEvents();

  // ─── Scanner self-checks ──────────────────────────────────────────
  //
  // A derived test is only as honest as its derivation. A scanner that
  // silently stops matching (a refactor to a new emit helper, a regex that
  // rots) would make the assertion below vacuously true and this file would
  // go on reporting success forever. These two tests make the scanner prove
  // it is still looking at real code before its verdict is trusted.

  it('the scanner finds a substantial emitted set (it has not silently stopped matching)', () => {
    expect(
      emitted.size,
      'the src scan found almost no emitted events — the emit-call regex or the ' +
        'comment stripper has rotted, and the completeness assertion below is now vacuous',
    ).toBeGreaterThan(50);
  });

  it('the scanner sees the resilience emits specifically (the original blind spot)', () => {
    // These two are dispatched through a plain `emit(...)` parameter rather
    // than `typedEmit(scope, ...)`, and the call spans multiple lines. That
    // shape is what the scan has to keep handling; if it stops, the canary
    // dies here rather than in a silent pass.
    expect([...emitted.keys()]).toContain('agentfootprint.resilience.output_fallback_triggered');
    expect([...emitted.keys()]).toContain('agentfootprint.resilience.output_canned_used');
  });

  // ─── The assertion this file exists for ───────────────────────────

  it('every event emitted by src/ is registered in ALL_EVENT_TYPES', () => {
    const registered = new Set<string>(ALL_EVENT_TYPES);
    const missing = [...emitted.entries()]
      .filter(([event]) => !registered.has(event))
      .sort(([a], [b]) => a.localeCompare(b));

    expect(
      missing.map(([event, sites]) => `${event}  (emitted at ${sites.join(', ')})`),
      'These events are emitted by real code paths but are absent from ' +
        'ALL_EVENT_TYPES. A consumer cannot subscribe to them: `runner.on(name)` ' +
        'is rejected by the union type, so the docs describe an event the ' +
        'compiler denies exists. Register each one — payload interface in ' +
        'events/payloads.ts, entry in AgentfootprintEventMap, group in ' +
        'EVENT_NAMES, entry in ALL_EVENT_TYPES, and a domain wildcard in ' +
        'events/dispatcher.ts if the domain is new — then bump the count pin ' +
        'in registry.test.ts.',
    ).toEqual([]);
  });
});
