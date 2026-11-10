import type { AgentfootprintEvent } from '../../../../events/registry.js';
import type { EvalScorePayload, IntegrityDispositionPayload } from '../../../../events/payloads.js';
import { filedNothing } from '../../../../integrity/disposition/ledger.js';
import { sha256Hex } from '../../../../lib/sha256.js';
import type { OtelObservabilityOptions, OtelSpanLike } from '../types.js';
import type { TurnState, TurnStore } from '../turns/state.js';
import { MAX_CLOSED_TURNS } from '../turns/state.js';
import { sessionOf } from '../turns/metadata.js';
import type { SpanWriter } from '../spans/writer.js';
import { bound } from '../attributes/bounds.js';
import {
  dispositionSpanAttrs,
  dispositionRowAttrs,
  evaluationAttrs,
  type Attrs,
} from '../attributes/projections.js';

interface LateOptions {
  readonly opts: OtelObservabilityOptions;
  readonly captureContent: boolean;
  readonly maxContentChars: number;
  readonly allCheckRows: boolean;
  readonly turns: Pick<TurnStore, 'rootOf' | 'heldRun' | 'forgottenRuns'>;
  readonly spans: Pick<SpanWriter, 'recordOnChildSpan' | 'recordSpanEvent' | 'startSpanUnder' | 'endSpan'>;
  readonly report: (error: Error, event?: AgentfootprintEvent) => void;
}

