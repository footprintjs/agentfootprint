import type { TypedScope } from 'footprintjs';
import { trackLateRecordNote } from '../../../../provider-contract/lateRecordNote.js';
import type { LLMMessage, LLMToolSchema } from '../../../../provider-contract/types.js';
import { NATIVE_RECOVERY_FRAME_PREFIX } from '../../../../lib/saidByPerson.js';
import type { ToolsWithheld } from '../../composeRequest.js';
import { evidenceConclusionLine } from '../../evidence/recovery.js';
import { FINDINGS_LAYOUT, findingsContext, findingsContextBytes } from '../../findings/context.js';
import type { FindingsLedger } from '../../findings/types.js';
import type { RequestOnlyMessage } from '../../requestTurn/replayPrefix.js';
import type { AgentState } from '../../types.js';
import { stagedRefsNudgeFor } from '../stagedRefsNudge.js';
import type { CallLLMStageDeps } from './types.js';

interface RequestOnlyContext {
  readonly iteration: number;
  readonly committed: readonly LLMMessage[];
  readonly messages: readonly LLMMessage[];
  readonly ledger: FindingsLedger | undefined;
  readonly registeredToolSchemas: readonly LLMToolSchema[];
  readonly withheld: ToolsWithheld | null;
  readonly continuing: boolean;
}

const INTERNAL_RETRY = `${NATIVE_RECOVERY_FRAME_PREFIX} This is framework guidance, not a message from the person or evidence.]`;

/** A pending turn cannot absorb a temporary change to its signed system prompt. */
export function recoveryFeedback(instruction: string): RequestOnlyMessage {
  return {
    reason: 'native-turn-recovery',
    message: {
      role: 'user',
      content: `${INTERNAL_RETRY}\n${instruction.replace(
        'this is a system instruction, not a new user message',
        'this feedback is not a new user message',
      )}`,
    },
  };
}

export function isRecoveryFeedback(message: LLMMessage): boolean {
  return message.role === 'user' && message.content.startsWith(INTERNAL_RETRY);
}

/** Lines composed for THIS request and written to no history — each with
 * the mechanism that composed it, so the receipt can say a line existed
 * without saying what it said. */
export function requestOnlyMessages(
  scope: TypedScope<AgentState>,
  deps: CallLLMStageDeps,
  {
    iteration,
    committed,
    messages,
    ledger,
    registeredToolSchemas,
    withheld,
    continuing,
  }: RequestOnlyContext,
) {
  const requestOnly: RequestOnlyMessage[] = [];
  // THE STAGED-REFS NUDGE (`nudge: true` on the evidence gate). Judged on
  // `registeredToolSchemas` — the tools REALLY served this call, so the
  // wrap-up's withheld surface arms nothing and a synthetic schema tool is
  // never named a spender. The line is request-only: `scope.history` is
  // untouched, so it never enters the exempt corpus and never persists —
  // recomposed each iteration, present exactly while both conditions hold.
  const nudge =
    deps.toolWants === undefined
      ? undefined
      : stagedRefsNudgeFor(scope, messages, deps.toolWants, registeredToolSchemas, iteration);
  if (nudge !== undefined) {
    requestOnly.push({ message: nudge, reason: 'staged-refs-nudge' });
  }
  // THE TIME LINE (step T6b, `.time({ reader })` only) — the library's conclusion about the
  // person's time words, LAST, at the decision point: a settled window with its source and each
  // tool's values, or a quote not confirmed yet and the one move that asks the person. Composed
  // by the tools slot from the tools it served (`agent/arguments/serve/windows.ts` · `timeWindowsLine`)
  // and served only on the iteration that composed it — a slot that did not re-run (classic
  // mode) leaves an older line, which is never served. Request-only like the nudge above; not
  // on the wrap-up call, whose tools are withheld. `servedView` rebuilds it from the same key.
  const timeLine = deps.timeLine === true ? scope.timeLine : undefined;
  if (
    timeLine !== undefined &&
    timeLine.iteration === iteration &&
    timeLine.text.length > 0 &&
    // `wrapUpAsked` is read here as it always was (an unarmed agent's reads
    // are unchanged); `withheld` adds the revision's rule.
    scope.wrapUpAsked !== true &&
    withheld === null
  ) {
    const line: LLMMessage = { role: 'user', content: timeLine.text };
    requestOnly.push({ message: line, reason: 'time-window-line' });
  }
  // THE EVIDENCE CONCLUSION (the figures dial) — the library's finding about
  // the numbers it flagged, LAST, on the one call that serves the revision
  // instruction (`evidence/figures.ts` · `figuresConclusionLine`). Absent
  // whenever the dial is off or no flagged value was a number.
  const conclusion =
    deps.hasEvidenceRecovery === true
      ? evidenceConclusionLine(scope.evidenceRecovery, scope.evidenceRecoveryUsed, iteration)
      : undefined;
  if (conclusion !== undefined) {
    const line: LLMMessage = { role: 'user', content: conclusion };
    requestOnly.push({ message: line, reason: 'evidence-conclusion' });
  }

  if (deps.hasFindingsLedger === true) {
    // A resumed leg can have a different host configuration from its checkpoint.
    // Record the layout actually used by THIS call; replay reads its commit.
    scope.findingsLayout = FINDINGS_LAYOUT;
    scope.findingsContextBytes = findingsContextBytes(deps.findingsContextBytes);
    const line: LLMMessage = {
      role: 'user',
      content: findingsContext(committed, ledger, deps.findingsContextBytes),
    };
    requestOnly.push({ message: line, reason: 'findings-data' });
  }
  // The ordinary tail keeps its replay slots. The native leaf alone may append the note.
  const lateNote =
    deps.takeLateRecordNote === undefined
      ? undefined
      : trackLateRecordNote(deps.takeLateRecordNote(iteration), continuing);
  return { messages: requestOnly, lateNote };
}
