/**
 * The three tool-side moments that used to render raw in the Story Lens:
 * an oversized result that was refused (`tools.result_refused`), a typed tool
 * effect being judged (`tools.effect`), the same call coming back with the same
 * answer (`tools.repeated_call`) — plus the escalation moment
 * (`skill.escalated`), whose count is now pluralized honestly.
 *
 * What these tests hold:
 *
 *   • The sentence claims only what the event carries. The refused result says
 *     how big it was and what the model was told; it never implies a retry
 *     happened, because no event says one did. The repeated call says the model
 *     was told — not that anything was refused or withheld, because nothing was.
 *   • Digests and payloads stay out of prose. `argsFingerprint` /
 *     `resultFingerprint` answer "is this the same?" and the sentence already
 *     answers that in words.
 *   • Optional reasons ride clauses. Through 9.26.0 an accepted transition with
 *     no `reason` rendered a pair of EMPTY QUOTES — prose quoting words nobody
 *     spoke. That is the bug the clause shape exists to prevent.
 */

import { describe, expect, it } from 'vitest';

import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';

function ev(type: string, payload: Record<string, unknown>): AgentfootprintEvent {
  return { type, payload, meta: {} } as unknown as AgentfootprintEvent;
}

function line(event: AgentfootprintEvent): string {
  const key = selectCommentaryKey(event);
  expect(typeof key).toBe('string');
  const vars = extractCommentaryVars(event, { appName: 'Acme' });
  return renderCommentary(defaultCommentaryTemplates[key as string] ?? '', vars);
}

// ── tools.result_refused ──────────────────────────────────────────────

describe('tools.result_refused commentary', () => {
  const refused = (extra: Record<string, unknown> = {}): AgentfootprintEvent =>
    ev('agentfootprint.tools.result_refused', {
      toolName: 'search_pages',
      toolCallId: 'call-1',
      iteration: 2,
      sizeChars: 240_000,
      maxChars: 20_000,
      ...extra,
    });

  it('states the true size, the tool’s own limit, and how to narrow', () => {
    expect(line(refused({ narrowBy: ['zone', 'limit'] }))).toBe(
      '`search_pages` returned more than it is allowed to hand back (240,000 characters, ' +
        'against a limit of 20,000 characters) — the model got no data, only a note on how to ' +
        'ask for less (narrowing by `zone` or `limit` would help).',
    );
  });

  it('a single narrowing parameter reads in the singular', () => {
    expect(line(refused({ narrowBy: ['zone'] }))).toContain('(narrowing by `zone` would help)');
  });

  it('omits the narrowing clause when the tool declared none', () => {
    const text = line(refused());
    expect(text).toBe(
      '`search_pages` returned more than it is allowed to hand back (240,000 characters, ' +
        'against a limit of 20,000 characters) — the model got no data, only a note on how to ' +
        'ask for less.',
    );
    expect(text).not.toContain('narrowing by');
  });

  it('does not claim a retry happened — no event says one did', () => {
    expect(line(refused()).toLowerCase()).not.toContain('retr');
  });
});

// ── tools.repeated_call ───────────────────────────────────────────────

describe('tools.repeated_call commentary', () => {
  const repeated = ev('agentfootprint.tools.repeated_call', {
    toolName: 'get_zone',
    toolCallId: 'call-7',
    iteration: 4,
    occurrences: 3,
    argsFingerprint: 'a1b2c3',
    resultFingerprint: 'd4e5f6',
  });

  it('narrates the nudge without implying anything was refused', () => {
    expect(line(repeated)).toBe(
      '`get_zone` was called with the same inputs and gave back the same answer as before — ' +
        'that makes 3 identical calls this turn, and the model was told so.',
    );
  });

  it('keeps the fingerprints out of prose', () => {
    const text = line(repeated);
    expect(text).not.toContain('a1b2c3');
    expect(text).not.toContain('d4e5f6');
  });

  // The arguments-only variant (9.62.0): the tool declared `repeatedWhen:
  // 'arguments'`, so the match never looked at the result — the sentence
  // must not claim it did.
  it('an arguments-only match never claims the answer was the same', () => {
    const argsOnly = ev('agentfootprint.tools.repeated_call', {
      toolName: 'render_screen',
      toolCallId: 'call-9',
      iteration: 2,
      occurrences: 2,
      argsFingerprint: 'a1b2c3',
      resultFingerprint: 'd4e5f6',
      mode: 'arguments',
    });
    expect(line(argsOnly)).toBe(
      '`render_screen` was called with the same arguments as before — this tool does not ' +
        'compare its result — that makes 2 identical calls this turn, and the model was told so.',
    );
    expect(line(argsOnly)).not.toContain('gave back the same answer');
  });
});

// ── tools.effect ──────────────────────────────────────────────────────

