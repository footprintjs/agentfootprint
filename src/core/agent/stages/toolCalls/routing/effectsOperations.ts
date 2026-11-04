import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { isDevMode, type TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type {
  ReadToolResultEnvelope,
  ProposedEffect,
} from '../../../../../semantics/toolEffects.js';
import type { TransitionBatchState } from '../contracts/callFacts.js';
import {
  type InstructionLease,
  tenantOf,
  pruneLeases,
} from '../../../../../injection-engine/leases.js';
import { typedEmit } from '../../../../../recorders/core/typedEmit.js';
import { classifySkillTarget } from '../../../../../injection-engine/skillGraph.js';
import { spoken } from '../../../../../lib/spokenIds.js';
import type { ToolEffectsOperations } from '../contracts/operations/effects.js';

/** Compose the existing effects callbacks once for this handler. */
export function buildToolEffectsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'allowedSkillIds' | 'leaseTargets'>,
): ToolEffectsOperations {
  const warnEffect = (toolName: string, sentence: string): void => {
    if (isDevMode()) {
      // eslint-disable-next-line no-console
      console.warn(`agentfootprint tool-effects: tool '${toolName}' — ${sentence}`);
    }
  };

  /**
   * Judge one finalized result's effects, in declaration order. Returns the
   * model-visible NOTE (teaching refusals only — an accepted effect speaks
   * through what it does: the cursor move, the delivered instruction).
   * Every judgment is a `tools.effect` event; nothing is half-applied.
   */
  const applyToolEffects = (
    scope: TypedScope<AgentState>,
    call: { readonly toolName: string; readonly toolCallId: string; readonly iteration: number },
    envelope: ReadToolResultEnvelope,
    state: TransitionBatchState,
  ): string => {
    let note = '';
    const refuse = (
      kind: ProposedEffect['kind'],
      refusalReason: string,
      fields: {
        targetSkillId?: string;
        reason?: string;
        instructionId?: string;
        deliveryLease?: InstructionLease['deliveryLease'];
      } = {},
    ): void => {
      typedEmit(scope, 'agentfootprint.tools.effect', {
        kind,
        outcome: 'refused',
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
        ...(fields.targetSkillId !== undefined && { targetSkillId: fields.targetSkillId }),
        ...(fields.reason !== undefined && { reason: fields.reason }),
        ...(fields.instructionId !== undefined && { instructionId: fields.instructionId }),
        ...(fields.deliveryLease !== undefined && { deliveryLease: fields.deliveryLease }),
        refusalReason,
      });
      note += ` [tool effect refused: ${refusalReason}]`;
      warnEffect(call.toolName, refusalReason);
    };

    for (const bad of envelope.malformed) refuse(bad.kind, bad.refusalReason);

    for (const effect of envelope.effects) {
      if (effect.kind === 'propose-transition') {
        const target = effect.targetSkillId;
        if (!deps.allowedSkillIds) {
          refuse(
            'propose-transition',
            `propose-transition → '${target}' needs a mounted skill graph: without one there ` +
              `is no routing law to check the proposal against and no cursor to move. Mount ` +
              `.skillGraph(), or drop the effect.`,
            { targetSkillId: target, reason: effect.reason },
          );
          continue;
        }
        const currentSkillId = scope.currentSkillId as string | undefined;
        const hops = deps.allowedSkillIds(currentSkillId);
        const targetClass = classifySkillTarget({
          ...(currentSkillId !== undefined && { cursor: currentSkillId }),
          target,
          hops,
        });
        // ── A PROPOSAL TO THE CURSOR'S OWN SKILL IS A STAY (9.86.0) ──────
        // `makeReachableSkills` filters the cursor out of its own successor
        // set — right for a MOVE, and this judge read it as "not reachable"
        // and refused. A tool saying "stay where you are" asks for the state
        // the run is already in: there is no cursor to move, no activation to
        // append, and nothing to refuse. It is accepted as a no-op — no
        // `pendingToolTransition`, no cursor move, and no `[tool effect
        // refused: …]` suffix on a result that proposed nothing wrong.
        //
        // The event carries the existing `'accepted'` outcome plus an
        // ADDITIVE `stay: true`, deliberately not a new enum member: an
        // exhaustive switch over `outcome` in a consumer must keep compiling.
        //
        // A STAY COMPETES FOR THE SLOT LIKE ANY OTHER ACCEPTED PROPOSAL
        // (9.86.1). The batch law is "first ACCEPTED proposal wins, later
        // proposals to OTHER targets are superseded", and a stay is accepted
        // — so a stay judged first holds the slot (with nothing written to
        // `pendingToolTransition`, because a stay moves nothing) and a later
        // sibling proposing a hop is `'superseded'` and lands in the
        // `route_conflict` losers, exactly as two conflicting hops do. Before
        // this the stay `continue`d past the bookkeeping, so the tool that
        // judged its data first lost to whichever sibling came second, with
        // two `'accepted'` events in one batch and no conflict on the record.
        // The same law in the other order: a stay proposed AFTER an accepted
        // hop is superseded by it, not accepted beside it.
        if (targetClass === 'self') {
          if (state.winner !== undefined && state.winner.targetSkillId !== target) {
            state.losers.push({
              toolCallId: call.toolCallId,
              toolName: call.toolName,
              target,
            });
            typedEmit(scope, 'agentfootprint.tools.effect', {
              kind: 'propose-transition',
              outcome: 'superseded',
              toolName: call.toolName,
              toolCallId: call.toolCallId,
              iteration: call.iteration,
              targetSkillId: target,
              reason: effect.reason,
              supersededBy: 'earlier-proposal',
            });
            continue;
          }
          if (state.winner === undefined) {
            state.winner = {
              targetSkillId: target,
              toolName: call.toolName,
              toolCallId: call.toolCallId,
              reason: effect.reason,
              iteration: call.iteration,
            };
          }
          typedEmit(scope, 'agentfootprint.tools.effect', {
            kind: 'propose-transition',
            outcome: 'accepted',
            stay: true,
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            iteration: call.iteration,
            targetSkillId: target,
            reason: effect.reason,
          });
          continue;
        }
        if (targetClass === 'unreachable') {
          // ── THE REFUSAL SPEAKS WITH THE FILTERED SETS (9.86.1) ──────────
          // This sentence is appended to the tool result the model reads and
          // rides the `tools.effect` payload, and it named the raw hop set and
          // the raw cursor — the leak the `read_skill` refusals closed one
          // function up. Same filter, same law: the hidden set the tools slot
          // resolved for this iteration, and OMIT, NEVER DENY — a hop set the
          // filter emptied composes no reachable clause rather than an empty
          // one. Admission is still judged on the raw `hops`.
          const hiddenIds = new Set((scope.hiddenSkillIds as readonly string[] | undefined) ?? []);
          const mayName = (id: string): boolean => !hiddenIds.has(id);
          const reachable = spoken(hops, mayName);
          const from =
            currentSkillId === undefined
              ? 'the turn start'
              : mayName(currentSkillId)
              ? `'${currentSkillId}'`
              : 'the skill the cursor stood in';
          refuse(
            'propose-transition',
            `propose-transition → '${target}' was refused: '${target}' is not reachable from ` +
              `${from} per the graph's own law${
                reachable.named.length > 0 ? ` (reachable: ${reachable.named.join(', ')})` : ''
              }. The graph decides — a proposal is evidence, never authority.`,
            { targetSkillId: target, reason: effect.reason },
          );
          continue;
        }
        if (state.winner !== undefined && state.winner.targetSkillId !== target) {
          // A later proposal to a DIFFERENT target — suppressed under the
          // route_conflict law (first in call order wins), on the record.
          state.losers.push({
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            target,
          });
          typedEmit(scope, 'agentfootprint.tools.effect', {
            kind: 'propose-transition',
            outcome: 'superseded',
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            iteration: call.iteration,
            targetSkillId: target,
            reason: effect.reason,
            supersededBy: 'earlier-proposal',
          });
          continue;
        }
        if (state.winner === undefined) {
          state.winner = {
            targetSkillId: target,
            toolName: call.toolName,
            toolCallId: call.toolCallId,
            reason: effect.reason,
            iteration: call.iteration,
          };
          // Committed AT ACCEPTANCE (not batch end) so a pause later in the
          // batch checkpoints the accepted move instead of dropping it.
          scope.pendingToolTransition = state.winner;
          // The activation promise a gate-accepted read_skill pick makes,
          // made here too: a model-edge-only target keeps its llm-activated
          // trigger, so the ledger entry is what makes the body actually
          // load when the cursor lands.
          const activated = scope.activatedInjectionIds as readonly string[];
          if (!activated.includes(target)) {
            scope.activatedInjectionIds = [...activated, target];
          }
        }
        // First acceptance AND a same-target repeat both land here: every
        // proposal that asked for the move that happens is 'accepted'.
        typedEmit(scope, 'agentfootprint.tools.effect', {
          kind: 'propose-transition',
          outcome: 'accepted',
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          iteration: call.iteration,
          targetSkillId: target,
          reason: effect.reason,
        });
        continue;
      }
      // require-instruction
      const known = deps.leaseTargets?.get(effect.instructionId);
      if (known === undefined) {
        refuse(
          'require-instruction',
          `require-instruction '${effect.instructionId}' was refused: no registered ` +
            `injection carries that id — the push door serves the declared catalog only ` +
            `(read_skill stays the pull door).`,
          { instructionId: effect.instructionId, deliveryLease: effect.deliveryLease },
        );
        continue;
      }
      if (known.surfaceMode === 'tool-only') {
        refuse(
          'require-instruction',
          `require-instruction '${effect.instructionId}' was refused: that skill declares ` +
            `surfaceMode 'tool-only', whose body travels only as a read_skill result — the ` +
            `system slot suppresses it, so the lease would be granted and never delivered. ` +
            `Pull it with read_skill, or change the skill's surfaceMode.`,
          { instructionId: effect.instructionId, deliveryLease: effect.deliveryLease },
        );
        continue;
      }
      const tenant = tenantOf(
        scope.currentSkillId as string | undefined,
        scope.activatedInjectionIds as readonly string[] | undefined,
      );
      const lease: InstructionLease = {
        instructionId: effect.instructionId,
        deliveryLease: effect.deliveryLease,
        ...(tenant !== undefined && { skillId: tenant }),
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
      };
      // Prune-as-we-write: spent grants leave with the same write that adds
      // the new one, so a long turn never accumulates dead leases.
      scope.instructionLeases = [
        ...pruneLeases(
          scope.instructionLeases as readonly InstructionLease[] | undefined,
          call.iteration,
          tenant,
        ),
        lease,
      ];
      typedEmit(scope, 'agentfootprint.tools.effect', {
        kind: 'require-instruction',
        outcome: 'accepted',
        toolName: call.toolName,
        toolCallId: call.toolCallId,
        iteration: call.iteration,
        instructionId: effect.instructionId,
        deliveryLease: effect.deliveryLease,
      });
    }
    return note;
  };

  /** The batch-end aggregate for conflicting proposals — the
   *  `route_conflict` reuse, additive `source` says what conflicted. The
   *  per-effect `tools.effect` events above already carried every fact;
   *  this is the one-event-per-batch view the edge law already ships. */
  const emitTransitionConflict = (
    scope: TypedScope<AgentState>,
    iteration: number,
    state: TransitionBatchState,
  ): void => {
    if (state.winner === undefined || state.losers.length === 0) return;
    typedEmit(scope, 'agentfootprint.skill.route_conflict', {
      iteration,
      ...(scope.currentSkillId !== undefined && {
        fromSkillId: scope.currentSkillId as string,
      }),
      winner: {
        ...(state.winner.toolCallId !== undefined && { toolCallId: state.winner.toolCallId }),
        toolName: state.winner.toolName,
        target: state.winner.targetSkillId,
      },
      losers: state.losers.map((l) => ({ ...l })),
      source: 'tool-proposal',
    });
  };

  return { warnEffect, applyToolEffects, emitTransitionConflict };
}
