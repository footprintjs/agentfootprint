import type {
  CallResultCell,
  CallExecution,
  CallArguments,
  CallSkillRoute,
} from '../contracts/callCells.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { spoken } from '../../../../../lib/spokenIds.js';
import { classifySkillTarget } from '../../../../../injection-engine/skillGraph.js';
import { dedupeIds } from '../helpers/dedupeIds.js';
import type { LLMToolSchema } from '../../../../../provider-contract/types.js';
import { selfCallNotice, selfSkillTools } from '../../../selfCallNotice.js';
import type { ActiveInjection } from '../../../../../injection-engine/types.js';
import { skillActivationConfirmation } from '../../../../../injection-engine/skillToolDescriptors.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import { composeReadSkillRefusal } from '../helpers/readSkillRefusal.js';
import { type TurnRoute, menuOutstanding } from '../../../../../injection-engine/routingPolicy.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolStepsOperations } from '../contracts/operations/steps.js';

interface ReadSkillRouteBindings {
  readonly tc: DispatchCall;
  readonly iteration: number;
  readonly parkedNow: ToolCatalogOperations['parkedNow'];
  readonly noteSkillRefusal: ToolStepsOperations['noteSkillRefusal'];
  readonly outcome: CallResultCell;
  readonly execution: CallExecution;
  readonly callArguments: CallArguments;
  readonly skillRoute: CallSkillRoute;
}

