/**
 * Row "It understood" — how the question was routed to a skill, and whether the
 * decided skill reached the model. Also check 1, `decided-delivered`.
 *
 * Two vouchers, two lines: the SCORES are the app's (its scorer produced them),
 * the VERDICT is the library's (`skill.turn_routed`). Neither `decisive` nor
 * `relevance` is a confidence — confidence stays "not recorded" in v1.
 *
 * "Not delivered" is a claim of ABSENCE, so it needs proof: every system-prompt
 * composition of iterations 1..N is recorded and COMPLETE (the recorded skill
 * rows of that compose stage number exactly `sourceBreakdown.skill.count`).
 * Anything less and the check is unreachable — a missing row is never read as
 * "the skill was not given".
 *
 * The verdict has ONE reader, {@link routingVerdictOf}: the `skill.turn_routed`
 * event — or, on a RESUMED leg (whose recording holds that leg's events only),
 * the verdict the RouteTurn stage committed before the pause: `turnRoute` (by,
 * from, to, the rule's witness, the offered menu) and the scorer's
 * `entryScores` / `entryScorer`, carried in the state the run paused with
 * (`snapshot.initialState`) and on into the committed state the pointers land
 * in. Take 3 of the demo video: a resumed answer said "The routing happened
 * before the pause and is not in this record" while its record held the
 * verdict — the fold read the event only. What the state does NOT carry is
 * said by the lines that need it: the decider's model (the `noModel` line) and
 * whether the verdict was decisive (absent from the fact).
 */

import { chip, n, v } from '../render.js';
import type {
  AccountFact,
  FactStatus,
  RecordPointer,
  RoutingFacts,
  Sentence,
  SentenceVar,
} from '../types.js';
import { isRecord, num, str, type RecordingView, type ViewEvent } from '../view.js';
import { FACT_TEXT_CHARS, PERMISSION_REFUSALS } from './calls.js';
import { heldChip } from './checked.js';
import {
  at,
  declarationAt,
  derived,
  skillVars,
  stateAt,
  takeItem,
  type ReadContext,
} from './common.js';

/** Refusals listed in `facts.routing.refusals`; refusal LINES (distinct rules) in the row. */
export const MAX_REFUSALS = 12;
export const MAX_REFUSAL_LINES = 3;

const LIBRARY_DECISIONS = new Set(['entry', 'intent', 'continuity', 'decider']);

export type CheckState = 'reachable' | 'unreachable' | 'not-applicable';

export interface UnderstoodRead {
  readonly routing: RoutingFacts;
  readonly lines: readonly Sentence[];
  readonly status: FactStatus;
  readonly check: CheckState;
  /** Set when the check is unreachable: the line that says why. */
  readonly unreachable?: Sentence;
  /** Set when the decided skill was proven not delivered. */
  readonly signal?: Sentence;
  /** Pointers behind a reachable check (for the "found nothing" line). */
  readonly checkPointers: readonly RecordPointer[];
  /**
   * On a resumed leg: `held` — the verdict was read from the state the run
   * paused with; `lost` — the graph routes, and neither an event nor that
   * state holds a verdict. Absent on a leg that was not resumed or that
   * routes nothing.
   */
  readonly beforePause?: 'held' | 'lost';
}

/** The routing verdict, as its one reader hands it to the row (see the file header). */
export interface RoutingVerdict {
  readonly by: string;
  readonly from?: string;
  readonly to?: string;
  readonly decisive?: boolean;
  readonly scorer?: string;
  /** The PERSON's words a tier-1 data rule matched. */
  readonly witness?: string;
  /** How many skills the menu offered — absent when no menu was offered. */
  readonly offered?: number;
  readonly deciderModel?: string;
  /** The scorer's ranked numbers, as recorded. */
  readonly scores: readonly Readonly<Record<string, unknown>>[];
  /** Where one verdict field lives on the record (`by`, `to`, `witness`, `deciderModel`). */
  readonly at: (field: 'by' | 'to' | 'witness' | 'deciderModel') => RecordPointer;
  /** Where one score field lives on the record. */
  readonly scoreAt: (index: number, field: 'id' | 'score') => RecordPointer;
  /** Read from the state the run paused with, not from an event of this leg. */
  readonly held: boolean;
}

