/**
 * Row "How sure" — what the record holds about how sure the answer is, side by
 * side, never joined into a verdict:
 *   - the whole-answer standing: NOT BUILT in v1, said so;
 *   - the model's pre-call expectation (`findings.declared`) — "how useful it
 *     expected the result to be", never a confidence — and, beside it, the
 *     call's outcome as its own fact (a declared absence can BE the direct,
 *     useful answer, so no "instead" joins the two);
 *   - the evidence check (the LAST `agent.evidence_checked` of the answering
 *     iteration). `lookedUp` splits looked-up values from exempt ones; a run
 *     recorded before it gets the unsplit line, which makes no count claim. The
 *     event slices `unsupported` at 12, so a full list says "at least".
 */

import { MAX_REPORTED_VALUES } from '../../../core/agent/evidence/gate.js';
import { chip, joinAnd, n, v } from '../render.js';
import type { EvidenceFact, Fact, Sentence } from '../types.js';
import { isRecord, num, str, type ViewEvent } from '../view.js';
import { at, emptinessSource, takeItem, type ReadContext } from './common.js';
import type { CallsRead } from './calls.js';
import { MAX_LISTED_CALLS } from './checked.js';

/** A flagged value is a name or a number from the answer; longer is clipped. */
export const FLAGGED_VALUE_CHARS = 200;

export interface HowSureRead {
  readonly lines: readonly Sentence[];
  readonly evidence: Fact<EvidenceFact>;
}

function evidenceEvent(ctx: ReadContext): ViewEvent | undefined {
  const rows = ctx.view.ofType('agent.evidence_checked');
  const ofAnswer =
    ctx.answeringIteration === undefined
      ? rows
      : rows.filter((e) => e.payload.iteration === ctx.answeringIteration);
  return (ofAnswer.length > 0 ? ofAnswer : rows)[
    (ofAnswer.length > 0 ? ofAnswer : rows).length - 1
  ];
}

function expectationLines(ctx: ReadContext, calls: CallsRead): Sentence[] {
  const lines: Sentence[] = [];
  for (const call of calls.calls.slice(0, MAX_LISTED_CALLS)) {
    const f = call.findings;
    const basis = str(f?.payload.basis);
    if (f === undefined || basis === undefined) continue;
    const tool = v(call.fact.toolName, 'library', call.toolPointer);
    const expect = str(f.payload.expect);
    lines.push(
      basis === 'direct'
        ? expect !== undefined
          ? ctx.say('howSure.expected.direct', {
              vars: { tool, expect: v(expect, 'model', at(f, 'expect')) },
              pointers: [at(f, 'basis')],
            })
          : ctx.say('howSure.expected.directNoRating', {
              vars: { tool },
              pointers: [at(f, 'basis')],
            })
        : ctx.say('howSure.expected.exploratory', { vars: { tool }, pointers: [at(f, 'basis')] }),
    );
    if (call.fact.outcome !== 'ran' || call.fact.withheldBy !== undefined || call.end === undefined)
      continue;
    if (call.emptiness.emptiness === 'declared-absent') {
      lines.push(
        ctx.say('howSure.outcome.nothing', {
          vars: { tool: v(call.fact.toolName, 'library', call.toolPointer) },
          pointers: [
            call.end.payload.status !== undefined
              ? at(call.end, 'status')
              : at(call.end, 'toolCallId'),
          ],
        }),
      );
    } else if (call.emptiness.emptiness === 'undeclared-empty') {
      lines.push(
        ctx.say('howSure.outcome.empty', {
          basis: [emptinessSource(call.emptiness)],
          pointers: [
            { kind: 'event', index: call.end.index, type: call.end.type, path: '#emptiness' },
          ],
        }),
      );
    }
  }
  return lines;
}