export function createLateEvents({ opts, captureContent, maxContentChars, allCheckRows, turns, spans, report }: LateOptions) {
  const { rootOf, heldRun, forgottenRuns } = turns;
  const { recordOnChildSpan, recordSpanEvent, startSpanUnder, endSpan } = spans;
  /**
   * The checker accounting, filed ONCE per run from the run door's `finally`
   * — after turn_end on a finished run, after error.fatal on a failed one,
   * with the turn still open on a paused one. When it is exported it gets
   * its own short span under the turn's root, so a reader finds it in one
   * place whichever exit the run took.
   *
   * By default only when a row is ACTIONABLE — a check filed findings, or a
   * registered check filed nothing while the run did work (the wiring rot
   * `integrity/disposition/ledger.ts` · `filedNothing` names) — and only those
   * rows ride as events. A healthy run exports nothing. `checkAccounting:
   * 'all'` exports every row on every run.
   */
  function handleDisposition(event: AgentfootprintEvent, runId: string): void {
    const root = rootOf(runId);
    if (root === undefined) return;
    const p = event.payload as Partial<IntegrityDispositionPayload>;
    const rows = Array.isArray(p.rows) ? p.rows : [];
    const n = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const actionable = (row: (typeof rows)[number]): boolean =>
      n(row.findings) > 0 ||
      (p.workExisted === true &&
        filedNothing({
          checked: n(row.checked),
          notApplicable: n(row.notApplicable),
          unreachable: n(row.unreachable),
        }));
    const shown = allCheckRows ? rows : rows.filter(actionable);
    if (!allCheckRows && shown.length === 0) return;
    recordOnChildSpan(
      root,
      'agentfootprint.integrity.disposition',
      dispositionSpanAttrs(p),
      shown.map((row) => ({
        name: 'agentfootprint.integrity.check',
        attrs: dispositionRowAttrs(row),
      })),
    );
  }

  /** A score about a whole run can name it: `target` 'run' / 'turn' with the
   *  run id as `targetRef` — the only join a score filed after the run has
   *  (`agent.emit` stamps `runId: 'consumer-scope'`). A tool-call or
   *  iteration ref names something else and never joins a run. */
  function runNamedBy(p: Partial<EvalScorePayload>): string | undefined {
    return (p.target === 'run' || p.target === 'turn') && typeof p.targetRef === 'string'
      ? p.targetRef
      : undefined;
  }
  /**
   * Where a verified score lands on a run whose turn is still OPEN: on the
   * span it names while that span is open — the tool call (`targetRef` = its
   * call id), the iteration (`targetRef` = its index) — else on a short span
   * of its own under the turn's root, never on a sibling operation it does
   * not name. A score about the run or the turn lands on the agent span.
   */
  function placeOnOpenTurn(
    t: TurnState,
    root: OtelSpanLike,
    p: Partial<EvalScorePayload>,
    attrs: Attrs,
  ): void {
    const ref = typeof p.targetRef === 'string' ? p.targetRef : undefined;
    let span: OtelSpanLike | undefined;
    if (p.target === 'toolCall') span = ref !== undefined ? t.toolSpans.get(ref) : undefined;
    else if (p.target === 'iteration')
      span = t.stack.find((entry) => entry.name === `iteration:${ref ?? ''}`)?.span;
    else span = root;
    if (span !== undefined) recordSpanEvent(span, 'gen_ai.evaluation.result', attrs);
    else
      recordOnChildSpan(root, 'agentfootprint.evaluation', undefined, [
        { name: 'gen_ai.evaluation.result', attrs },
      ]);
  }

  /** A score this adapter may not (or cannot) place under a run: its own
   *  root span, the ref it named as an attribute, and why it stands alone. */
  function recordUnparented(
    attrs: Attrs,
    reason: 'owner-unverified' | 'run-forgotten' | 'run-not-held',
  ): void {
    // `root`: a NEW trace, never a child of whatever span is active in the
    // caller's context (an unrelated request being served) — unparented means
    // unparented.
    const span = startSpanUnder(
      undefined,
      'agentfootprint.evaluation',
      { 'service.name': opts.serviceName, 'agentfootprint.eval.unparented': reason },
      true,
    );
    recordSpanEvent(span, 'gen_ai.evaluation.result', attrs);
    endSpan(span);
  }

  /**
   * `eval.score` → `gen_ai.evaluation.result` (the spec's evaluation event,
   * carried here as a SPAN event: this adapter speaks only the Tracer API).
   *
   * WHICH run: the one the score NAMES (`target` 'run' / 'turn', `targetRef`
   * = a run id) when this adapter holds it; else the run the score was
   * emitted from. A ref that names no run held here ('this-run', a label)
   * falls back to the emitting run.
   *
   * WHETHER it may be parented there: only when the library can place the
   * score in that run's session — it was emitted from inside that very run,
   * or its own `meta.sessionId` is that run's session. Run ids are minted in
   * sequence and anyone can write one, so a score that cannot show it
   * belongs (every `agent.emit` after the run: no session on its meta) is
   * exported on a span of its OWN, unparented, naming the ref — never under
   * someone else's trace. Placement while the turn is open follows
   * {@link placeOnOpenTurn}; after it closed, a short `agentfootprint.evaluation`
   * span under the root (a finished span takes no events).
   *
   * Never silently lost: a run sampling dropped takes its scores with it; a
   * run that left the closed-turn window is exported unparented AND reported
   * through `onError`; a score with no `metricId` (the spec's one Required
   * attribute) is reported. This path is best effort — the durable home for
   * scores filed after the run is a score record, not a trace span.
   */
  function handleEvalScore(event: AgentfootprintEvent, runId: string): void {
    const p = event.payload as Partial<EvalScorePayload>;
    if (typeof p.metricId !== 'string' || p.metricId === '') {
      report(
        new Error(
          'otelObservability: an agentfootprint.eval.score without a metricId was not exported — ' +
            'gen_ai.evaluation.name is the one attribute the spec requires.',
        ),
        event,
      );
      return;
    }
    const attrs = evaluationAttrs(p, captureContent, maxContentChars);
    const named = runNamedBy(p);
    const namedRun = named !== undefined ? heldRun(named) : undefined;
    // A ref naming a run this strategy FORGOT is still that run's score: it
    // never falls back to the run it was emitted from.
    const forgottenRef =
      namedRun === undefined && named !== undefined && forgottenRuns.has(named) ? named : undefined;
    const target = forgottenRef !== undefined ? undefined : namedRun ?? heldRun(runId);
    if (target === undefined) {
      const ref = forgottenRef ?? named ?? runId;
      const sampled = forgottenRuns.get(ref);
      if (sampled === false) return; // sampling dropped it; its scores go with it
      if (sampled === true) {
        recordUnparented(attrs, 'run-forgotten');
        report(
          new Error(
            `otelObservability: an evaluation score names run '${bound(ref)}', which closed more ` +
              `than ${String(MAX_CLOSED_TURNS)} turns ago on this strategy — exported on its own ` +
              `span, unparented.`,
          ),
          event,
        );
        return;
      }
      recordUnparented(attrs, 'run-not-held');
      return;
    }
    if (target.root === undefined) return; // sampling dropped it
    const scoreSession = sessionOf(event);
    const verified =
      target.runId === runId ||
      (scoreSession !== undefined &&
        target.sessionDigest !== undefined &&
        sha256Hex(scoreSession) === target.sessionDigest);
    if (!verified) {
      recordUnparented(attrs, 'owner-unverified');
      return;
    }
    if (target.live !== undefined) placeOnOpenTurn(target.live, target.root, p, attrs);
    else
      recordOnChildSpan(target.root, 'agentfootprint.evaluation', undefined, [
        { name: 'gen_ai.evaluation.result', attrs },
      ]);
  }

  return { handleDisposition, handleEvalScore };
}

export type LateEvents = ReturnType<typeof createLateEvents>;
