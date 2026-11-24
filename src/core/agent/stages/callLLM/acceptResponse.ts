import type { CallLLMStageDeps } from './types.js';
import { groundedTextOf } from './groundedText.js';
import type { TypedScope } from 'footprintjs';
import { callOccurrenceField } from '../../../../lib/callOccurrence.js';
import { typedEmit } from '../../../../recorders/core/typedEmit.js';
import { recordWireFindings } from './recordWireFindings.js';
import { recordToolSelection } from './recordToolSelection.js';
import {
  declaredEnumValuesOf,
  unsupportedArgumentsOf,
} from '../../../../integrity/unsupported-argument/check.js';
import { readExternalGrounds } from './externalGrounds.js';
import { commitAcceptedResponse } from './commitResponse.js';
import { fileIntegrityFindings } from '../../integrityFindings.js';
import { emitCostTick } from '../../../cost.js';
import {
  carriesFindingsDecoration,
  splitFindings,
  withoutFindingsArgument,
} from '../../findings/reserved.js';
import { captureReplayPrefix } from '../../requestTurn/replayPrefix.js';
import { afterReplayResponse } from '../../requestTurn/state.js';
import { writeRequestReplay } from '../../requestTurn/native.js';
import type { AgentState } from '../../types.js';
import type { PreparedCall } from './prepareCall.js';
import type { ExecutedCall } from './executeCall.js';
import { recordResponseTokens } from './responseAccounting.js';