/** The event's verdict, or `undefined` when its `by` cannot be read. */
function eventVerdict(routed: ViewEvent): RoutingVerdict | undefined {
  const p = routed.payload;
  const by = str(p.by);
  if (by === undefined) return undefined;
  const decider = isRecord(p.decider) ? str(p.decider.model) : undefined;
  const witness = isRecord(p.witness) ? str(p.witness.text) : undefined;
  return {
    by,
    ...(str(p.from) !== undefined && { from: str(p.from) }),
    ...(str(p.to) !== undefined && { to: str(p.to) }),
    ...(typeof p.decisive === 'boolean' && { decisive: p.decisive }),
    ...(str(p.scorer) !== undefined && { scorer: str(p.scorer) }),
    ...(witness !== undefined && { witness }),
    ...(Array.isArray(p.offered) && { offered: p.offered.length }),
    ...(decider !== undefined && { deciderModel: decider }),
    scores: Array.isArray(p.scores) ? p.scores.filter(isRecord) : [],
    at: (field) =>
      field === 'witness'
        ? at(routed, 'witness', 'text')
        : field === 'deciderModel'
        ? at(routed, 'decider', 'model')
        : at(routed, field),
    scoreAt: (i, field) => at(routed, 'scores', i, field),
    held: false,
  };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * The verdict RouteTurn committed BEFORE a pause (`turnRoute`, `entryScores`,
 * `entryScorer`): present in the state the run paused with and carried
 * unchanged into the committed state, where the pointers land. `undefined`
 * when either state lacks it or they disagree — never guessed.
 */
function heldVerdict(ctx: ReadContext): RoutingVerdict | undefined {
  const paused = ctx.view.pausedWith;
  const state = ctx.view.state;
  if (!ctx.resumedLeg || paused === undefined || state === undefined) return undefined;
  const route = state.turnRoute;
  if (!isRecord(route) || !sameValue(route, paused.turnRoute)) return undefined;
  const by = str(route.by);
  if (by === undefined) return undefined;
  const scoresHeld =
    Array.isArray(state.entryScores) && sameValue(state.entryScores, paused.entryScores);
  const scorer =
    scoresHeld && sameValue(state.entryScorer, paused.entryScorer)
      ? str(state.entryScorer)
      : undefined;
  const witness = isRecord(route.witness) ? str(route.witness.text) : undefined;
  return {
    by,
    ...(str(route.from) !== undefined && { from: str(route.from) }),
    ...(str(route.to) !== undefined && { to: str(route.to) }),
    ...(scorer !== undefined && { scorer }),
    ...(witness !== undefined && { witness }),
    ...(Array.isArray(route.offered) && { offered: route.offered.length }),
    scores: scoresHeld ? (state.entryScores as unknown[]).filter(isRecord) : [],
    at: (field) =>
      field === 'witness'
        ? stateAt('turnRoute', 'witness', 'text')
        : stateAt('turnRoute', field === 'deciderModel' ? 'by' : field),
    scoreAt: (i, field) => stateAt('entryScores', i, field),
    held: true,
  };
}

// FOLD · the one reader of the routing verdict for the account
// consumers read this and never re-derive it: readUnderstood (the row, check 1)
/**
 * The routing verdict this record holds: the `skill.turn_routed` event of
 * this leg, else — on a resumed leg — the verdict committed before the pause
 * ({@link heldVerdict}). `undefined` when neither holds one. An event whose
 * `by` cannot be read is passed over and counted, never read as "none".
 */
export function routingVerdictOf(ctx: ReadContext): RoutingVerdict | undefined {
  const routedRow = ctx.view.first('skill.turn_routed');
  if (routedRow !== undefined) {
    const verdict = eventVerdict(routedRow);
    if (verdict !== undefined) return verdict;
    ctx.noteUnread();
  }
  return heldVerdict(ctx);
}

interface Delivered {
  readonly ids: readonly string[];
  readonly firstRow: ReadonlyMap<string, ViewEvent>;
}

function deliveredSkills(view: RecordingView): Delivered {
  const firstRow = new Map<string, ViewEvent>();
  for (const e of view.ofType('context.injected')) {
    if (e.payload.slot !== 'system-prompt' || e.payload.source !== 'skill') continue;
    const id = str(e.payload.sourceId);
    if (id !== undefined && !firstRow.has(id)) firstRow.set(id, e);
  }
  return { ids: [...firstRow.keys()], firstRow };
}

/** Every system-prompt composition of iterations 1..N is recorded and complete. */
function deliveryComplete(view: RecordingView, lastIteration: number | undefined): boolean {
  if (lastIteration === undefined || lastIteration < 1) return false;
  const composed = view
    .ofType('context.slot_composed')
    .filter((e) => e.payload.slot === 'system-prompt');
  for (let i = 1; i <= lastIteration; i++) {
    const compose = composed.filter((e) => e.payload.iteration === i).pop();
    if (compose === undefined) return false;
    const breakdown = compose.payload.sourceBreakdown;
    if (!isRecord(breakdown)) return false;
    const skill = breakdown.skill;
    const expected = skill === undefined ? 0 : isRecord(skill) ? num(skill.count) : undefined;
    if (expected === undefined) return false;
    const rows = view
      .ofType('context.injected')
      .filter(
        (e) =>
          e.meta.runtimeStageId === compose.meta.runtimeStageId &&
          e.payload.slot === 'system-prompt' &&
          e.payload.source === 'skill' &&
          typeof e.payload.sourceId === 'string',
      ).length;
    if (rows !== expected) return false;
  }
  return true;
}

function refusalsOf(ctx: ReadContext, to: string | undefined) {
  const refusals: {
    requestedId: string;
    by: string;
    kind: 'rule';
    event: ViewEvent;
    named: boolean;
  }[] = [];
  for (const e of ctx.view.ofType('skill.rejected')) {
    const id = str(e.payload.requestedId);
    if (id !== undefined)
      refusals.push({ requestedId: id, by: 'skill-graph', kind: 'rule', event: e, named: false });
  }
  for (const e of ctx.view.ofType('permission.check')) {
    const target = str(e.payload.target);
    // Only `deny` / `halt` refuse; `gate_open` lets the read proceed.
    if (
      e.payload.capability !== 'skill_read' ||
      target === undefined ||
      !PERMISSION_REFUSALS.has(e.payload.result)
    )
      continue;
    const id = target.startsWith('skill:') ? target.slice('skill:'.length) : target;
    const rule = str(e.payload.policyRuleId);
    refusals.push({
      requestedId: id,
      by: rule ?? 'permission',
      kind: 'rule',
      event: e,
      named: rule !== undefined,
    });
  }
  return { all: refusals, ofDecided: refusals.filter((r) => r.requestedId === to) };
}

const notRecordedFact = <T>(missing: 'no-event' | 'not-built' = 'no-event'): AccountFact<T> => ({
  value: null,
  source: 'library',
  status: 'not-recorded',
  pointers: [],
  missing,
});

export function readUnderstood(ctx: ReadContext): UnderstoodRead {
  const { view, say } = ctx;
  const configuredEvent = view.first('agent.run_configured');
  // A verdict with no readable `by` is passed over (counted), never read as "none".
  const routed = routingVerdictOf(ctx);
  const delivered = deliveredSkills(view);
  const appDecides = ctx.declarations.routing?.appDecides === true;
  const graph = configuredEvent?.payload.skillGraph;

  const configured: RoutingFacts['configured'] =
    configuredEvent === undefined
      ? notRecordedFact()
      : isRecord(graph)
      ? {
          value: {
            ...(str(graph.routing) !== undefined && { routing: str(graph.routing) }),
            ...(str(graph.continuity) !== undefined && { continuity: str(graph.continuity) }),
            ...(str(graph.scorer) !== undefined && { scorer: str(graph.scorer) }),
          },
          source: 'library',
          status: 'recorded',
          pointers: [at(configuredEvent, 'skillGraph', 'routing')],
        }
      : {
          value: 'none',
          source: 'library',
          status: 'recorded',
          pointers: [derived(configuredEvent, '#meta/runId')],
        };

  const confidenceLine = (): Sentence =>
    say('understood.confidence.none', {
      status: 'not-recorded',
      missing: 'not-built',
      chips: [chip('not-recorded', 'chip.notRecorded')],
    });
  const appLines = (): Sentence[] =>
    appDecides
      ? [
          say('understood.app.notRecorded', {
            status: 'not-recorded',
            missing: 'not-built',
            pointers: [declarationAt(ctx.declarations, 'routing.appDecides')],
            chips: [chip('not-recorded', 'chip.notRecorded')],
          }),
        ]
      : [];
  const refusals = refusalsOf(ctx, routed?.to);
  const deliveredFact: AccountFact<readonly string[]> = {
    value: delivered.ids.slice(0, MAX_REFUSALS).map((id) => id.slice(0, FACT_TEXT_CHARS)),
    source: 'library',
    status: 'recorded',
    pointers: [...delivered.firstRow.values()].slice(0, MAX_REFUSALS).map((e) => at(e, 'sourceId')),
  };
  const base = {
    configured,
    confidence: notRecordedFact<number>('not-built'),
    appDecision: appDecides
      ? notRecordedFact<{ skillId: string }>('not-built')
      : { value: null, source: 'app' as const, status: 'not-applicable' as const, pointers: [] },
    delivered: deliveredFact,
    // Listed ≤ MAX_REFUSALS, ids cut at 200 — the model chooses both how many and how long.
    refusals: refusals.all.slice(0, MAX_REFUSALS).map(({ requestedId, by, kind }) => ({
      requestedId: requestedId.slice(0, FACT_TEXT_CHARS),
      by: by.slice(0, FACT_TEXT_CHARS),
      kind,
    })),
    ...(refusals.all.length > MAX_REFUSALS && {
      refusalsOmitted: refusals.all.length - MAX_REFUSALS,
    }),
  };

  // ── a resumed leg of a routed agent: the routing happened before the pause ──
  const notConfigured = configuredEvent !== undefined && !isRecord(graph);
  if (ctx.resumedLeg && routed === undefined && !notConfigured) {
    return {
      routing: { ...base, verdict: notRecordedFact(), scores: notRecordedFact() },
      lines: [
        say('understood.resumed', {
          status: 'not-recorded',
          missing: 'before-pause',
          chips: [chip('before-pause', 'chip.beforePause')],
        }),
        ...appLines(),
      ],
      status: 'not-recorded',
      check: 'unreachable',
      unreachable: say('unreachable.decided', { status: 'not-recorded', missing: 'before-pause' }),
      checkPointers: [],
      beforePause: 'lost',
    };
  }

  // ── no verdict on the record ──
  if (routed === undefined) {
    if (notConfigured && configuredEvent !== undefined) {
      return {
        routing: { ...base, verdict: notRecordedFact(), scores: notRecordedFact() },
        lines: [
          say('understood.notConfigured', {
            status: 'not-applicable',
            pointers: [derived(configuredEvent, '#meta/runId')],
          }),
          ...appLines(),
        ],
        status: 'not-applicable',
        check: 'not-applicable',
        checkPointers: [],
      };
    }
    return {
      routing: { ...base, verdict: notRecordedFact(), scores: notRecordedFact() },
      lines: [
        say('understood.notRecorded', {
          status: 'not-recorded',
          missing: 'no-event',
          chips: [chip('not-recorded', 'chip.notRecorded')],
        }),
        ...appLines(),
      ],
      status: 'not-recorded',
      check: 'unreachable',
      unreachable: say('unreachable.decided', { status: 'not-recorded', missing: 'no-event' }),
      checkPointers: [],
    };
  }

  // ── the verdict ──
  const by = routed.by;
  const to = routed.to;
  const toVars = (name: string): Record<string, SentenceVar> =>
    to === undefined ? {} : skillVars(ctx, name, to, routed.at('to'));
  const lines: Sentence[] = [];
  const byPointer = routed.at('by');
  // A verdict read from the state the run paused with says so on each of its lines.
  const held = routed.held ? { chips: [heldChip()] } : {};
  if (by === 'entry' && to !== undefined) {
    const witness = routed.witness;
    lines.push(
      witness !== undefined
        ? say('understood.rule.witness', {
            vars: {
              ...toVars('skill'),
              witness: v(witness, 'person', routed.at('witness')),
            },
            pointers: [byPointer],
            ...held,
          })
        : say('understood.rule', { vars: toVars('skill'), pointers: [byPointer], ...held }),
    );
  } else if (by === 'intent' && to !== undefined) {
    lines.push(say('understood.intent', { vars: toVars('skill'), pointers: [byPointer], ...held }));
  } else if (by === 'continuity' && to !== undefined) {
    lines.push(
      say('understood.continuity', { vars: toVars('skill'), pointers: [byPointer], ...held }),
    );
  } else if (by === 'decider' && to !== undefined) {
    const model = routed.deciderModel;
    lines.push(
      model !== undefined
        ? say('understood.decider', {
            vars: {
              ...toVars('skill'),
              model: v(model, 'library', routed.at('deciderModel')),
            },
            pointers: [byPointer],
            ...held,
          })
        : say('understood.decider.noModel', {
            vars: toVars('skill'),
            pointers: [byPointer],
            ...held,
          }),
    );
  } else if (by === 'menu') {
    const offered = routed.offered ?? 0;
    lines.push(
      offered > 0
        ? say('understood.menu', { vars: { offered: n(offered) }, pointers: [byPointer], ...held })
        : say('understood.menu.bare', { pointers: [byPointer], ...held }),
    );
    const opened = delivered.ids[0];
    if (opened !== undefined) {
      const row = delivered.firstRow.get(opened) as ViewEvent;
      lines.push(
        say('understood.menu.picked', {
          vars: skillVars(ctx, 'skill', opened, at(row, 'sourceId')),
        }),
      );
    }
  } else {
    lines.push(say('understood.none', { pointers: [byPointer], ...held }));
  }

  // ── the scores: the app's numbers, when the pick is their top ──
  const scores = routed.scores;
  const top = scores[0];
  const next = scores[1];
  let scoresFact: RoutingFacts['scores'] = notRecordedFact();
  if (
    top !== undefined &&
    next !== undefined &&
    top.id === to &&
    num(top.score) !== undefined &&
    num(next.score) !== undefined &&
    str(next.id) !== undefined
  ) {
    const allOthersEqual = scores.slice(1).every((s) => s.score === next.score);
    const topVar = v(num(top.score) as number, 'app', routed.scoreAt(0, 'score'));
    const nextVar = v(num(next.score) as number, 'app', routed.scoreAt(1, 'score'));
    scoresFact = {
      value: {
        top: topVar.value as number,
        next: nextVar.value as number,
        nextId: str(next.id) as string,
        allOthersEqual,
      },
      source: 'app',
      status: 'recorded',
      pointers: [routed.scoreAt(0, 'score'), routed.scoreAt(1, 'score')],
    };
    lines.push(
      allOthersEqual
        ? say('understood.scores.allOthers', { vars: { top: topVar, next: nextVar } })
        : say('understood.scores', {
            vars: {
              top: topVar,
              next: nextVar,
              ...skillVars(ctx, 'nextSkill', str(next.id) as string, routed.scoreAt(1, 'id')),
            },
          }),
    );
  }

  // ── check 1: was the decided skill given to the model? ──
  let check: CheckState = 'not-applicable';
  let unreachable: Sentence | undefined;
  let signal: Sentence | undefined;
  const checkPointers = [routed.at('to')];
  if (LIBRARY_DECISIONS.has(by) && to !== undefined) {
    // One line per distinct refusing rule, within the shared item budget; the rest counted.
    const distinct = [
      ...new Map(refusals.ofDecided.map((r) => [`${r.event.type}\u0000${r.by}`, r])).values(),
    ];
    let listed = 0;
    for (const r of distinct) {
      if (listed >= MAX_REFUSAL_LINES || !takeItem(ctx, Math.min(r.by.length, FACT_TEXT_CHARS))) {
        break;
      }
      listed += 1;
      lines.push(
        r.event.type.endsWith('skill.rejected')
          ? say('understood.rejected', {
              vars: toVars('skill'),
              pointers: [at(r.event, 'requestedId')],
            })
          : r.named
          ? say('understood.refused', {
              vars: {
                ...toVars('skill'),
                by: v(r.by, 'library', at(r.event, 'policyRuleId'), FACT_TEXT_CHARS),
              },
              pointers: [at(r.event, 'target')],
            })
          : say('understood.refused.unnamed', {
              vars: toVars('skill'),
              pointers: [at(r.event, 'target')],
            }),
      );
    }
    const unlisted = refusals.ofDecided.length - listed;
    if (unlisted > 0) {
      lines.push(
        say('understood.refused.more', {
          vars: { n: n(unlisted) },
          pointers: refusals.ofDecided
            .slice(listed, listed + 1)
            .map((r) =>
              at(r.event, r.event.type.endsWith('skill.rejected') ? 'requestedId' : 'target'),
            ),
        }),
      );
    }
    const row = delivered.firstRow.get(to);
    if (row !== undefined) {
      check = 'reachable';
      checkPointers.push(at(row, 'sourceId'));
      lines.push(
        say('understood.delivered', {
          pointers: [routed.at('to'), at(row, 'sourceId')],
          chips: [chip('decided-delivered', 'chip.decidedDelivered', 'ok')],
        }),
      );
    } else if (deliveryComplete(view, ctx.answeringIteration)) {
      check = 'reachable';
      const other = delivered.ids[0];
      const composes = view
        .ofType('context.slot_composed')
        .filter((e) => e.payload.slot === 'system-prompt')
        .map((e) => at(e, 'slot'));
      lines.push(
        other !== undefined
          ? say('understood.notDelivered.other', {
              vars: {
                ...toVars('skill'),
                ...skillVars(
                  ctx,
                  'other',
                  other,
                  at(delivered.firstRow.get(other) as ViewEvent, 'sourceId'),
                ),
              },
              pointers: composes,
              chips: [chip('decided-not-delivered', 'chip.decidedNotDelivered', 'bad')],
            })
          : say('understood.notDelivered', {
              vars: toVars('skill'),
              pointers: composes,
              chips: [chip('decided-not-delivered', 'chip.decidedNotDelivered', 'bad')],
            }),
      );
      signal = say('signal.decidedNotDelivered', { vars: toVars('skill'), pointers: composes });
    } else {
      check = 'unreachable';
      // A held verdict: what the model was given before the pause is that part's events.
      const missing = routed.held ? 'before-pause' : 'no-event';
      lines.push(
        say('understood.delivery.unknown', {
          status: 'not-recorded',
          missing,
          chips: [chip('not-recorded', 'chip.notRecorded')],
        }),
      );
      unreachable = say('unreachable.delivery', { status: 'not-recorded', missing });
    }
  }
  lines.push(confidenceLine(), ...appLines());

  const verdict: RoutingFacts['verdict'] = {
    value: {
      by,
      ...(routed.from !== undefined && { from: routed.from }),
      ...(to !== undefined && { to }),
      ...(routed.decisive !== undefined && { decisive: routed.decisive }),
      ...(routed.scorer !== undefined && { scorer: routed.scorer }),
    },
    source: 'library',
    status: 'recorded',
    pointers: [byPointer, ...(to !== undefined ? [routed.at('to')] : [])],
  };
  return {
    routing: { ...base, verdict, scores: scoresFact },
    lines,
    status: 'recorded',
    check,
    ...(unreachable !== undefined && { unreachable }),
    ...(signal !== undefined && { signal }),
    checkPointers,
    ...(routed.held && { beforePause: 'held' as const }),
  };
}
