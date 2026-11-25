import type { AgentfootprintEvent } from '../../events/registry.js';
import type { Scope } from '../translationScope.js';
import type { AgUiAddress, AgUiMetadata } from '../types.js';
import { LLM_ERROR_SENTENCES } from '../../lib/humanizeLLMError.js';
import { toWireJson } from '../../lib/wireJson.js';

/** Said by `RUN_ERROR` when the run's `error.fatal` is not one of the record's fixed sentences. */
export const AG_UI_RUN_FAILED = 'The run failed.';

/**
 * Said by `RUN_ERROR` (with `code: 'ERR_ANSWER_VALIDATION'`) when an enforcing
 * `.answerValidation()` withheld the answer: a refusal, not a crash.
 */
export const AG_UI_ANSWER_WITHHELD =
  "The answer was withheld: it did not pass the app's answer checks.";

/** Is `said` one of the record's fixed failure sentences — the only `error.fatal` words a `RUN_ERROR` repeats? */
export const isFixedFailure = (said: string): boolean =>
  (Object.values(LLM_ERROR_SENTENCES) as readonly string[]).includes(said);

/** Said by `SUBAGENT_ERROR` for a sub-agent whose turn ended without an answer. */
export const AG_UI_SUBAGENT_UNFINISHED = "The sub-agent's turn ended without an answer.";

/** Said by `SUBAGENT_ERROR` for a sub-agent still running when its run was cancelled. */
export const AG_UI_SUBAGENT_CANCELLED = 'The run was cancelled before this sub-agent finished.';

/** Does `prefix` lead `path`, segment by segment? */
export function leads(prefix: readonly string[], path: readonly string[]): boolean {
  if (prefix.length > path.length) return false;
  for (let i = 0; i < prefix.length; i++) if (prefix[i] !== path[i]) return false;
  return true;
}

export const sameMount = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && leads(a, b);

export const record = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};

export const text = (value: unknown): string | undefined =>
  typeof value === 'string' ? value : undefined;

/** A tool result as AG-UI text: a string as it is, anything else through the wire rule. */
export const resultText = (value: unknown): string =>
  typeof value === 'string' ? value : value === undefined ? '' : toWireJson(value);

/**
 * The question a pause put to a person, from whichever home its kind keeps it
 * in: a plain ask (`askHuman` / `pauseHere` / an input request) at the top, a
 * middleware's ask on `ask.question`, a check-in as the plain-words claim of
 * what the tool will do (`checkIn.evidence.willDo`).
 */
export function questionOf(payload: Readonly<Record<string, unknown>>): string | undefined {
  return (
    text(payload.question) ??
    text(record(payload.ask).question) ??
    text(record(record(payload.checkIn).evidence).willDo)
  );
}

/** A composition's step name: its kind, and where it is mounted when it is not the run itself. */
export function compositionStep(kind: unknown, path: readonly string[]): string {
  const name = typeof kind === 'string' && kind.length > 0 ? kind : 'Composition';
  return path.length === 0 ? name : `${name}:${path.join('/')}`;
}

/** The record's address of `event`, as AG-UI metadata. */
export const addressOf = (
  event: AgentfootprintEvent,
  extra?: Partial<AgUiAddress>,
): AgUiMetadata => ({
  agentfootprint: {
    runtimeStageId: event.meta.runtimeStageId,
    subflowPath: [...event.meta.subflowPath],
    ...extra,
  },
});

/** The fields every event of `scope` carries. */
export const owned = (scope: Scope, event?: AgentfootprintEvent) => ({
  ...(event !== undefined && { timestamp: event.meta.wallClockMs }),
  ...(scope.subagentRunId !== undefined && { subagentRunId: scope.subagentRunId }),
});
