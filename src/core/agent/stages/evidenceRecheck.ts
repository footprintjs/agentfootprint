/**
 * evidenceRecheck — the branch that asks again when the answer states values
 * no tool result carried (9.35.0).
 *
 * Mounted as a branch of the Route decider, and only on an agent that opted
 * into `.namesAndNumbersFromEvidence({ posture: 'guard' | 'rails' })`. It
 * carries `{ loopTo }` to the same target the `tool-calls` branch loops to —
 * the SchemaRetry mechanism verbatim: a correction is not a special mode, it
 * is one more ordinary turn of the ReAct loop, with its own `iteration_start`
 * / `llm_start` / `llm_end` bracket and its own `cost.tick` against
 * `costBudget`. The model can spend that turn calling the tool that would
 * actually produce the value, because it is a real turn and the tools are
 * still on the wire.
 *
 * What it appends is the conversation as it really went: the answer that
 * stated the values as the assistant turn, then a `role: 'user'` message
 * naming them and saying what would satisfy the check. **At most once per
 * turn** (`evidenceRevisionSpent`) — a model that cannot ground a value on
 * its second try will not ground it on its fifth, and the retry storm that
 * would follow is the exact failure this library exists to remove.
 *
 * Pure function apart from its resolved config — no Agent class state.
 */

import type { TypedScope } from 'footprintjs';
import type { LLMMessage, LLMToolSchema } from '../../../adapters/types.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { buildEvidenceCorrection, MAX_REPORTED_VALUES } from '../evidence/gate.js';
import type { ResolvedEvidenceGate, UnsupportedValue } from '../evidence/types.js';
import { findStagedRefs } from '../stagedRefs.js';
import type { AgentState } from '../types.js';

/**
 * The staged-refs join's build-time half, threaded only when at least one
 * registered tool declares `wants` (the `toolGrounding` law: absent means the
 * stage reads no new scope key and the correction keeps its exact bytes).
 */
export interface EvidenceStagedRefsDeps {
  /** Harvested `Tool.wants` — tool name → the kinds it spends. */
  readonly toolWants: ReadonlyMap<string, readonly string[]>;
  /** The static tool-schema names, late-bound (the `toolSchemas` getter
   *  pattern) — the fallback before the tools slot has written
   *  `dynamicToolSchemas`. */
  readonly staticToolNames: () => readonly string[];
}

/**
 * Build the recheck stage. The decider already found the values and wrote the
 * carrier immediately before routing here — this stage does the work of asking.
 *
 * `stagedRefs` (optional): when this turn holds placed artifact tickets a
 * currently-served `wants` tool can spend, the correction names the refs and
 * the spender tool — the route to a grounded number, not just the demand for
 * one. The revision-asked event carries the same facts, additively.
 */
export function buildEvidenceRecheckStage(
  gate: ResolvedEvidenceGate,
  stagedRefs?: EvidenceStagedRefsDeps,
): (scope: TypedScope<AgentState>) => void {
  return (scope) => {
    const pending = scope.evidenceUnsupported;
    if (pending === undefined || pending.values.length === 0) {
      // Unreachable through the decider, which writes the carrier immediately
      // before routing here. Returning quietly rather than throwing keeps a
      // hand-built chart that mounts this branch without the decider from
      // taking down a run (the SchemaRetry discipline).
      return;
    }

    const iteration = scope.iteration as number;
    const values = [...pending.values] as UnsupportedValue[];
    const flaggedAnswer = scope.llmLatestContent as string;

    // The staged-refs join, computed against the tools the model can
    // CURRENTLY call (the slot's per-iteration surface when it has run, the
    // static catalog before it) — a spender the model cannot reach must not
    // be named as the way out.
    const match =
      stagedRefs === undefined
        ? undefined
        : findStagedRefs(
            (scope.history as readonly LLMMessage[] | undefined) ?? [],
            stagedRefs.toolWants,
            new Set(
              (
                (scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined)?.map(
                  (t) => t.name,
                ) ?? stagedRefs.staticToolNames()
              ).values(),
            ),
          );
    const [answerTurn, correctionTurn] = buildEvidenceCorrection(flaggedAnswer, values, match);

    // The conversation, as it really went. A plain local array — a TypedScope
    // array read is a live proxy view, and both the commit and the event
    // payload below must be detached plain data.
    const newHistory: LLMMessage[] = [
      ...(scope.history as readonly LLMMessage[]),
      answerTurn,
      correctionTurn,
    ];
    scope.history = newHistory;

    // The one-per-turn latch, spent BEFORE the loop turns: a second flagged
    // answer is recorded and (under `rails`) refused, never re-asked.
    scope.evidenceRevisionSpent = true;

    // The event fires HERE, where the work is — the `steps_unfinished
    // { action: 'nudged' }` precedent. The decider files every other outcome
    // itself, so exactly one `evidence_checked` exists per judgement.
    typedEmit(scope, 'agentfootprint.agent.evidence_checked', {
      iteration,
      posture: gate.posture,
      candidates: pending.candidates,
      unsupported: values.slice(0, MAX_REPORTED_VALUES),
      action: 'revision-asked',
      afterRevision: false,
      // What the correction TAUGHT, additively (absent when the join found
      // nothing): which staged refs and which spender tools it named.
      ...(match !== undefined && {
        stagedRefs: match.refs.map((r) => ({ ref: r.ref, kind: r.kind })),
        spenderTools: [...match.tools],
      }),
    });

    // Close this iteration's bracket before the loop turns — every recorder
    // that synthesizes steps pairs `iteration_start`/`iteration_end` per
    // `iterIndex`, and the crash-checkpoint tracker snapshots history from
    // this payload (the SchemaRetry stage's reasoning, verbatim).
    typedEmit(scope, 'agentfootprint.agent.iteration_end', {
      turnIndex: 0,
      iterIndex: iteration,
      toolCallCount: 0,
      history: newHistory,
    });

    // A revision consumes an iteration, exactly as a tool call does — one more
    // real turn against the agent's declared budget.
    scope.iteration = iteration + 1;
  };
}
