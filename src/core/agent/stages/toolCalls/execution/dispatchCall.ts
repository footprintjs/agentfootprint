import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { prepareCallState } from '../access/callState.js';
import { checkToolPermission } from '../access/toolPermission.js';
import { buildCapabilityQuestion } from '../access/capabilityQuestion.js';
import { checkerGoverns } from '../../../../../provider-contract/types.js';
import { prepareArgumentGate } from '../access/argumentGate.js';
import { admitMiddlewareCall } from '../access/middlewareAdmission.js';
import { changedArgKeys, shownArgsOf } from '../../../../toolShownArgs.js';
import { atMountedCursor } from '../helpers/mountedCursor.js';
import { skillTarget } from '../../../../../security/skillTarget.js';
import { admitCheckInCall } from '../access/checkInAdmission.js';
import type { CallArtifactInputs, CallCredentialInput } from '../contracts/invocationInputs.js';
import { admitWantedArguments } from './wantedArguments.js';
import { admitToolCredential } from './credentialAdmission.js';
import { invokeInitialTool } from './initialInvocation.js';
import type { CallSkillRoute, CallDelivery } from '../contracts/callCells.js';
import { applyReadSkillRoute } from '../routing/readSkillRoute.js';
import { PRESENT_TOOL_NAME } from '../../../../../artifacts/present.js';
import { recordCallSettlement } from '../observation/callSettlement.js';
import { safeStringify } from '../../../validators.js';
import { landCallResult } from './deliveredResult.js';
import { judgeLanded } from '../evidence/judgeLanded.js';
import { activateLandedSkill } from '../routing/skillActivation.js';
import { haltLandedCall } from '../routing/policyHalt.js';
import type { ToolCallOperations } from '../compose.js';
import type { DispatchCallRunner } from '../contracts/dispatchCall.js';

