/**
 * Commentary for the skill-graph ROUTING VERDICTS (SG-C, 9.16.0/9.17.0).
 *
 * Three event surfaces:
 *   • `skill.turn_routed`   — the turn-start cascade's verdict (who decided,
 *     with the numbers the event carries: ranked scores, runner-up, near-tie).
 *   • `skill.route_conflict` — one parallel tool batch, two matched edges,
 *     different targets; the suppressed hop is on the record.
 *   • `skill.rejected` posture refusals (`guard` / `rails`) + the model-pick
 *     decorations on `context.evaluated.cursorMove` (`offered`/`declinedOffer`).
 *
 * House law under test: render ONLY what the event carries (a missing field
 * means the sentence omits it, never guesses), and events the templates don't
 * know keep the fall-through (`undefined` → raw render downstream, never
 * dropped).
 */

import { describe, expect, it } from 'vitest';
import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';

const meta = {
  wallClockMs: 1,
  runOffsetMs: 0,
  runtimeStageId: 'rid#0',
  subflowPath: [],
  compositionPath: [],
  runId: 'test',
};

function event(type: string, payload: unknown): AgentfootprintEvent {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { type, payload, meta } as any;
}

const policy = { nearTieMargin: 0.1, menuSize: 3 };
const ctx = { appName: 'Neo' };
const render = (e: AgentfootprintEvent) => {
  const key = selectCommentaryKey(e);
  if (!key) return null;
  const vars = extractCommentaryVars(e, ctx);
  return renderCommentary(defaultCommentaryTemplates[key] ?? '', vars);
};

describe('commentary — skill.turn_routed verdicts', () => {
  it('by=intent with scores → names the winner, both raw scores, and the scorer', () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'intent',
      to: 'shipping',
      scorer: 'keyword',
      decisive: true,
      scores: [
        { id: 'shipping', score: 0.87, relevance: 0.62 },
        { id: 'billing', score: 0.21, relevance: 0.38 },
      ],
      runnerUp: { id: 'billing', gap: 0.66 },
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.intent');
    expect(render(e)).toBe(
      'The new message decisively matched `shipping` — scored 0.87 vs 0.21 runner-up ' +
        "(judged by the 'keyword' scorer), so the turn starts there.",
    );
  });

  it('by=intent WITHOUT scores → the sentence omits the numbers (never guesses)', () => {
    const e = event('agentfootprint.skill.turn_routed', { by: 'intent', to: 'shipping', policy });
    expect(render(e)).toBe(
      'The new message decisively matched `shipping`, so the turn starts there.',
    );
  });

  it('near-tie hold (continuity + decisive=false + scores) → both shares as percentages', () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'continuity',
      from: 'billing',
      to: 'billing',
      decisive: false,
      scores: [
        { id: 'shipping', score: 0.44, relevance: 0.44 },
        { id: 'billing', score: 0.41, relevance: 0.41 },
      ],
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.continuity.nearTie');
    expect(render(e)).toBe(
      'Near-tie between `shipping` (44%) and `billing` (41%) — Neo stayed put, continuing in `billing`.',
    );
  });

  it('plain continuity (no scores) keeps the existing sentence, `to` falling back to `from`', () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'continuity',
      from: 'billing',
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.continuity');
    expect(render(e)).toBe('Neo picked up where the conversation left off — still in `billing`.');
  });

  it("era tolerance: by='rule' reads as the tier-1 entry verdict", () => {
    const e = event('agentfootprint.skill.turn_routed', { by: 'rule', to: 'billing', policy });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.entry');
    expect(render(e)).toBe('A declared start rule routed this turn to `billing`.');
  });

  it("by='none' with the offer but NO numbers → posture-only prose, no claimed reason", () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'none',
      offered: ['billing', 'shipping'],
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.none.rails');
    expect(render(e)).toBe(
      'Routing ended in a menu, but this graph does not let the model route — the turn ran ' +
        'on the base prompt. On the record: `billing`, `shipping`.',
    );
  });

  it("by='none' rails near-tie (decisive=false, top clears the floor) → intent DID match, too closely to call", () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'none',
      offered: ['billing', 'shipping'],
      decisive: false,
      scores: [
        { id: 'billing', score: 0.44, relevance: 0.44 },
        { id: 'shipping', score: 0.41, relevance: 0.41 },
      ],
      policy: { ...policy, floor: 0.3 },
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.none.rails.nearTie');
    expect(render(e)).toBe(
      'This message matched `billing`, `shipping` too closely to call, and this graph does not let ' +
        'the model break the tie — the turn ran on the base prompt.',
    );
  });

  it("by='none' rails unmatched (top at/below the floor) → the offer is the FULL menu, never 'close candidates'", () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'none',
      offered: ['billing', 'shipping', 'help-desk'],
      decisive: false,
      scores: [
        { id: 'billing', score: 0.2, relevance: 0.55 },
        { id: 'shipping', score: 0.1, relevance: 0.45 },
      ],
      policy: { ...policy, floor: 0.3 },
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.none.rails.unmatched');
    expect(render(e)).toBe(
      'No start rule or intent matched this message strongly enough, and this graph does not ' +
        'let the model route — the turn ran on the base prompt. The full menu stayed on the ' +
        'record: `billing`, `shipping`, `help-desk`.',
    );
  });

  it("by='none' without an offer keeps the plain none sentence", () => {
    const e = event('agentfootprint.skill.turn_routed', { by: 'none', policy });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.none');
  });

  it('a dropped resume outranks the verdict it forced', () => {
    const e = event('agentfootprint.skill.turn_routed', {
      by: 'none',
      droppedResume: { id: 'billing', reason: 'unknown-skill' },
      policy,
    });
    expect(selectCommentaryKey(e)).toBe('skill.turn_routed.dropped');
    expect(render(e)).toContain('`billing`');
    expect(render(e)).toContain('started fresh');
  });
});

