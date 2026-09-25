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
 */

import { chip, n, v } from '../render.js';
import type {
  Fact,
  FactStatus,
  RecordPointer,
  RoutingFacts,
  Sentence,
  SentenceVar,
} from '../types.js';
import { isRecord, num, str, type RecordingView, type ViewEvent } from '../view.js';
import { at, declarationAt, derived, skillVars, type ReadContext } from './common.js';

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
    if (
      e.payload.capability !== 'skill_read' ||
      target === undefined ||
      e.payload.result === 'allow'
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

const notRecordedFact = <T>(missing: 'no-event' | 'not-built' = 'no-event'): Fact<T> => ({
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
  const routedRow = view.first('skill.turn_routed');
  const routed = str(routedRow?.payload.by) !== undefined ? routedRow : undefined;
  if (routedRow !== undefined && routed === undefined) ctx.noteUnread();
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
  const refusals = refusalsOf(ctx, str(routed?.payload.to));
  const deliveredFact: Fact<readonly string[]> = {
    value: delivered.ids,
    source: 'library',
    status: 'recorded',
    pointers: [...delivered.firstRow.values()].map((e) => at(e, 'sourceId')),
  };
  const base = {
    configured,
    confidence: notRecordedFact<number>('not-built'),
    appDecision: appDecides
      ? notRecordedFact<{ skillId: string }>('not-built')
      : { value: null, source: 'app' as const, status: 'not-applicable' as const, pointers: [] },
    delivered: deliveredFact,
    refusals: refusals.all.map(({ requestedId, by, kind }) => ({ requestedId, by, kind })),
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
  const by = str(routed.payload.by) ?? '';
  const to = str(routed.payload.to);
  const toVars = (name: string): Record<string, SentenceVar> =>
    to === undefined ? {} : skillVars(ctx, name, to, at(routed, 'to'));
  const lines: Sentence[] = [];
  const byPointer = at(routed, 'by');
  if (by === 'entry' && to !== undefined) {
    const witness = isRecord(routed.payload.witness) ? str(routed.payload.witness.text) : undefined;
    lines.push(
      witness !== undefined
        ? say('understood.rule.witness', {
            vars: {
              ...toVars('skill'),
              witness: v(witness, 'person', at(routed, 'witness', 'text')),
            },
            pointers: [byPointer],
          })
        : say('understood.rule', { vars: toVars('skill'), pointers: [byPointer] }),
    );
  } else if (by === 'intent' && to !== undefined) {
    lines.push(say('understood.intent', { vars: toVars('skill'), pointers: [byPointer] }));
  } else if (by === 'continuity' && to !== undefined) {
    lines.push(say('understood.continuity', { vars: toVars('skill'), pointers: [byPointer] }));
  } else if (by === 'decider' && to !== undefined) {
    const decider = routed.payload.decider;
    const model = isRecord(decider) ? str(decider.model) : undefined;
    lines.push(
      model !== undefined
        ? say('understood.decider', {
            vars: {
              ...toVars('skill'),
              model: v(model, 'library', at(routed, 'decider', 'model')),
            },
            pointers: [byPointer],
          })
        : say('understood.decider.noModel', { vars: toVars('skill'), pointers: [byPointer] }),
    );
  } else if (by === 'menu') {
    const offered = Array.isArray(routed.payload.offered) ? routed.payload.offered.length : 0;
    lines.push(
      offered > 0
        ? say('understood.menu', { vars: { offered: n(offered) }, pointers: [byPointer] })
        : say('understood.menu.bare', { pointers: [byPointer] }),
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
    lines.push(say('understood.none', { pointers: [byPointer] }));
  }

  // ── the scores: the app's numbers, when the pick is their top ──
  const scores = Array.isArray(routed.payload.scores) ? routed.payload.scores.filter(isRecord) : [];
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
    const topVar = v(num(top.score) as number, 'app', at(routed, 'scores', 0, 'score'));
    const nextVar = v(num(next.score) as number, 'app', at(routed, 'scores', 1, 'score'));
    scoresFact = {
      value: {
        top: topVar.value as number,
        next: nextVar.value as number,
        nextId: str(next.id) as string,
        allOthersEqual,
      },
      source: 'app',
      status: 'recorded',
      pointers: [at(routed, 'scores', 0, 'score'), at(routed, 'scores', 1, 'score')],
    };
    lines.push(
      allOthersEqual
        ? say('understood.scores.allOthers', { vars: { top: topVar, next: nextVar } })
        : say('understood.scores', {
            vars: {
              top: topVar,
              next: nextVar,
              ...skillVars(ctx, 'nextSkill', str(next.id) as string, at(routed, 'scores', 1, 'id')),
            },
          }),
    );
  }

  // ── check 1: was the decided skill given to the model? ──
  let check: CheckState = 'not-applicable';
  let unreachable: Sentence | undefined;
  let signal: Sentence | undefined;
  const checkPointers = [at(routed, 'to')];
  if (LIBRARY_DECISIONS.has(by) && to !== undefined) {
    for (const r of refusals.ofDecided) {
      lines.push(
        r.event.type.endsWith('skill.rejected')
          ? say('understood.rejected', {
              vars: toVars('skill'),
              pointers: [at(r.event, 'requestedId')],
            })
          : r.named
          ? say('understood.refused', {
              vars: { ...toVars('skill'), by: v(r.by, 'library', at(r.event, 'policyRuleId')) },
              pointers: [at(r.event, 'target')],
            })
          : say('understood.refused.unnamed', {
              vars: toVars('skill'),
              pointers: [at(r.event, 'target')],
            }),
      );
    }
    const row = delivered.firstRow.get(to);
    if (row !== undefined) {
      check = 'reachable';
      checkPointers.push(at(row, 'sourceId'));
      lines.push(
        say('understood.delivered', {
          pointers: [at(routed, 'to'), at(row, 'sourceId')],
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
      lines.push(
        say('understood.delivery.unknown', {
          status: 'not-recorded',
          missing: 'no-event',
          chips: [chip('not-recorded', 'chip.notRecorded')],
        }),
      );
      unreachable = say('unreachable.delivery', { status: 'not-recorded', missing: 'no-event' });
    }
  }
  lines.push(confidenceLine(), ...appLines());

  const verdict: RoutingFacts['verdict'] = {
    value: {
      by,
      ...(str(routed.payload.from) !== undefined && { from: str(routed.payload.from) }),
      ...(to !== undefined && { to }),
      ...(typeof routed.payload.decisive === 'boolean' && { decisive: routed.payload.decisive }),
      ...(str(routed.payload.scorer) !== undefined && { scorer: str(routed.payload.scorer) }),
    },
    source: 'library',
    status: 'recorded',
    pointers: [byPointer, ...(to !== undefined ? [at(routed, 'to')] : [])],
  };
  return {
    routing: { ...base, verdict, scores: scoresFact },
    lines,
    status: 'recorded',
    check,
    ...(unreachable !== undefined && { unreachable }),
    ...(signal !== undefined && { signal }),
    checkPointers,
  };
}