/** Execute one original serial-loop call using the native handler's scope and exact batch references. */
export function buildCallDispatch(
  deps: ToolCallsHandlerDeps,
  operations: ToolCallOperations,
): DispatchCallRunner {
  const dispatchCall: DispatchCallRunner = async (scope, tc, callIndex, batch) => {
    const {
      emitSecurity,
      resolved,
      tool,
      args,
      proposedProgram,
      viewOf,
      historyForCallbacks,
      startMs,
      findingsRefusal,
      invalidateViews,
    } = operations.beginDispatchCall(
      scope,
      tc,
      batch.iteration,
      batch.towers,
      callIndex,
      batch.toolCalls,
      batch.findingsRefusals,
      batch.frozenTurn,
      batch.callbackHistory,
      batch.frozenArgsAt,
    );
    const { outcome, resolution, runArgs, callArguments, execution } = prepareCallState(
      tc,
      findingsRefusal,
      batch.resolutions,
      batch.inputs,
      args,
    );
    if (!execution.denied && operations.permissionChecker) {
      await checkToolPermission({
        historyForCallbacks,
        iteration: batch.iteration,
        permissionChecker: operations.permissionChecker,
        tc,
        viewOf,
        runArgs,
        runIdentity: batch.runIdentity,
        env: batch.env,
        emitSecurity,
        execution,
        outcome,
      });
    }
    const askCapability = buildCapabilityQuestion({
      permissionChecker: operations.permissionChecker,
      viewOf,
      historyForCallbacks,
      iteration: batch.iteration,
      runIdentity: batch.runIdentity,
      env: batch.env,
      emitSecurity,
      tc,
      callArguments,
      execution,
      outcome,
    });
    // ── Declared tool capabilities (9.11.0) ──────────────────────────
    // Beside the tool_call gate, at the same layer and before any
    // middleware, so an existing checker still decides first. Asked once
    // per capability the TOOL declared and the CHECKER governs — either
    // side silent and this loop does not run at all, which is why an agent
    // that has not opted in is byte-identical.
    if (!execution.denied && operations.permissionChecker && tool?.capabilities) {
      for (const capability of tool.capabilities) {
        if (execution.denied) break;
        if (!checkerGoverns(operations.permissionChecker, capability)) continue;
        await askCapability(
          capability,
          tc.name,
          `Tool '${tc.name}' is not available in this context.`,
        );
      }
    }
    const { argumentGate, consentGate, unmounted } = prepareArgumentGate(
      scope,
      { tc, tool, iteration: batch.iteration, execution, outcome },
      {
        unmountedRules: operations.unmountedRules,
        warnUnmountedToolPeriod: operations.warnUnmountedToolPeriod,
      },
    );
    const rulesRefusal = argumentGate.argsRejected
      ? undefined
      : resolution?.refused ?? (unmounted === undefined ? undefined : await unmounted);
    if (!execution.denied && rulesRefusal !== undefined) {
      argumentGate.argsRejected = true;
      outcome.error = true;
      outcome.result = rulesRefusal;
    }
    // ── The middleware chain ─────────────────────────────────────────
    // Walked only for a call the permission gate let through, so an
    // existing checker keeps deciding first and a denial there costs
    // nothing. A denial from the chain lands as the tool result, exactly
    // like every other refusal in this loop — the model reads it and
    // adapts. An `ask` commits partial state and pauses, on the same wire
    // the check-in gate uses. Never walked for a call whose arguments the
    // inputs layer refused (above).
    if (
      !execution.denied &&
      !argumentGate.argsRejected &&
      deps.toolMiddleware &&
      deps.toolMiddleware.length > 0
    ) {
      const pause = await admitMiddlewareCall(scope, deps, {
        tc,
        tool,
        iteration: batch.iteration,
        callArguments,
        historyForCallbacks,
        runIdentity: batch.runIdentity,
        env: batch.env,
        oneQuestionAsked: batch.oneQuestionAsked,
        resolved,
        decisionLedger: operations.decisionLedger,
        inputs: batch.inputs,
        invalidateViews,
        execution,
        outcome,
        askedLayer: batch.askedLayer,
        resolution,
        assertComponentDeliverable: operations.assertComponentDeliverable,
        newHistory: batch.newHistory,
        startMs,
        fileScript: operations.fileScript,
        proposedProgram,
        programOfCall: operations.programOfCall,
      });
      if (pause !== undefined) return { kind: 'paused', pause };
    }
    // The keys the tool will run with a different value for than the
    // model proposed — a link's rewrite, or a key the tool's own
    // redaction hides (`../../../../toolShownArgs.ts` · `changedArgKeys`).
    // Taken HERE, before anything executes: names only, so nothing the
    // tool later writes into its arguments can ride `tool_end`.
    const judgedOn = callArguments.chainedArgs;
    let changedKeys = changedArgKeys(args, shownArgsOf(tool, judgedOn));
    // Tool-args validation (#9) — AFTER the permission gate (policy must
    // see every attempted call, valid or not) and BEFORE credential
    // resolution (never acquire credentials for a call that won't run).
    // On 'enforce' mismatch the tool is NOT executed; the model gets a
    // structured retry message as the tool result and corrects its args
    // on the next ReAct iteration. Unknown tools keep the existing
    // "Unknown tool" path below — validation only applies to resolved
    // tools (their inputSchema is the contract the LLM was shown).
    // (`argsRejected` is declared above the middleware chain: the inputs
    // layer's refusals land in the same shape, before the chain.)
    if (!execution.denied && !argumentGate.argsRejected && tool) {
      const invalidArgs = operations.argumentRefusal(scope, tool, callArguments.callArgs, {
        toolName: tc.name,
        toolCallId: tc.id,
        iteration: batch.iteration,
      });
      if (invalidArgs !== undefined) {
        argumentGate.argsRejected = true;
        outcome.error = true;
        outcome.result = invalidArgs;
      }
    }
    // ── Skill-activation gate (9.11.0) ───────────────────────────────
    // `read_skill` activating a skill the policy hides for this role. The
    // menu the model reads was already filtered (the Tools slot asks the
    // same checker the same question), so this is the second half of one
    // rule rather than a second rule: a model that guessed a hidden id, or
    // remembered one from an earlier turn, reads the policy's own message.
    //
    // Ordered AFTER arg validation so the id judged is the one that will
    // actually run — a middleware may have rewritten it — and BEFORE
    // check-in, credentials and execute, so a refused skill's body is
    // never even computed (`surfaceMode: 'tool-only'` returns it from
    // `execute`). Off entirely unless the checker declares it governs
    // `'skill_read'`.
    if (
      !execution.denied &&
      !argumentGate.argsRejected &&
      tc.name === 'read_skill' &&
      checkerGoverns(operations.permissionChecker, 'skill_read')
    ) {
      const requestedSkillId = (callArguments.callArgs as { id?: unknown }).id;
      if (typeof requestedSkillId === 'string' && requestedSkillId.length > 0) {
        // ── A SELF-CALL AT A MOUNTED CURSOR EXERCISES NO CAPABILITY ───
        // (9.86.0.) A MOUNTED cursor's own skill is already served: its
        // body is in that call's system prompt and its tools are on that
        // call's wire. Asking to read it activates nothing, moves nothing,
        // and reveals nothing the request did not already carry — so there
        // is no capability here for a policy to grant or deny, and denying
        // it told the model its current skill was "not available in this
        // context" while it was standing in it. That is the exact sentence
        // the self-call arm exists to stop the model reading. The gate's
        // self-call arm answers instead.
        //
        // A PARKED cursor is the one case where the same id is not a
        // no-op, and the skip is scoped to exclude it (9.86.0 fix pass):
        // parking suppressed the map's contribution, so the dispatch gate
        // 480 lines below reads that call as a RE-ENGAGEMENT and serves the
        // body and tools again on the next pass. That moves something, so
        // the policy keeps the question. `atMountedCursor` is where that
        // rule lives; the dispatch gate writes the same rule as two ordered
        // arms over the same `parkedNow` set. Every OTHER id still goes
        // through the policy, unchanged — this narrows nothing a role could
        // see.
        const stay = atMountedCursor({
          ...(typeof scope.currentSkillId === 'string' && {
            cursor: scope.currentSkillId,
          }),
          target: requestedSkillId,
          parked: operations.parkedNow(scope),
        });
        if (!stay) {
          await askCapability(
            'skill_read',
            skillTarget(requestedSkillId),
            `Skill '${requestedSkillId}' is not available in this context.`,
          );
        }
      }
    }
    // ── Check-in gate (evidence-carrying human consent) ──────────────
    // Ordered AFTER the permission gate + arg-validation (a call the policy
    // denied or that has invalid args never asks a human) and BEFORE
    // credential resolution + execute (never acquire credentials for a call
    // awaiting consent — that's the whole point of "consent WITH the
    // receipts"). Fires ONLY when the tool declared `checkIn` and it trips,
    // so tools without the field are byte-identical (no gate, no events, no
    // pause). Rides the EXISTING pause machinery: returning a defined value
    // triggers the footprintjs checkpoint, exactly like `pauseHere`.
    if (
      !execution.denied &&
      !argumentGate.argsRejected &&
      tool &&
      tool.checkIn !== undefined &&
      deps.checkIn
    ) {
      const pause = await admitCheckInCall(scope, deps, {
        historyForCheckIn: operations.historyForCheckIn,
        historyForCallbacks,
        tool,
        viewOf,
        callArguments,
        iteration: batch.iteration,
        tc,
        askedLayer: batch.askedLayer,
        resolved,
        decisionLedger: operations.decisionLedger,
        consentGate,
        outcome,
        resolution,
        assertComponentDeliverable: operations.assertComponentDeliverable,
        env: batch.env,
        newHistory: batch.newHistory,
        startMs,
        fileScript: operations.fileScript,
        proposedProgram,
        programOfCall: operations.programOfCall,
      });
      if (pause !== undefined) return { kind: 'paused', pause };
    }
    if (!execution.denied && !argumentGate.argsRejected && !consentGate.checkInRefused) {
      const wanted: CallArtifactInputs = {
        // ── Declared artifact arguments (9.22.0) ──────────────────────
        // The `needs` precedent applied to data: resolve the tool's
        // declared `wants` refs BEFORE credential resolution (never
        // acquire credentials for a call that won't run) and BEFORE
        // execute — a stale/unknown/wrong-kind ref never reaches the
        // tool; the model reads a teaching refusal listing the live refs
        // of the wanted kind. On success `callArgs` carries the RESOLVED
        // DATA and `ctx.wanted` the claim tickets. Tools without `wants`
        // take the exact path they always took.
        wantedMeta: undefined,
        wantsBlocked: false,
      };
      if (tool?.wants !== undefined) {
        await admitWantedArguments(scope, {
          resolveWantsAtDispatch: operations.resolveWantsAtDispatch,
          tc,
          tool,
          callArguments,
          wanted,
          outcome,
        });
      }
      const authorization: CallCredentialInput = {
        // Declare-and-push: resolve the tool's declared credential BEFORE
        // invoking, and inject it as ctx.credential. On consent-required or
        // failure, surface the reason to the LLM (tool result) + emit; the
        // tool does NOT run (fail-closed — never half-authed; a denial that
        // throws is surfaced, not retried).
        resolvedCredential: undefined,
        credentialBlocked: false,
      };
      const need = wanted.wantsBlocked ? undefined : tool?.needs;
      if (need) {
        const pause = await admitToolCredential(scope, deps, {
          emitSecurity,
          need,
          credentialsIn: operations.credentialsIn,
          runIdentity: batch.runIdentity,
          authorization,
          onAuthorizationRequired: operations.onAuthorizationRequired,
          oneQuestionAsked: batch.oneQuestionAsked,
          newHistory: batch.newHistory,
          tc,
          startMs,
          callArguments,
          resolved,
          fileScript: operations.fileScript,
          tool,
          iteration: batch.iteration,
          proposedProgram,
          programOfCall: operations.programOfCall,
          outcome,
          askedLayer: batch.askedLayer,
          resolution,
        });
        if (pause !== undefined) return { kind: 'paused', pause };
      }
      if (!authorization.credentialBlocked && !wanted.wantsBlocked) {
        const pause = await invokeInitialTool(scope, deps, {
          tool,
          resolved,
          tc,
          dispatchRoster: operations.dispatchRoster,
          noteOffWire: operations.noteOffWire,
          iteration: batch.iteration,
          callArguments,
          env: batch.env,
          credentialsIn: operations.credentialsIn,
          emitSecurity,
          hasCredentials: operations.hasCredentials,
          authorization,
          toolArtifacts: operations.toolArtifacts,
          wanted,
          toolProgress: operations.toolProgress,
          sessionContext: operations.sessionContext,
          toolDispatchCtx: operations.toolDispatchCtx,
          searchFunnel: operations.searchFunnel,
          execution,
          runFactsOf: operations.runFactsOf,
          programOfCall: operations.programOfCall,
          outcome,
          takeCodeRun: operations.takeCodeRun,
          warnEffect: operations.warnEffect,
          declareCoverage: operations.declareCoverage,
          declareSemantics: operations.declareSemantics,
          refuseOverCeiling: operations.refuseOverCeiling,
          judgeColumns: operations.judgeColumns,
          endCall: operations.endCall,
          oneQuestionAsked: batch.oneQuestionAsked,
          assertComponentDeliverable: operations.assertComponentDeliverable,
          newHistory: batch.newHistory,
          startMs,
          declareRaisedAbsence: operations.declareRaisedAbsence,
          fileScript: operations.fileScript,
          proposedProgram,
          askedLayer: batch.askedLayer,
          resolution,
        });
        if (pause !== undefined) return { kind: 'paused', pause };
        // The time layer redrew a drifted look-back at dispatch
        // (`timeLayer.ts` · `timeAtDispatch`): the record's copy was replaced
        // by a fresh one the tool never held, so judging it again names the
        // keys the tool ran with — `start_time`/`end_time`, not `window`.
        if (callArguments.chainedArgs !== judgedOn) {
          changedKeys = changedArgKeys(args, shownArgsOf(tool, callArguments.chainedArgs));
        }
      }
    }
    const skillRoute: CallSkillRoute = {
      // ── Skill-graph read_skill GATE ────────────────────────
      // Reject a read_skill jump OUTSIDE the reachable set from the current
      // cursor: replace the result with a re-prompt naming the allowed ids (so
      // the model re-picks) and skip the activation below — cursor + activations
      // stay unchanged. Off when no skillGraph (deps.allowedSkillIds undefined),
      // so plain read_skill agents are byte-for-byte unaffected.
      //
      // The allowed set is two kinds of id, and the difference is the whole
      // design (8.4.0): a HOP — a skill the graph routes, reachable from where
      // the cursor stands — and an OPEN skill, one the graph never wires (a
      // `.selfExplain()` debug skill, a `.skill()` registered beside the graph,
      // a skill listed in `skills[]` and wired to nothing). Both activate; only a
      // hop moves the cursor. Before 8.4.0 the open ones were offered in
      // read_skill's own menu and then rejected on every single call — the
      // library refused its own flagship debug feature under its own routing
      // feature, and the model could burn a whole run re-asking.
      skillRejected: false,
      skillHop: false,
    };
    applyReadSkillRoute(scope, deps, {
      tc,
      iteration: batch.iteration,
      parkedNow: operations.parkedNow,
      noteSkillRefusal: operations.noteSkillRefusal,
      outcome,
      execution,
      callArguments,
      skillRoute,
    });

    // ── skip_step bookkeeping (9.18.0) ─────────────────────────────
    // Same block as the read_skill gate, same mechanism: the stage
    // OVERWRITES the tool's placeholder with the authoritative sentence
    // BEFORE the after-tool moment, so governance rules and the cap
    // compose over what the model will actually read, on both channels.
    // Postures never gate it — skipping is judgment inside a step, not
    // routing. Zero-cost gate: `stepPlanFor` is undefined on every agent
    // without a stepped skill.
    if (
      operations.frameworkSkipStepAnswered(tc.name, tool) &&
      !outcome.error &&
      !execution.denied
    ) {
      outcome.result = operations.applySkipStep(scope, {
        args: callArguments.callArgs,
        toolCallId: tc.id,
        iteration: batch.iteration,
      });
    }

    // ── present bookkeeping (9.22.0) ───────────────────────────────
    // Same mechanism as skip_step: the auto-attached placeholder ran;
    // the stage overwrites its result with the description snapshot (or
    // the teaching refusal) BEFORE the after-tool moment, so governance
    // and the caps compose over what the model will actually read. A
    // miss is an errored call: the model holds no presentation, and a
    // procedure step whose tool presented nothing must not advance.
    if (
      deps.artifactStore &&
      tc.name === PRESENT_TOOL_NAME &&
      execution.executed &&
      !outcome.error &&
      !execution.denied
    ) {
      const presented = await operations.applyPresent(scope, {
        args: callArguments.callArgs,
        toolCallId: tc.id,
        iteration: batch.iteration,
      });
      outcome.result = presented.text;
      if (!presented.ok) outcome.error = true;
    }

    // ── The after-tool moment ────────────────────────────────────────
    // Last thing before the result becomes history, and only for a call
    // that ran. `modelResult` is what the model reads; `result` stays the
    // truth about the tool and is what `stream.tool_end` reports.
    const rawModelResult = execution.executed
      ? await operations.afterMoment(scope, {
          ...(tool && { tool }),
          toolName: tc.name,
          toolCallId: tc.id,
          iteration: batch.iteration,
          args: callArguments.callArgs,
          result: outcome.result,
          negativeResultId: execution.negativeDispatch?.resultId,
          ...(outcome.error === true && { error: true }),
          history: batch.newHistory,
          ...(batch.runIdentity && { identity: batch.runIdentity }),
          ...(batch.env.signal && { signal: batch.env.signal }),
        })
      : outcome.result;
    // Placement next (9.22.0) — the operator's ref-ing, judged on what
    // the chain let through (a rule that already summarized a huge
    // result is measured on what it produced, the same reasoning as the
    // cap). Over the threshold, the payload is checked into the store
    // and BOTH channels carry the ticket; the truncation net below then
    // measures the ticket. A refused/denied/errored call is never
    // placed: a refusal is already short, and 'tool-result/<name>' must
    // never claim an error is the tool's result.
    const placedValues = await operations.placeResults(
      scope,
      { toolName: tc.name, toolCallId: tc.id, iteration: batch.iteration },
      { result: outcome.result, modelResult: rawModelResult },
      execution.executed && !outcome.error && !execution.denied && !execution.ceilingRefused,
    );
    // The write seam (9.77.0) — judged on `result`, the tool's own answer,
    // and on `newHistory`, which at this point holds every earlier tool
    // result and not yet this one. Same guard the placement decision uses:
    // a call that did not run, errored, was denied or had its payload
    // refused has no lookup answer to read.
    operations.noticeEmptyLookup(
      scope,
      { toolName: tc.name, toolCallId: tc.id, iteration: batch.iteration },
      callArguments.callArgs,
      outcome.result,
      batch.newHistory,
      execution.executed && !outcome.error && !execution.denied && !execution.ceilingRefused,
    );
    // The ceiling, last — after the tool, after the chain. A rule that
    // already summarized a huge result is measured on what it produced, so
    // the cap composes with governance rather than pre-empting it.
    const capped = operations.capResults(tc.name, placedValues);
    const modelResult = capped.modelResult;

    const durationMs = Date.now() - startMs;
    recordCallSettlement(scope, {
      fileScript: operations.fileScript,
      tool,
      tc,
      iteration: batch.iteration,
      proposedProgram,
      execution,
      programOfCall: operations.programOfCall,
      callArguments,
      emitToolEnd: operations.emitToolEnd,
      capped,
      durationMs,
      outcome,
      modelResult,
      changedKeys,
    });
    const delivery: CallDelivery = {
      resultStr: typeof modelResult === 'string' ? modelResult : safeStringify(modelResult),
    };
    landCallResult(scope, deps, {
      delivery,
      execution,
      tc,
      outcome,
      skillRoute,
      callArguments,
      readSkillStepIntroFor: operations.readSkillStepIntroFor,
      applyStepReturn: operations.applyStepReturn,
      iteration: batch.iteration,
      applyToolEffects: operations.applyToolEffects,
      transitionState: batch.transitionState,
      runFactsOf: operations.runFactsOf,
      tool,
      repeatLedgers: operations.repeatLedgers,
      inputs: batch.inputs,
      resolution,
      args,
      noteOptionsFor: operations.noteOptionsFor,
      newHistory: batch.newHistory,
      batchResults: batch.batchResults,
    });
    await judgeLanded(
      scope,
      deps.findingsJudge,
      execution.executed && !execution.denied && !skillRoute.skillRejected,
      { toolName: tc.name, result: delivery.resultStr, toolCallId: tc.id },
      batch.iteration,
      operations.turnStampOf(scope),
    );
    activateLandedSkill(scope, deps, { tc, outcome, execution, skillRoute, callArguments });
    if (execution.haltContext) {
      haltLandedCall(scope, {
        haltContext: execution.haltContext,
        emitSecurity,
        tc,
        newHistory: batch.newHistory,
        iteration: batch.iteration,
        callArguments,
      });
      return { kind: 'halted' };
    }

    return { kind: 'landed' };
  };
  return dispatchCall;
}