describe('tools.effect commentary — the proposal and its reason', () => {
  const effect = (payload: Record<string, unknown>): AgentfootprintEvent =>
    ev('agentfootprint.tools.effect', {
      toolName: 'route_tool',
      iteration: 1,
      ...payload,
    });

  it('an accepted transition quotes the proposal’s own reason', () => {
    expect(
      line(
        effect({
          kind: 'propose-transition',
          outcome: 'accepted',
          targetSkillId: 'billing',
          reason: 'the user asked about an invoice',
        }),
      ),
    ).toBe(
      '`route_tool` proposed moving to the `billing` skill (“the user asked about an invoice”) ' +
        'and the graph accepted it.',
    );
  });

  it('an accepted transition with no reason quotes nothing at all', () => {
    const text = line(
      effect({ kind: 'propose-transition', outcome: 'accepted', targetSkillId: 'billing' }),
    );
    expect(text).toBe(
      '`route_tool` proposed moving to the `billing` skill and the graph accepted it.',
    );
    expect(text).not.toContain('“');
  });

  it('a refused transition carries the teaching sentence', () => {
    expect(
      line(
        effect({
          kind: 'propose-transition',
          outcome: 'refused',
          targetSkillId: 'billing',
          refusalReason: '`billing` is not reachable from here',
        }),
      ),
    ).toBe(
      '`route_tool` proposed moving to `billing` and the graph refused it ' +
        '(“`billing` is not reachable from here”) — the teaching refusal is on the record.',
    );
  });

  it('a refused instruction carries its own refusal reason', () => {
    expect(
      line(
        effect({
          kind: 'require-instruction',
          outcome: 'refused',
          instructionId: 'tone-rules',
          refusalReason: 'no instruction is registered under that id',
        }),
      ),
    ).toBe(
      '`route_tool` asked to push the `tone-rules` instruction and was refused ' +
        '(“no instruction is registered under that id”) — the teaching refusal is on the record.',
    );
  });

  it('a refusal with no reason recorded says nothing in its place', () => {
    const text = line(
      effect({ kind: 'propose-transition', outcome: 'refused', targetSkillId: 'billing' }),
    );
    expect(text).toBe(
      '`route_tool` proposed moving to `billing` and the graph refused it — the teaching ' +
        'refusal is on the record.',
    );
  });
});

// ── skill.escalated ───────────────────────────────────────────────────

describe('skill.escalated commentary — which brain took over, and why', () => {
  const escalated = (refusals: number, to: Record<string, string>): AgentfootprintEvent =>
    ev('agentfootprint.skill.escalated', {
      iteration: 3,
      afterRefusals: refusals,
      refusals,
      from: { provider: 'mock', model: 'small-model' },
      to,
    });

  it('names both brains and the evidence that tripped the threshold', () => {
    expect(line(escalated(2, { provider: 'mock', model: 'big-model' }))).toBe(
      'After 2 refused routing attempts, the rest of the turn escalated from small-model to ' +
        'big-model.',
    );
  });

  it('a single refusal reads in the singular', () => {
    expect(line(escalated(1, { provider: 'mock', model: 'big-model' }))).toContain(
      'After 1 refused routing attempt,',
    );
  });

  it('an escalation brain that inherits its model names the provider', () => {
    expect(line(escalated(2, { provider: 'edge-provider' }))).toContain('to edge-provider.');
  });
});

// ── stream.tool_progress ──────────────────────────────────────────────

describe('stream.tool_progress commentary', () => {
  const progress = (payload: unknown = { done: 3, total: 12 }): AgentfootprintEvent =>
    ev('agentfootprint.stream.tool_progress', {
      toolCallId: 'call-1',
      toolName: 'walk_graph',
      iteration: 1,
      payload,
    });

  it('narrates that the call broke its silence — the teaching voice, verbatim from Lens', () => {
    expect(line(progress())).toBe(
      'The `walk_graph` tool reported progress while it was still running.',
    );
  });

  it('says the same thing whatever the author put in the payload — no field dumps', () => {
    const dumps = [
      progress({ done: 3, total: 12, hop: 'pricing' }),
      progress({ message: 'Hop 3 of 12' }),
      progress('a bare string'),
      progress(undefined),
    ];
    for (const e of dumps) {
      const out = line(e);
      expect(out).toBe('The `walk_graph` tool reported progress while it was still running.');
      expect(out).not.toContain('pricing');
      expect(out).not.toContain('{');
      expect(out).not.toMatch(/\{\{/);
    }
  });

  it('routes to a key that exists', () => {
    const key = selectCommentaryKey(progress());
    expect(key).toBe('stream.tool_progress');
    expect(defaultCommentaryTemplates[key as string]).toBeDefined();
  });
});
