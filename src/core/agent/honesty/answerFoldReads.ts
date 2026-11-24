/** A committed key the one fold (`assessment/assess.ts` · `assessAnswer`) reads. */
export type AnswerFoldKey =
  | 'history'
  | 'turnNumber'
  | 'iteration'
  | 'pausedToolCallId'
  | 'findingsLedger'
  | 'coverageDeclared'
  | 'enteredToolCalls'
  | 'enteredToolCallsComplete'
  | 'settledToolCalls'
  | 'libraryResultLimitsIncomplete'
  | 'libraryResultLimits'
  | 'settledToolCallsComplete'
  | 'sourceConsultation'
  | 'stoppedEarly'
  | 'llmLatestStopReason'
  | 'unsupportedValues'
  | 'answerValidation'
  | 'argumentAsk'
  | 'middlewareDecisions';

/**
 * THE READ LIST — which committed keys the answer layer's fold reads, from
 * the agent's arms: a key no arm of this agent can write is never read (a
 * tracked read of a key a run never writes is a phantom context source —
 * honesty law 9). Over-approximates on purpose: a key an arm CAN write is
 * read whether or not this run wrote it, so the in-run fold never misses a row
 * the read-after fold sees (the equality law).
 *
 * - always: `history`, `turnNumber`, `pausedToolCallId` (seed writes them),
 *   `findingsLedger` (the witness rows, and any rows a continued conversation
 *   restores — the restore is wired while a layer is armed) and
 *   `stoppedEarly` — the Route decider writes it on EVERY agent
 *   (`stages/route.ts` · `recordEarlyStop`): a limit cuts a turn short
 *   whenever the model asked for calls, whether or not this agent registered
 *   a tool that could answer them. The call stage can commit `llmLatestStopReason`
 *   when the provider reports a cutoff or served a native format. The stage
 *   skips that read when the key is absent;
 * - a tool surface: `coverageDeclared` (only a tool that ran declares
 *   coverage), bounded per-turn entry and settlement facts, and their completeness;
 * - a tool result cap, artifact store or window: bounded result-limit receipts
 *   and their completeness, including any receipts recovered for the same request;
 * - the evidence gate: `unsupportedValues`;
 * - `.answerValidation()`: `answerValidation`;
 * - the inputs layer: `argumentAsk`;
 * - tool middleware: `middlewareDecisions` holds argument rewrites and
 *   after-tool decisions on older records kept across a pause.
 *
 * Every key's writers were checked against this list: a writer that no arm
 * gates puts its key in the always group — decide by the writer, never by the
 * usual path to it.
 *
 * @example
 * ```ts
 * answerFoldReads({ tools: true, evidenceGate: false, answerValidation: false, inputs: false, toolMiddleware: false });
 * // Includes 'coverageDeclared', 'enteredToolCalls', 'enteredToolCallsComplete',
 * // 'settledToolCalls' and 'settledToolCallsComplete' for the tool surface.
 * ```
 */
export function answerFoldReads(arms: {
  readonly tools: boolean;
  readonly resultLimits?: boolean;
  readonly retrieval?: boolean;
  readonly evidenceGate: boolean;
  readonly answerValidation: boolean;
  readonly inputs: boolean;
  readonly toolMiddleware: boolean;
  readonly sourceNotConsulted?: boolean;
}): readonly AnswerFoldKey[] {
  return [
    'history',
    'turnNumber',
    ...(arms.retrieval ? (['iteration'] as const) : []),
    'pausedToolCallId',
    'findingsLedger',
    'stoppedEarly',
    'llmLatestStopReason',
    ...(arms.tools
      ? ([
          'coverageDeclared',
          'enteredToolCalls',
          'enteredToolCallsComplete',
          'settledToolCalls',
          'settledToolCallsComplete',
        ] as const)
      : []),
    ...(arms.tools && arms.resultLimits
      ? (['libraryResultLimits', 'libraryResultLimitsIncomplete'] as const)
      : []),
    ...(arms.sourceNotConsulted === true ? (['sourceConsultation'] as const) : []),
    ...(arms.evidenceGate ? (['unsupportedValues'] as const) : []),
    ...(arms.answerValidation ? (['answerValidation'] as const) : []),
    ...(arms.inputs ? (['argumentAsk'] as const) : []),
    ...(arms.toolMiddleware && (arms.tools || arms.inputs)
      ? (['middlewareDecisions'] as const)
      : []),
  ];
}