export async function acceptResponse(
  scope: TypedScope<AgentState>,
  deps: CallLLMStageDeps,
  prepared: PreparedCall,
  executed: ExecutedCall,
) {
  const {
    peel,
    iteration,
    recoveryPiece,
    committed,
    history,
    systemRecovery,
    systemPrompt,
    trustedSystemPrompt,
    tail,
    continuing,
    replayFrames,
    llmRequest,
    startMs,
    messages,
    selection,
    citations,
  } = prepared;
  const {
    response,
    answeredBy,
    localFallback,
    acceptedFindingsRequest,
    acceptedOffer,
    acceptedProjection,
    recall,
  } = executed;
  // Preserve the pending carrier if the provider fails, so crash recovery
  // retries the same instruction. The prior committed value proves delivery.
  if (recoveryPiece !== undefined) scope.evidenceRecoveryUsed = true;
  const durationMs = Date.now() - startMs;
  recordResponseTokens(scope, response);
  const acceptedToolCalls = commitAcceptedResponse(scope, deps, response, prepared.serving, {
    localFallback,
    answeredBy,
    findingsRequest: acceptedFindingsRequest,
    citationOffer: citations?.accepted(response),
    sourceOffer: acceptedOffer,
    iteration,
    recall: recall?.summary(localFallback ? 'local' : 'provider'),
  });
  // A response owns its replay evidence, never the previous response's.
  // The presence trap does not record a read on never-replay providers.
  if (response.replay !== undefined || 'llmLatestReplay' in scope) {
    scope.llmLatestReplay = response.replay === undefined ? undefined : [response.replay];
  }
  const nextReplay =
    !localFallback && acceptedProjection
      ? afterReplayResponse(
          response,
          continuing === undefined ? [] : replayFrames ?? [],
          (replay) =>
            captureReplayPrefix(replay, history, messages, tail, continuing?.frozenBefore ?? 0),
          deps.toolsOffAfterRevision === true,
        )
      : undefined;
  if (nextReplay !== undefined || replayFrames !== undefined) writeRequestReplay(scope, nextReplay);
  // v2.14 — hand provider-specific raw thinking data to the
  // NormalizeThinking sub-subflow (the next stage in sf-call-llm
  // when a ThinkingHandler is configured). Undefined when the
  // provider has no thinking content for this call (most calls).
  if (response.rawThinking !== undefined || 'rawThinking' in scope) {
    (scope as TypedScope<AgentState> & { rawThinking: unknown }).rawThinking = response.rawThinking;
  }

  typedEmit(scope, 'agentfootprint.stream.llm_end', {
    iteration,
    // Under the arm, the content as the stream showed it (9.114.2) — the
    // committed `llmLatestContent` below keeps what the model sent.
    content:
      deps.withholdDraftContent === true
        ? ''
        : peel !== undefined
        ? peel.withoutReservedMembers(response.content).text
        : response.content,
    ...(deps.withholdDraftContent === true && { contentWithheld: true as const }),
    toolCallCount: response.toolCalls.length,
    usage: response.usage,
    stopReason: response.stopReason,
    durationMs,
  });

  recordWireFindings(scope, llmRequest, response, answeredBy, iteration, deps);

  // THE CHOICE SEAM (9.63.0, unsupported-argument). The wire check above
  // asks what the library put in front of the model; this asks what the
  // model did with it. For every call to an ARMED tool (one whose author
  // declared `argumentsFrom`), each identifier-like string argument must
  // appear somewhere in the frame this very call was assembled from.
  //
  // THE CORPUS IS SPLIT, and the split is the whole check. The system
  // prompt, every user message and every tool result are things the RUN
  // served. The assistant turns are things the MODEL wrote — deliberately
  // not ground, because a value whose only source is the model's own
  // rendered prose has been re-derived from a rendering instead of read
  // from evidence. That is the recorded failure exactly: a truncated job
  // name mined out of a prior answer, passed as a machine name, answered
  // with an honest "nothing found", reported to a person as fact.
  //
  // `llmRequest` is the frame — the object handed to the adapter, after the
  // cache strategy's transform — so the check judges the choice against
  // what the model actually saw, never against scope history it did not.
  if (deps.toolGrounding !== undefined && deps.toolGrounding.size > 0) {
    const grounding = deps.toolGrounding;
    const armedCalls = acceptedToolCalls.filter((c) => grounding.has(c.name));
    if (armedCalls.length > 0) {
      const schemaOf = new Map(
        (llmRequest.tools ?? []).map((t) => [t.name, t.inputSchema] as const),
      );
      const frameMessages = llmRequest.messages;
      // THE EXTERNAL-GROUND DOOR (9.72.0). The app may vouch for values the
      // run never served — a human clicked a row, the app verified the
      // clicked cells against the artifact the panel renders — and those
      // entries join the grounded corpus for THIS response only, consulted
      // fresh each time because the selection moves between turns. The
      // library records what the app asserts; the source label rides every
      // excusal so a reader can audit the chain.
      const external = readExternalGrounds(deps.externalGrounds);
      const {
        findings: argumentFindings,
        externalGroundings,
        occurrences,
      } = unsupportedArgumentsOf(
        armedCalls.map((c) => ({
          toolName: c.name,
          toolCallId: c.id,
          ...callOccurrenceField(c.callOccurrenceKey),
          // Peel the model's `_findings` metadata before reading argument
          // leaves. Grounded registry tools reserve that key. With sources
          // alone, only ruled tools advertise it in their served schemas.
          args:
            deps.findings === true ||
            (deps.argumentSources === true && carriesFindingsDecoration(schemaOf.get(c.name)))
              ? splitFindings(c.args).args
              : c.args,
          argumentsFrom: grounding.get(c.name) ?? [],
          // The enum fence reads the schema WITHOUT the decoration: the
          // reserved words (`direct`, `fact`, `noise`, `user`, …) are the
          // model's vocabulary for a declaration, never an excuse for an
          // argument.
          declaredEnums: declaredEnumValuesOf(
            deps.findings === true || deps.argumentSources === true
              ? withoutFindingsArgument(schemaOf.get(c.name))
              : schemaOf.get(c.name),
          ),
        })),
        {
          grounded: [
            // The recovery piece quotes the model's words; only the trusted
            // system injections count as grounds when that piece is present.
            // Findings DATA is a request-only message after history.
            ...(systemRecovery === undefined
              ? llmRequest.systemPrompt === undefined
                ? []
                : [llmRequest.systemPrompt]
              : // A cache strategy can rewrite the request. If it rewrote
              // this mixed-trust system slot, its provenance is unknown;
              // never credit either the rejected draft or an unsent base.
              llmRequest.systemPrompt === systemPrompt
              ? [trustedSystemPrompt]
              : []),
            // Every tool result as the TOOL's own bytes — the inputs layer's note
            // after a filled call's result is the library's words (`groundedTextOf`).
            ...groundedTextOf(frameMessages, committed, continuing?.historyPositions),
          ],
          assistant: frameMessages.filter((m) => m.role === 'assistant').map((m) => m.content),
          ...(external.length > 0 && { external }),
        },
        iteration,
      );
      deps.integrityLedger?.current?.note(
        'unsupported-argument',
        'choice',
        argumentFindings.length > 0 ? 'checked-fail' : 'checked-pass',
        argumentFindings.length > 0 ? Date.now() : undefined,
      );
      fileIntegrityFindings(scope, argumentFindings, iteration, deps.integrityLedger, (finding) =>
        occurrences.get(finding),
      );
      // Each excusal is a per-attempt fact and rides the emit channel —
      // deliberately NOT deduplicated the way findings are: a repeated call
      // is a fresh choice, and each excusal names the assertion that stood
      // between that choice and a finding.
      for (const g of externalGroundings) {
        typedEmit(scope, 'agentfootprint.integrity.external_ground_used', {
          toolName: g.toolName,
          toolCallId: g.toolCallId,
          path: g.path,
          value: g.value,
          source: g.source,
          iteration,
        });
      }
    } else {
      // No armed tool was called this turn — a response with nothing this
      // check could be about. Stated, never silence.
      deps.integrityLedger?.current?.note('unsupported-argument', 'choice', 'not-applicable');
    }
    // THE WRITE SEAM'S other half (9.77.0). `empty-lookup` is judged where
    // the RESULT is — the tool-dispatch boundary — but a response that
    // asked for no armed tool can never produce an armed result, and that
    // is decidable here, at the one stage every iteration passes through.
    // Saying it out loud is what keeps an armed row from sitting untouched
    // through a run that simply never called a declaring tool: a
    // not-applicable row is an answer, and an untouched one reads as rot.
    if (deps.noticeEmptyLookups === true && armedCalls.length === 0) {
      deps.integrityLedger?.current?.note('empty-lookup', 'write', 'not-applicable');
    }
  }
  // Column checks arm independently of argumentsFrom. Results are judged at
  // write; here, a response with no currently declaring call states NA in
  // both rows. An opaque provider still owes this note when its set is empty.
  // A function observes declarations after this iteration's actual discovery.
  if (deps.columnDeclaringTools !== undefined) {
    const declaring =
      typeof deps.columnDeclaringTools === 'function'
        ? deps.columnDeclaringTools(response.toolCalls.map((call) => call.name))
        : deps.columnDeclaringTools;
    if (!response.toolCalls.some((c) => declaring.has(c.name))) {
      deps.integrityLedger?.current?.note('column-type-mismatch', 'write', 'not-applicable');
      deps.integrityLedger?.current?.note('missing-column', 'write', 'not-applicable');
    }
  }

  if (deps.toolChoice === true) {
    // `import()` — the optional-family law of docs-next's site budget (the
    // `toolCalls/evidence/judgeLanded.ts · judgeLanded` precedent): an unarmed agent never loads
    // the module; the slot loads the same one under the same gate.
    const { recordToolChoiceOutcome } = await import('../../toolChoice/record.js');
    recordToolChoiceOutcome(
      scope as unknown as Parameters<typeof recordToolChoiceOutcome>[0],
      response,
      iteration,
    );
  }

  // Attribute the successful response to its actual selected transport/model.
  emitCostTick(scope, deps.pricingTable, deps.costBudget, answeredBy, response.usage);
  const selected = localFallback ? undefined : selection?.accept(response);
  if (selected && deps.servedTools && deps.canRecordToolSelection?.())
    recordToolSelection(scope, selected, deps.servedTools);
}
