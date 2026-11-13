import { type AgentRunValues } from '../../runValues.js';
import { type RunnerInvocation } from '../../../runnerExecution.js';
import { type RunnerPauseOutcome } from '../../../pause.js';
import { buildEventMeta } from '../../../../bridge/eventMeta.js';
import type { AgentfootprintEventMap } from '../../../../events/registry.js';
import {
  applyOutputFallback,
  type ResolvedOutputFallback,
  type OutputFallbackEmit,
} from '../../../outputFallback.js';
import {
  applyOutputSchema,
  OutputSchemaError,
  type OutputSchemaParser,
} from '../../../../answer-validation/outputSchema.js';
import type { AgentOutput, AgentState } from '../../types.js';
import type { AgentContext } from '../contracts.js';

export function parseOutput<T = unknown>(
  this: Pick<AgentContext, 'configuration'>,
  raw: string,
): T {
  if (!this.configuration.outputSchemaParser) {
    throw new Error(
      `Agent.parseOutput: this agent has no outputSchema. Use ` +
        `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
    );
  }
  return applyOutputSchema(raw, this.configuration.outputSchemaParser as OutputSchemaParser<T>);
}

export async function parseOutputAsync<T = unknown>(
  this: Pick<AgentContext, 'configuration' | 'settleTypedFailure'>,
  raw: string,
): Promise<T> {
  if (!this.configuration.outputSchemaParser) {
    throw new Error(
      `Agent.parseOutputAsync: this agent has no outputSchema. Use ` +
        `Agent.create({...}).outputSchema(parser).build() to enable typed output.`,
    );
  }
  const parser = this.configuration.outputSchemaParser as OutputSchemaParser<T>;
  try {
    return applyOutputSchema(raw, parser);
  } catch (err) {
    return this.settleTypedFailure<T>(raw, err);
  }
}

/**
 * A typed answer that failed: rethrow, or — with `.outputFallback()` and an
 * `OutputSchemaError` — hand it to the 3-tier fallback. The one settle for
 * `parseOutputAsync`'s parse failure and `runTyped`'s native stop failure.
 */
export async function settleTypedFailure<T>(
  this: Pick<AgentContext, 'configuration' | 'native' | 'retriesSpent'>,
  raw: string,
  err: unknown,
  invocation?: RunnerInvocation<AgentRunValues>,
): Promise<T> {
  const parser = this.configuration.outputSchemaParser as OutputSchemaParser<T>;
  if (!this.configuration.outputFallbackCfg || !(err instanceof OutputSchemaError)) throw err;
  // Engage the 3-tier fallback. The dispatcher gives us the
  // typed-event entry; we synthesize a minimal event shape since
  // these events have no per-stage anchor.
  // Typed via `OutputFallbackEmit`, so the registry — not a grep — is what
  // decides these two names are real. The cast is now only the envelope
  // assembly (type + payload are already checked against the event map).
  const emit: OutputFallbackEmit = (eventType, payload): void => {
    try {
      this.native.dispatcher.dispatch({
        type: eventType,
        timestamp: Date.now(),
        payload,
        ...(invocation !== undefined && {
          meta: buildEventMeta({ runtimeStageId: '__typed_output__' }, invocation.context()),
        }),
      } as unknown as AgentfootprintEventMap[typeof eventType]);
    } catch {
      /* observability errors must not poison the fallback path */
    }
  };
  return applyOutputFallback(
    raw,
    parser,
    this.configuration.outputFallbackCfg as ResolvedOutputFallback<T>,
    emit,
    err,
    invocation === undefined ? undefined : this.retriesSpent(invocation),
  );
}

/**
 * Corrective re-asks the agent's LAST run paid for, read off its own ledger.
 *
 * `undefined` when there is no last run to read — `parseOutputAsync` accepts
 * any string, including one that never came from this agent, and reporting
 * `0` for "I do not know" would be an invented fact in an event payload.
 */
export function retriesSpent(invocation: RunnerInvocation<AgentRunValues>): number | undefined {
  const state = invocation.view.snapshot()?.sharedState as
    | Pick<AgentState, 'outputAttempts'>
    | undefined;
  if (state === undefined) return undefined;
  return Math.max(0, (state.outputAttempts?.length ?? 1) - 1);
}

/** What `runTyped` makes of the answer: inside the turn, so a wrapper's context reaches it. */
export async function typedOutcome<T>(
  this: Pick<AgentContext, 'configuration' | 'runner' | 'settleTypedFailure'>,
  invocation: RunnerInvocation<AgentRunValues>,
  out: AgentOutput | RunnerPauseOutcome,
): Promise<T> {
  if (typeof out !== 'string') {
    throw new Error(
      'Agent.runTyped: run paused — typed mode does not support pauses. ' +
        'Use agent.run() + agent.parseOutput(...) after resume.',
    );
  }
  // `strategy: 'native'`: an answer whose last attempt failed on a refusal
  // or truncation stop is refused here even when its text parses — the
  // format did not hold for it (outputEnforcement.ts · nativeStopFailure).
  // FIRST, before any delivery path. It takes the same path a parse failure
  // takes, `.outputFallback()` included.
  const stopped =
    this.configuration.outputEnforcement?.outputFormat !== undefined
      ? this.runner.outputContractUnmet()
      : undefined;
  if (stopped?.stopReason !== undefined) {
    return this.settleTypedFailure<T>(
      out,
      new OutputSchemaError(stopped.error, { rawOutput: out, stage: stopped.stage }),
      invocation,
    );
  }
  if (this.configuration.answerValidationConfig !== undefined) {
    // The validator judged the schema's JSON output. Do not run a transforming
    // or stateful parser again and hand back a value the validator never saw.
    if (this.runner.answerValidation()?.schemaAccepted !== true) {
      throw new OutputSchemaError('Answer validation could not establish a JSON schema result.', {
        rawOutput: out,
        stage: 'schema-validate',
      });
    }
    return applyOutputSchema(out, { parse: (value: unknown) => value as T });
  }
  try {
    return applyOutputSchema(out, this.configuration.outputSchemaParser as OutputSchemaParser<T>);
  } catch (error) {
    return this.settleTypedFailure<T>(out, error, invocation);
  }
}
