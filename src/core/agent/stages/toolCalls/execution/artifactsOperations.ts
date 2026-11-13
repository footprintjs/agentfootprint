import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { type TypedScope, isDevMode } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { Tool } from '../../../../../tools/tools.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { ArtifactMeta } from '../../../../../artifacts/types.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import { wantsNeedsStoreRefusal, resolveToolWants } from '../../../../../artifacts/wants.js';
import {
  type AskComponent,
  assertAskComponent,
  InvalidAskComponentError,
} from '../../../../../tools/askComponent.js';
import { presentArtifact, PRESENT_TOOL_NAME } from '../../../../../artifacts/present.js';
import { safeStringify } from '../../../validators.js';
import { placedResultKind, placedToolResult } from '../../../../../artifacts/placement.js';
import { strippedOnly } from '../../../../../semantics/coverage/read.js';
import type { ToolArtifactsOperations } from '../contracts/operations/artifacts.js';
import type { ToolContextOperations } from '../contracts/operations/context.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';

interface ToolArtifactsOperationsLinks {
  readonly runScopeOf: ToolContextOperations['runScopeOf'];
  readonly toolArtifacts: ToolContextOperations['toolArtifacts'];
  readonly lookupTool: ToolCatalogOperations['lookupTool'];
}

/** Compose the existing artifacts callbacks once for this handler. */
export function buildToolArtifactsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'artifactStore' | 'placement'>,
  links: ToolArtifactsOperationsLinks,
): ToolArtifactsOperations {
  // ── Ref ARGUMENTS at dispatch (9.22.0, Leg 1) — ONE resolver, every door ──
  // The batch loop and `resolveCredentialAndExecute` (the resume paths) both
  // dispatch tools; each calls this BEFORE credential resolution — never
  // acquire credentials for a call that won't run — so a declared ref is
  // judged identically whichever door the call came through. Success rides
  // the existing `artifacts.resolved` (one event per resolved argument);
  // refusals ride `artifacts.refused` with `op: 'dispatch'`, and the tool is
  // NOT executed — the model reads the teaching refusal instead.

  const resolveWantsAtDispatch = async (
    scope: TypedScope<AgentState>,
    toolName: string,
    wants: NonNullable<Tool['wants']>,
    args: ToolArgs,
    /** The tool's OWN schema — the other half of the declaration. `required`
     *  there is what makes an omitted ref a hole rather than a choice, and it
     *  is read HERE, not left to `toolArgValidation`: that dial is agent-wide
     *  and can be turned off, while `wants` is a promise about delivered data
     *  (the same reason the non-string belt already runs behind a disabled
     *  gate). */
    inputSchema: Readonly<Record<string, unknown>> | undefined,
  ): Promise<
    | {
        readonly ok: true;
        readonly args: ToolArgs;
        readonly wanted?: Readonly<Record<string, ArtifactMeta>>;
      }
    | { readonly ok: false; readonly refusal: string }
  > => {
    const store = deps.artifactStore;
    if (store === undefined) {
      // Statically registered tools are refused at BUILD; this serves the
      // doors that only meet the tool at dispatch (provider-served tools).
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: 'no-store',
        detail: `tool '${toolName}' declares wants but no artifact store is attached`,
        tool: toolName,
      });
      return { ok: false, refusal: wantsNeedsStoreRefusal(toolName, wants) };
    }
    const verdict = await resolveToolWants(
      store,
      links.runScopeOf(scope),
      toolName,
      wants,
      args,
      inputSchema,
    );
    if (!verdict.ok) {
      for (const refusal of verdict.refusals) {
        typedEmit(scope, 'agentfootprint.artifacts.refused', {
          op: 'dispatch',
          reason: refusal.reason,
          ...(refusal.ref !== undefined && { ref: refusal.ref }),
          detail: refusal.detail,
          tool: toolName,
        });
      }
      return { ok: false, refusal: verdict.refusal };
    }
    for (const { meta } of verdict.resolved) {
      typedEmit(scope, 'agentfootprint.artifacts.resolved', {
        ref: meta.ref,
        via: 'get',
        kind: meta.kind,
        bytes: meta.bytes,
        tool: toolName,
      });
    }
    return {
      ok: true,
      args: verdict.args,
      // Absent when nothing resolved (no declared arg was passed): absent
      // and empty are different facts, and `ctx.wanted` keeps them apart.
      ...(verdict.resolved.length > 0 && { wanted: verdict.wanted }),
    };
  };

  // ── Typed-HITL ask components at raise time (9.24.0) ───────────────────
  // The ONE gatekeeper every component-carrying ask passes through before it
  // is allowed to pause: `askHuman({ component })`, a middleware `ask`, and a
  // tool's `checkInComponent` all land here. Shape first (the door the value
  // arrived through is named in the refusal), then the `propsRef` questions
  // only a raise site can answer — is there a store, and does the ref resolve
  // in THIS run's scope. A dangling ref is refused at its source, loudly (the
  // run fails with the teaching error), never handed to a screen to discover:
  // a pause whose component cannot render is a question a person
  // half-receives, and silently downgrading a consent gate to prose would be
  // accepted-and-silently-wrong. Refusals + resolutions land on the record as
  // `artifacts.refused { op: 'dispatch' }` / `artifacts.resolved` — the same
  // facts a `wants` resolution files. Asks WITHOUT a component never reach
  // this function: zero reads, zero events, byte-identical.

  const assertComponentDeliverable = async (
    scope: TypedScope<AgentState>,
    toolName: string,
    component: unknown,
    door: string,
  ): Promise<AskComponent> => {
    assertAskComponent(component, door);
    const ref = component.propsRef;
    if (ref === undefined) return component;
    const store = deps.artifactStore;
    if (store === undefined) {
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: 'no-store',
        ref,
        detail: `${door}: component.propsRef set but no artifact store is attached`,
        tool: toolName,
      });
      throw new InvalidAskComponentError(
        'no-store',
        door,
        `component.propsRef ('${ref}') is set but no artifact store is attached, so the ` +
          `screen could never redeem it. Pass \`artifacts\` to Agent.create({ ..., artifacts }) ` +
          `— inMemoryArtifacts(), fileArtifacts({ directory }) or sqliteArtifacts({ file }) — ` +
          `or carry the payload inline as component.props.`,
        ref,
      );
    }
    const meta = await store.head(links.runScopeOf(scope), ref);
    if (meta === null) {
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: 'missing-or-expired',
        ref,
        detail: `${door}: component.propsRef does not resolve in this run's scope`,
        tool: toolName,
      });
      throw new InvalidAskComponentError(
        'unresolved-ref',
        door,
        `component.propsRef ('${ref}') does not resolve in this run's artifact scope — ` +
          `missing, expired, or minted under a different scope. Mint the props BEFORE raising ` +
          `the ask (ctx.artifacts.put(...) in the same run) and pass the ref it returns; a ` +
          `ref the screen cannot redeem must be refused here, at the source, not discovered ` +
          `by the person answering.`,
        ref,
      );
    }
    typedEmit(scope, 'agentfootprint.artifacts.resolved', {
      ref: meta.ref,
      via: 'head',
      kind: meta.kind,
      bytes: meta.bytes,
      tool: toolName,
    });
    return component;
  };

  // ── The `present` tool's authoritative result (9.22.0, Leg 2) ──────────
  // The skip_step pattern: the auto-attached placeholder ran; the stage —
  // which owns the scope, the store and the emit channel — OVERWRITES its
  // result with the description snapshot (or the teaching refusal), so
  // governance rules and the caps compose over what the model will read.

  // LENS · tool-result · persistent-history
  // reads: the artifact's description snapshot ← the ArtifactStore port (src/artifacts/present.ts, the owner of head/list)
  // law: may omit, never deny; every clause anchored to the call it was composed on.
  const applyPresent = async (
    scope: TypedScope<AgentState>,
    call: {
      readonly args: Readonly<Record<string, unknown>>;
      readonly toolCallId: string;
      readonly iteration: number;
    },
  ): Promise<{ readonly ok: boolean; readonly text: string }> => {
    const store = deps.artifactStore;
    if (store === undefined) {
      // Unreachable through the Agent (the tool is only attached beside a
      // store) — kept for the same reason the placeholder text exists.
      return {
        ok: false,
        text: 'present has no artifact store behind it here; nothing was presented.',
      };
    }
    const outcome = await presentArtifact(store, links.runScopeOf(scope), call.args);
    if (!outcome.ok) {
      typedEmit(scope, 'agentfootprint.artifacts.refused', {
        op: 'dispatch',
        reason: outcome.missedRef !== undefined ? 'missing-or-expired' : 'invalid-input',
        ...(outcome.missedRef !== undefined && { ref: outcome.missedRef }),
        detail: outcome.refusal,
        tool: PRESENT_TOOL_NAME,
      });
      return { ok: false, text: outcome.refusal };
    }
    const { ref, as, snapshot } = outcome.result;
    typedEmit(scope, 'agentfootprint.artifacts.resolved', {
      ref,
      via: 'head',
      kind: snapshot.kind,
      bytes: snapshot.bytes,
      tool: PRESENT_TOOL_NAME,
    });
    typedEmit(scope, 'agentfootprint.artifacts.presented', {
      ref,
      as,
      snapshot: { ...snapshot },
      toolCallId: call.toolCallId,
      iteration: call.iteration,
    });
    // The snapshot lives INSIDE the tool result — the one thing provider
    // history keeps typed and durable — so a reloaded conversation can
    // re-draw the pane, or state honestly why it can't.
    return { ok: true, text: safeStringify(outcome.result) };
  };

  // ── The placement threshold (9.22.0, Leg 3) — ONE judge, every door ────
  // Called beside every `capResults` site, on the FINALIZED values (after
  // the tool's own resultCeiling, after the after-tool chain) and before the
  // truncation net — the stated precedence: author's refusal first, then the
  // operator's ref-ing, then the last-resort net (which then measures the
  // ticket). A placed result is a TICKET, not a refusal: the caller's
  // effects/step bookkeeping proceeds exactly as if the payload had landed.
  //
  // ── WHAT ROUTING SEES AFTERWARDS (the coupling, stated at both ends) ───
  // The substitute returned here becomes `resultStr` below, which is the ONE
  // string every downstream reader gets: the `role: 'tool'` history message,
  // `scope.lastToolResult.result`, and each `scope.toolResults[]` entry. Route
  // `when` predicates and `rule` triggers read exactly that string
  // (`InjectionContext.lastToolResult` / `toolResults` — the other end of this
  // comment lives on those fields), so raising or lowering `maxInlineChars`
  // CAN change which edge fires: a predicate matching on payload text stops
  // matching once the payload becomes a ticket, and one matching on
  // `"kind":"tool-result/<tool>"` only ever matches after placement.
  //
  // That is the layering, not an accident. The alternative — predicates
  // reading the pre-placement text while the model reads the ticket — would
  // route on a string that is not in the conversation, and the whole point of
  // reading `lastToolResult` is to react to what the MODEL was told. Keep the
  // two identical: whatever the model reads is what routing judges. (Tool NAME
  // edges — `onToolReturn` — and `onToolStatus` are unaffected either way;
  // neither reads the result text.)

  const placeResults = async (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    values: { readonly result: unknown; readonly modelResult: unknown },
    eligible: boolean,
  ): Promise<{ readonly result: unknown; readonly modelResult: unknown }> => {
    const placement = deps.placement;
    if (placement === undefined || deps.artifactStore === undefined || !eligible) return values;
    const text =
      typeof values.modelResult === 'string'
        ? values.modelResult
        : safeStringify(values.modelResult);
    if (text.length <= placement.maxInlineChars) return values;
    const bound = links.toolArtifacts(scope, call.toolName, call.toolCallId);
    let meta: ArtifactMeta;
    try {
      // The payload stored is the EXACT text the model would have read —
      // byte-faithful, so a consumer redeems precisely what was displaced.
      // `mediaType` states what that text is: a JSON serialization when the
      // tool returned a value, plain text when it returned a string.
      meta = await bound.artifacts.put({
        // The tool's own `resultKind` when it declared one (9.70.0), the
        // framework's `tool-result/<name>` when it did not. Resolved HERE
        // rather than threaded through the five dispatch doors: `lookupTool`
        // is the closure's one resolver (registry + this iteration's cached
        // provider list), so a sixth door added later cannot forget to carry
        // the declaration — the `capResults` landmine, avoided by shape.
        kind: placedResultKind(call.toolName, links.lookupTool(call.toolName)?.resultKind),
        mediaType: typeof values.modelResult === 'string' ? 'text/plain' : 'application/json',
        data: text,
        label: `${call.toolName} result`,
      });
    } catch (err) {
      // The store could not take it (a payload over the whole scope budget,
      // say). The refusal is already on the record via the capability sink;
      // the honest fallback is today's path — the truncation net still
      // measures what placement could not lift. Named in dev mode.
      if (isDevMode()) {
        // eslint-disable-next-line no-console
        console.warn(
          `agentfootprint placement: tool '${call.toolName}' result (${text.length} chars) ` +
            `exceeded the ${placement.maxInlineChars}-char threshold but could not be ` +
            `stored: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return values;
    }
    const substitute = placedToolResult(call.toolName, meta, text.length, placement.maxInlineChars);
    // The library's own receipt for this ticket (`placedTickets.ts`): every
    // reader that speaks of a ticket as the library's asks it, so a tool
    // returning ticket-shaped JSON is never taken for a placement.
    scope.placedTickets = [
      ...(scope.placedTickets ?? []),
      { toolCallId: call.toolCallId, ref: meta.ref },
    ];
    return {
      // One ticket when the two channels carry one value — the capResults
      // law. A value that differs from what the model reads ONLY by the
      // record-only coverage fields (`coverage/read.ts` · `strippedOnly`) is
      // one value too: the fields still ride `tools.absent` /
      // `tools.coverage_declared`, and `tool_end.result` must not keep a
      // payload placement exists to keep off the record. A chain-transformed
      // `result` keeps its own truth and meets the truncation net below,
      // exactly as before.
      result:
        values.result === values.modelResult || strippedOnly(values.result, values.modelResult)
          ? substitute
          : values.result,
      modelResult: substitute,
    };
  };

  return { resolveWantsAtDispatch, assertComponentDeliverable, applyPresent, placeResults };
}