/** Apply the existing post-execution read_skill route, in the original order. */
export function applyReadSkillRoute(
  scope: TypedScope<AgentState>,
  deps: Pick<
    ToolCallsHandlerDeps,
    'allowedSkillIds' | 'openSkillIds' | 'skillGraphIsTree' | 'skillStrictness'
  >,
  bindings: ReadSkillRouteBindings,
): void {
  if (
    deps.allowedSkillIds &&
    bindings.tc.name === 'read_skill' &&
    !bindings.outcome.error &&
    !bindings.execution.denied
  ) {
    const reqId = (bindings.callArguments.callArgs as { id?: unknown }).id;
    if (typeof reqId === 'string' && reqId.length > 0) {
      const currentSkillId = scope.currentSkillId as string | undefined;
      // ── ADMISSION reads the graph; every SENTENCE reads the filter ──
      // Two sets, deliberately (9.86.0). `admissible` is the routing law:
      // what the graph and the mount actually grant, unfiltered, because a
      // narrowing may take a schema off the wire but never a name out of
      // the dispatch map — role visibility governs what the model is TOLD,
      // not what the gate admits. `hopsNamed` / `openNamed` are what any
      // sentence, and the `skill.rejected` payload, may NAME: the same
      // hidden set the description filtered itself with, resolved once by
      // the tools slot and carried here on scope. Without it the refusals
      // read the raw sets and could name a skill this role may never see —
      // the leak the description closed, one stage downstream. (A hidden
      // skill cannot reach this gate anyway: the `skill_read` permission
      // gate above denies it first, on the same checker. The filter is
      // what keeps that true by construction rather than by coincidence.)
      const hiddenIds = new Set((scope.hiddenSkillIds as readonly string[] | undefined) ?? []);
      const mayName = (id: string): boolean => !hiddenIds.has(id);
      const hops = deps.allowedSkillIds(currentSkillId);
      const openAll = deps.openSkillIds ?? [];
      // `spoken` keeps BOTH halves — what may be named, and whether the
      // graph held anything before the filter ran. A composer handed only
      // the filtered array cannot tell "nothing was reachable" from
      // "nothing reachable may be named", and it used to assert the first.
      const hopsSpoken = spoken(hops, mayName);
      const openSpoken = spoken(openAll, mayName);
      // The cursor through the SAME filter (9.86.1). The description
      // withholds a hidden cursor's name and every refusal below printed
      // it raw in two clauses; `cursorWithheld` keeps the sentence's
      // anchor honest ("the skill the cursor stood in") without the id.
      const cursorSpoken =
        currentSkillId === undefined
          ? {}
          : mayName(currentSkillId)
          ? { cursorId: currentSkillId }
          : { cursorWithheld: true };
      const hopsNamed = hopsSpoken.named;
      const openNamed = openSpoken.named;
      // The ONE owner of "is this target the cursor?" — the same function
      // the description, the tool-effects judge and the permission gate
      // switch on, so a stay means the same thing in all four.
      const targetClass = classifySkillTarget({
        ...(currentSkillId !== undefined && { cursor: currentSkillId }),
        target: reqId,
        hops,
        open: openAll,
      });
      bindings.skillRoute.skillHop = targetClass === 'hop';
      const admissible = dedupeIds([...hops, ...openAll]);
      const allowed = dedupeIds([...hopsNamed, ...openNamed]);
      // ── The RE-ENGAGEMENT arm (9.59.0) — a third admission class ──
      // A pick must be routed by INTENT. The reachable set deliberately
      // excludes the node the cursor already occupies (`makeReachableSkills`
      // filters it out), which is right for a MOVE and wrong for an
      // ENGAGEMENT: parking never moves the cursor, so a parked map is
      // parked exactly WHERE the model wants to return, and the refusal
      // then told the model to "answer with the current skill" — whose
      // prompt and tools had just been suppressed. For a single-member
      // map that made parking permanent for the rest of the turn, under
      // documentation calling this pick the recovery door.
      //
      // So: a pick of a PARKED map's member is admitted, activates, and
      // does NOT touch the cursor — the same shape as an OPEN skill
      // ("they ACTIVATE and never move the cursor"). `skillHop` stays
      // false, `pendingSkillPick` stays unwritten, and the pick lands on
      // `acceptedSkillPicks`, which the kernel's renewal feed reads as
      // explicit evidence and re-engages on the very next pass.
      const parked = bindings.parkedNow(scope);
      const reengaging = parked?.has(reqId) === true;
      if (reengaging) {
        // Admitted. Nothing to refuse and no posture to apply: this is
        // not a hop, and a posture governs routing, not engagement.
      } else if (targetClass === 'self') {
        // ── The SELF-CALL arm (9.84.0) — BEFORE reachability ─────────
        // The cursor is in neither half of `allowed`, by construction:
        // `makeReachableSkills` filters it out of its own successor set
        // and `openSkillIds()` excludes every graph-wired skill. So a
        // pick of the skill the model is ALREADY IN fell through to the
        // reachability arm and came back "not reachable from here" —
        // about the one skill whose body was in the prompt and whose
        // tools were in that same call's tool list. Models read that as
        // "unavailable" and stop, which is exactly what happened in the
        // field, three times in one day.
        //
        // It stays a REJECTION mechanically — no activation to append
        // (the cursor already activates it), no hop (`skillHop` is false
        // for the cursor anyway), and the refusal cap still counts it,
        // because a self-call LOOP is precisely the stuck model that
        // budget exists to escalate. What changes is the sentence: an
        // acknowledgement of where the model stands, and — named from
        // this call's own wire list, never from the declaration — what
        // it can call right now. `reason` on the event is what lets a
        // consumer tell the two apart without comparing ids.
        //
        // Ordered after re-engagement on purpose: a parked map member
        // picked at its own cursor is a genuine re-engagement request,
        // and re-engaging it beats telling the model about tools that
        // the park has just taken off the wire.
        bindings.skillRoute.skillRejected = true;
        // The wire the model was ACTUALLY handed on THIS call — the one
        // the notice speaks about and the only one it may speak about.
        // Read unconditionally: a `scope.wrapUpAsked` guard here could
        // never fire. This stage runs only on the Route decider's
        // `'tool-calls'` branch, which it takes only while
        // `iteration < maxIterations`; `wrapUpStage` raises the latch one
        // iteration PAST that, so every self-call is composed with the
        // latch still down.
        const wire = scope.dynamicToolSchemas as readonly LLMToolSchema[] | undefined;
        // No routing map is passed, and that is the fix rather than an
        // omission. A tool result is re-read on every later call of the
        // turn, so any id named here as somewhere `read_skill` could go
        // is a PREDICTION — and three separate mechanisms falsify it
        // after this line has run: the budget (a hop is a tool call, and
        // the wrap-up dispatches none), the POSTURE arm forty lines below
        // (`rails` refuses every model hop; `guard` refuses every hop off
        // an outstanding menu, which is the default state of a decisively
        // routed turn), and the cursor itself (a sibling tool in this
        // very batch can fire a step edge). Passing `hops` through the
        // hidden-id filter fixed only the third-party leak and left all
        // three staleness paths open; the notice contradicting the
        // posture arm's own refusal — and costing a refusal from the
        // escalation budget to find out — was the live bug. The routing
        // map belongs to the `read_skill` DESCRIPTION, which is
        // recomposed on every call and is therefore never stale.
        bindings.outcome.result = selfCallNotice({
          skillId: reqId,
          tools: selfSkillTools(
            reqId,
            scope.activeInjections as readonly ActiveInjection[] | undefined,
            wire,
          ),
          // A body only exists under `surfaceMode: 'both'` (`'tool-only'`
          // is refused at build for anything a graph routes, and only a
          // graph-wired skill can be the cursor); every other mode
          // returns the activation confirmation, which would promise an
          // activation that is not pending. `ceilingRefused` is the third
          // shape `result` can hold — a `resultCeiling`/`resultColumns`
          // refusal composed above — and it is nobody's instructions.
          ...(typeof bindings.outcome.result === 'string' &&
            !bindings.execution.ceilingRefused &&
            bindings.outcome.result !== skillActivationConfirmation(reqId) && {
              body: bindings.outcome.result,
            }),
        });
        typedEmit(scope, 'agentfootprint.skill.rejected', {
          requestedId: reqId,
          currentSkillId,
          allowed,
          iteration: bindings.iteration,
          reason: 'self-call',
        });
        bindings.noteSkillRefusal(scope, bindings.iteration);
      } else if (!admissible.includes(reqId)) {
        bindings.skillRoute.skillRejected = true;
        bindings.outcome.result = composeReadSkillRefusal({
          requestedId: reqId,
          targetClass,
          ...cursorSpoken,
          hops: hopsSpoken,
          openIds: openSpoken,
          ...(deps.skillGraphIsTree === true && { isTree: true }),
        });
        typedEmit(scope, 'agentfootprint.skill.rejected', {
          requestedId: reqId,
          ...(currentSkillId !== undefined && { currentSkillId }),
          allowed,
          iteration: bindings.iteration,
          reason: 'unreachable',
        });
        bindings.noteSkillRefusal(scope, bindings.iteration);
      } else if (deps.skillStrictness !== undefined && bindings.skillRoute.skillHop) {
        // ── The POSTURE arm (SG-C) — after reachability, hops only. ──
        // OPEN skills never reach here (skillHop is false for them), so
        // `.selfExplain()` and friends stay admitted under every posture.
        const turnRoute = scope.turnRoute as TurnRoute | undefined;
        const onOutstandingMenu =
          menuOutstanding(turnRoute, currentSkillId) &&
          turnRoute?.offered?.includes(reqId) === true;
        const refusedByPosture =
          deps.skillStrictness === 'rails' ||
          (deps.skillStrictness === 'guard' && !onOutstandingMenu);
        if (refusedByPosture) {
          bindings.skillRoute.skillRejected = true;
          bindings.skillRoute.skillHop = false; // a refused pick must not move the cursor below
          // The posture arm names NO hop — under 'rails' the model does
          // not route, and under 'guard' it routes only from a menu — so
          // the composer is handed the menu when there IS one and an
          // empty hop list either way. Open skills are still named:
          // they never reach this arm, so nothing here can decline them.
          const menuNamed =
            turnRoute?.offered !== undefined && menuOutstanding(turnRoute, currentSkillId)
              ? spoken(turnRoute.offered, mayName)
              : undefined;
          bindings.outcome.result = composeReadSkillRefusal({
            requestedId: reqId,
            targetClass,
            ...cursorSpoken,
            // No hop is named under a posture, and the graph's hop set
            // is not this arm's subject — `held: false` is the honest
            // shape, not a claim that nothing was reachable (this arm
            // never composes the reachability clause at all).
            hops: { named: [], held: false },
            openIds: openSpoken,
            posture: deps.skillStrictness,
            ...(menuNamed !== undefined && { menuOffered: menuNamed }),
            // The whole verdict, not a boolean derived from two of its
            // six values: the composer says one past fact per value.
            ...(turnRoute !== undefined && { turnStartedBy: turnRoute.by }),
          });
          typedEmit(scope, 'agentfootprint.skill.rejected', {
            requestedId: reqId,
            ...(currentSkillId !== undefined && { currentSkillId }),
            allowed,
            iteration: bindings.iteration,
            posture: deps.skillStrictness,
            reason: 'posture',
          });
          bindings.noteSkillRefusal(scope, bindings.iteration);
        }
      }
    }
  }
}