function evidenceLines(ctx: ReadContext, e: ViewEvent, fact: EvidenceFact): Sentence[] {
  const { say } = ctx;
  /** A pointer only to a leaf the row actually holds. */
  const leafAt = (key: string) => (e.payload[key] !== undefined ? [at(e, key)] : []);
  const lines: Sentence[] = [];
  const candidates = at(e, 'candidates'); // required to read the row at all
  if (fact.candidates === 0) {
    lines.push(say('howSure.evidence.empty', { pointers: [candidates] }));
  } else if (fact.unsupported.length > 0) {
    const values = fact.unsupported;
    const valuePointers = values.map((_, i) => at(e, 'unsupported', i, 'value'));
    if (fact.capped) {
      lines.push(
        say('howSure.evidence.flagged.atLeast', {
          vars: { n: n(values.length) },
          pointers: [...leafAt('action'), candidates],
        }),
      );
    } else if (values.length <= 3) {
      lines.push(
        say('howSure.evidence.flagged', {
          vars: {
            n: n(values.length),
            values: v(
              joinAnd(values.map((x) => `“${x.slice(0, FLAGGED_VALUE_CHARS)}”`)),
              'library',
            ),
          },
          pointers: [...leafAt('action'), ...valuePointers],
        }),
      );
    } else {
      lines.push(
        say('howSure.evidence.flagged.list', {
          vars: { n: n(values.length) },
          pointers: [...leafAt('action'), candidates],
        }),
      );
    }
    if (fact.capped || values.length > 3) {
      let listed = 0;
      values.forEach((value, i) => {
        if (!takeItem(ctx, Math.min(value.length, FLAGGED_VALUE_CHARS))) return;
        listed += 1;
        lines.push(
          say('howSure.evidence.value', {
            vars: {
              value: v(value, 'library', at(e, 'unsupported', i, 'value'), FLAGGED_VALUE_CHARS),
            },
            item: true,
          }),
        );
      });
      if (listed < values.length) {
        lines.push(
          say('items.more', {
            vars: { n: n(values.length - listed) },
            pointers: [at(e, 'candidates')],
            item: true,
          }),
        );
      }
    }
  } else if (fact.lookedUp !== undefined && fact.lookedUp > 0) {
    lines.push(
      say('howSure.evidence.lookedUp', {
        vars: { lookedUp: v(fact.lookedUp, 'library', at(e, 'lookedUp')) },
      }),
    );
  } else if (fact.lookedUp === 0) {
    lines.push(
      say('howSure.evidence.lookedUp.none', { pointers: [at(e, 'lookedUp'), candidates] }),
    );
  } else {
    lines.push(say('howSure.evidence.unsplit', { pointers: [candidates, ...leafAt('action')] }));
  }
  if (fact.afterRevision)
    lines.push(say('howSure.evidence.revised', { pointers: [at(e, 'afterRevision')] }));
  if (fact.truncated === true)
    lines.push(say('howSure.evidence.truncated', { pointers: [at(e, 'evidenceTruncated')] }));
  return lines;
}

export function readHowSure(ctx: ReadContext, calls: CallsRead): HowSureRead {
  const lines: Sentence[] = [
    ctx.say('howSure.standing.none', {
      status: 'not-recorded',
      missing: 'not-built',
      chips: [chip('not-recorded', 'chip.notRecorded')],
    }),
    ...expectationLines(ctx, calls),
  ];
  const e = evidenceEvent(ctx);
  const posture = str(e?.payload.posture);
  const candidates = num(e?.payload.candidates);
  const readable =
    e !== undefined &&
    posture !== undefined &&
    candidates !== undefined &&
    Array.isArray(e.payload.unsupported);
  if (e !== undefined && !readable) ctx.noteUnread();
  if (e !== undefined && readable && posture !== undefined && candidates !== undefined) {
    const unsupported = Array.isArray(e.payload.unsupported)
      ? e.payload.unsupported.flatMap((u) =>
          isRecord(u) && typeof u.value === 'string' ? [u.value] : [],
        )
      : [];
    const lookedUp = num(e.payload.lookedUp);
    const fact: EvidenceFact = {
      posture,
      candidates,
      ...(lookedUp !== undefined && { lookedUp }),
      unsupported,
      capped: unsupported.length >= MAX_REPORTED_VALUES,
      action: str(e.payload.action) ?? '',
      afterRevision: e.payload.afterRevision === true,
      ...(e.payload.evidenceTruncated === true && { truncated: true }),
    };
    lines.push(...evidenceLines(ctx, e, fact));
    // The fact carries each flagged value cut at FLAGGED_VALUE_CHARS (the lines carry the same, marked clipped).
    const stored: EvidenceFact = {
      ...fact,
      unsupported: unsupported.map((x) => x.slice(0, FLAGGED_VALUE_CHARS)),
    };
    return {
      lines,
      evidence: {
        value: stored,
        source: 'library',
        status: 'recorded',
        pointers: [at(e, 'posture'), at(e, 'candidates')],
      },
    };
  }
  const configured = ctx.view.first('agent.run_configured');
  if (configured !== undefined && configured.payload.evidenceGate === undefined) {
    lines.push(
      ctx.say('howSure.evidence.off', {
        status: 'not-applicable',
        pointers: [
          { kind: 'event', index: configured.index, type: configured.type, path: '#meta/runId' },
        ],
      }),
    );
    return {
      lines,
      evidence: { value: null, source: 'library', status: 'not-applicable', pointers: [] },
    };
  }
  lines.push(
    ctx.say('howSure.evidence.notRecorded', {
      status: 'not-recorded',
      missing: 'no-event',
      chips: [chip('not-recorded', 'chip.notRecorded')],
    }),
  );
  return {
    lines,
    evidence: {
      value: null,
      source: 'library',
      status: 'not-recorded',
      pointers: [],
      missing: 'no-event',
    },
  };
}