describe('commentary — skill.route_conflict', () => {
  it('one suppressed hop → winner (first in the batch) + the loser on the record', () => {
    const e = event('agentfootprint.skill.route_conflict', {
      iteration: 2,
      winner: { toolCallId: 'c1', toolName: 'get_order', target: 'shipping' },
      losers: [{ toolCallId: 'c2', toolName: 'check_charge', target: 'billing' }],
    });
    expect(selectCommentaryKey(e)).toBe('skill.route_conflict');
    expect(render(e)).toBe(
      'Two tool results wanted different next skills — `get_order` → `shipping` won ' +
        '(first in the batch); `check_charge` → `billing` was suppressed and is on the record.',
    );
  });

  it('several suppressed hops → the head COUNTS all three results, plural grammar, all named in call order', () => {
    const e = event('agentfootprint.skill.route_conflict', {
      iteration: 1,
      winner: { toolName: 'get_order', target: 'shipping' },
      losers: [
        { toolName: 'check_charge', target: 'billing' },
        { toolName: 'open_ticket', target: 'help-desk' },
      ],
    });
    // Full-string assertion on purpose: a toContain on the suffix once let a
    // hard-coded "Two" head lie about a three-result batch.
    expect(render(e)).toBe(
      'Three tool results wanted different next skills — `get_order` → `shipping` won ' +
        '(first in the batch); `check_charge` → `billing` and `open_ticket` → `help-desk` ' +
        'were suppressed and are on the record.',
    );
  });
});

describe('commentary — skill.rejected posture refusals', () => {
  const base = {
    requestedId: 'help-desk',
    currentSkillId: 'billing',
    allowed: ['billing'],
    iteration: 1,
  };

  it("posture='guard' → reachable but off the menu", () => {
    const e = event('agentfootprint.skill.rejected', { ...base, posture: 'guard' });
    expect(selectCommentaryKey(e)).toBe('skill.rejected.guard');
    expect(render(e)).toBe(
      'The model asked for the `help-desk` skill, but that choice was not on the menu ' +
        'it was offered — Neo refused the jump and re-prompted with the allowed options.',
    );
  });

  it("posture='rails' → the model never routes", () => {
    const e = event('agentfootprint.skill.rejected', { ...base, posture: 'rails' });
    expect(selectCommentaryKey(e)).toBe('skill.rejected.rails');
    expect(render(e)).toBe(
      'The model asked for the `help-desk` skill, but this graph does not let the model ' +
        'route — Neo refused the jump; start rules and declared routes decide moves.',
    );
  });

  it('no posture (plain reachability refusal) keeps the pre-9.17 fall-through — raw render, never dropped', () => {
    expect(selectCommentaryKey(event('agentfootprint.skill.rejected', base))).toBeUndefined();
  });
});

describe('commentary — model-pick decorations on context.evaluated.cursorMove', () => {
  const evaluated = (extra: Record<string, unknown>) =>
    event('agentfootprint.context.evaluated', {
      iteration: 1,
      activeCount: 1,
      skippedCount: 0,
      evaluatedTotal: 1,
      activeIds: ['help-desk'],
      skippedDetails: [],
      triggerKindCounts: {},
      skillCatalog: [],
      ...extra,
    });

  it('a pick that resolved a menu → names the choice and the menu size', () => {
    const e = evaluated({
      cursorMove: { by: 'model-pick', to: 'help-desk', offered: ['help-desk', 'shipping'] },
    });
    expect(selectCommentaryKey(e)).toBe('context.model_pick');
    expect(render(e)).toBe(
      'The model chose the `help-desk` skill from the 2-option menu it was offered.',
    );
  });

  it('staying put was on the menu and the pick left it → says so (derived, not invented)', () => {
    const e = evaluated({
      cursorMove: {
        by: 'model-pick',
        from: 'billing',
        to: 'help-desk',
        offered: ['billing', 'help-desk', 'shipping'],
      },
    });
    expect(render(e)).toBe(
      'The model chose the `help-desk` skill from the 3-option menu it was offered; ' +
        'staying put was offered and declined.',
    );
  });

  it('declinedOffer → the divergence sentence, no menu-membership claim', () => {
    const e = evaluated({
      cursorMove: {
        by: 'model-pick',
        to: 'ops',
        offered: ['billing', 'shipping'],
        declinedOffer: true,
      },
    });
    expect(render(e)).toBe(
      'The model chose the `ops` skill — a pick that was not on the menu it was offered; ' +
        'the divergence is on the record.',
    );
  });

  it('old-era event (cursorMove without decorations) keeps the context.routed line', () => {
    const e = evaluated({
      cursorMove: { by: 'model-pick', to: 'help-desk' },
      routing: [{ injectionId: 'help-desk', flavor: 'skill', via: 'model', tools: ['t1'] }],
    });
    expect(selectCommentaryKey(e)).toBe('context.routed');
  });
});

describe('commentary — unknown events fall through, never dropped', () => {
  it('an event type the templates do not know returns undefined (raw render downstream)', () => {
    expect(
      selectCommentaryKey(event('agentfootprint.skill.some_future_event', {})),
    ).toBeUndefined();
  });
});
