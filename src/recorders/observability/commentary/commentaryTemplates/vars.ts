import type { AgentfootprintEvent } from '../../../../events/registry.js';
import {
  ARTIFACT_OP_PHRASES,
  ARTIFACT_REFUSAL_PHRASES,
  ARTIFACT_SWEEP_PHRASES,
  HAND_OVER_FAILURE_PHRASES,
  humanizeBytes,
  humanizeChars,
  phraseFor,
} from '.././artifactPhrases.js';
import type { CommentaryTemplates, CommentaryContext } from './types.js';
import { defaultCommentaryTemplates } from './templates.js';
import { renderCommentary } from './render.js';
import { extractAgentName } from './agentName.js';

/**
 * Who redeemed / was refused at an artifact door. A tool names itself; the
 * hosting door (9.23.0 — a screen resolving a ref over the wire under its own
 * identity) has no tool name, and gets a sentence that says exactly that
 * instead of a blank or an invented actor.
 */
function artifactActor(tool: string | undefined, templates: CommentaryTemplates): string {
  const named = (tool ?? '').trim();
  return named
    ? renderCommentary(templates['artifacts.actor.tool'] ?? '', { tool: named })
    : templates['artifacts.actor.host'] ?? '';
}

/**
 * Build the variable bag for a given event. Flat `name → string` map;
 * `renderCommentary` substitutes by name. Templates use whatever names
 * this function produces.
 *
 * Two-step composition for `stream.tool_start`: the optional
 * `descClause` is a rendered sub-template. We pre-render it here so
 * the outer template stays a single non-recursive substitution pass.
 */
/** Count words for the `route_conflict` head (index = the count). Beyond the
 *  list the digit itself reads fine ("7 tool results wanted…"). */
const CONFLICT_COUNT_WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'] as const;

export function extractCommentaryVars(
  event: AgentfootprintEvent,
  ctx: CommentaryContext,
  templates: CommentaryTemplates = defaultCommentaryTemplates,
): Record<string, string> {
  const agentName = extractAgentName(event, ctx);
  const base = { appName: ctx.appName, agentName };

  switch (event.type) {
    case 'agentfootprint.agent.turn_start':
      return { ...base, userPrompt: event.payload.userPrompt };

    case 'agentfootprint.stream.tool_start': {
      const toolName = event.payload.toolName;
      // The settled call's sentence names the call the run paused on — read
      // off the bracket's own field, never guessed from the batch.
      const paused = event.payload.notDispatched?.pausedCall;
      if (paused !== undefined) return { ...base, toolName, pausedToolName: paused.toolName };
      const desc = ctx.getToolDescription?.(toolName);
      const hasDesc = typeof desc === 'string' && desc.trim().length > 0;
      // Pre-render the descClause sub-template so the outer template
      // sees a literal string. Keeps the engine flat (non-recursive).
      const descClause = hasDesc
        ? // hasDesc guarantees desc is a non-empty string here.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          renderCommentary(templates['stream.tool_start.desc'] ?? '', { desc: desc! })
        : templates['stream.tool_start.noDesc'] ?? '';
      return { ...base, toolName, descClause };
    }

    case 'agentfootprint.stream.tool_progress':
      return { ...base, toolName: event.payload.toolName };

    case 'agentfootprint.composition.enter': {
      const p = event.payload;
      return {
        ...base,
        name: p.name,
        kind: p.kind,
        childCount: String(p.childCount),
      };
    }

    case 'agentfootprint.composition.exit': {
      const p = event.payload;
      // CompositionExitPayload carries `name` (since v2.14.5);
      // fall back to `id` for older emitters that didn't pass name.
      return {
        ...base,
        name: p.name ?? p.id,
        kind: p.kind,
        status: p.status,
        durationMs: String(p.durationMs ?? 0),
      };
    }

    case 'agentfootprint.context.injected': {
      const p = event.payload;
      // Feed the injection's content summary into `descClause` so an
      // instruction/rule line reads "added a rule: <summary>" instead of an
      // empty ": .". (The instructions/onToolReturn/alwaysOn templates all use
      // {{descClause}}.) Empty summary → empty clause, handled by the templates.
      return { ...base, descClause: (p.contentSummary ?? '').trim() };
    }

    case 'agentfootprint.context.evaluated': {
      // Narrate the first skill-graph route (a decision tree activates exactly
      // one leaf). The matched predicate = the deciding `yes` on the path; for an
      // all-`no` path (the default leaf) there's none → "default" clause. The
      // full path + every route ride the event payload for richer consumers.
      // Model-pick decoration vars (`context.model_pick`) — computed whenever
      // the event carries them; harmless extras for the `context.routed` key.
      const cm = event.payload.cursorMove;
      const pickVars: Record<string, string> = {};
      if (cm?.by === 'model-pick' && cm.to) {
        const offeredCount = cm.offered?.length ?? 0;
        pickVars.to = cm.to;
        pickVars.menuClause =
          cm.declinedOffer !== true && offeredCount > 0
            ? renderCommentary(templates['context.model_pick.menu'] ?? '', {
                offeredCount: String(offeredCount),
              })
            : '';
        pickVars.offMenuClause =
          cm.declinedOffer === true ? templates['context.model_pick.offMenu'] ?? '' : '';
        // "Staying put was offered and declined" is derivable, not invented:
        // the current cursor was ON the menu and the accepted pick left it.
        pickVars.stayClause =
          cm.declinedOffer !== true &&
          cm.from !== undefined &&
          cm.to !== cm.from &&
          (cm.offered ?? []).includes(cm.from)
            ? templates['context.model_pick.stay'] ?? ''
            : '';
      }
      // Start-rule witness vars (`context.entry_witness`) — the hop's own
      // evidence, computed on the same terms the key selection uses. Harmless
      // extras for every other key: an absent witness contributes nothing, so
      // the routed line renders exactly as it always did.
      const witnessedTo = cm?.to;
      const witnessText = cm?.witness?.text ?? '';
      if ((cm?.by === 'entry' || cm?.by === 'rule') && witnessedTo && witnessText.length > 0) {
        pickVars.to = witnessedTo;
        pickVars.witness = witnessText;
      }

      const r = event.payload.routing?.[0];
      if (!r) return { ...base, ...pickVars };
      const toolCount = r.tools?.length ?? 0;
      const toolClause =
        toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? '' : 's'}` : 'no new tools';
      const matchedLabel = r.path?.find((s) => s.branch === 'yes')?.label ?? r.label;
      const matchClause = matchedLabel
        ? renderCommentary(templates['context.routed.matched'] ?? '', { matchedLabel })
        : r.via === 'tree'
        ? templates['context.routed.default'] ?? ''
        : '';
      return { ...base, skillId: r.injectionId, toolClause, matchClause, ...pickVars };
    }

    case 'agentfootprint.skill.turn_routed': {
      const p = event.payload;
      const offeredCount = p.offered?.length ?? 0;
      // The verdict's numbers, rendered ONLY when the event carries them. Raw
      // scores read to 2 decimals; `relevance` is the full-softmax share, so it
      // reads as a percentage. An event without `scores` renders no numbers.
      const scores = p.scores ?? [];
      const fmtScore = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2));
      const fmtShare = (r: number): string => `${Math.round(r * 100)}%`;
      const scoreClause =
        scores.length >= 2
          ? renderCommentary(templates['skill.turn_routed.intent.scored'] ?? '', {
              topScore: fmtScore(scores[0].score),
              runnerUpScore: fmtScore(scores[1].score),
            })
          : scores.length === 1
          ? renderCommentary(templates['skill.turn_routed.intent.scoredSolo'] ?? '', {
              topScore: fmtScore(scores[0].score),
            })
          : '';
      return {
        ...base,
        // Continuity verdicts hold the inherited cursor — when an emitter left
        // `to` off (the cursor didn't move), `from` names where the turn stays.
        to: p.to ?? (p.by === 'continuity' ? p.from ?? '' : ''),
        from: p.from ?? '',
        droppedId: p.droppedResume?.id ?? '',
        scorerClause: p.scorer !== undefined ? ` (judged by the '${p.scorer}' scorer)` : '',
        offeredCount: String(offeredCount),
        offeredPlural: offeredCount === 1 ? '' : 's',
        stayClause: p.stayOffered === true ? ' (including staying put)' : '',
        scoreClause,
        tieA: scores[0]?.id ?? '',
        tieAShare: scores[0] ? fmtShare(scores[0].relevance) : '',
        tieB: scores[1]?.id ?? '',
        tieBShare: scores[1] ? fmtShare(scores[1].relevance) : '',
        candidates: (p.offered ?? []).map((id) => `\`${id}\``).join(', '),
        // The tier-1 matcher's evidence — already bounded + whitespace-collapsed
        // at capture, so the sentence quotes it verbatim.
        witness: p.witness?.text ?? '',
        // The tier-3 decider's identity (9.19.0) — model when named, else
        // the provider (a decider always has at least that).
        deciderModel: p.decider?.model ?? p.decider?.provider ?? '',
      };
    }

    case 'agentfootprint.skill.escalated': {
      const p = event.payload;
      return {
        ...base,
        refusals: String(p.refusals),
        refusalPlural: p.refusals === 1 ? '' : 's',
        fromModel: p.from.model,
        // The escalation brain may inherit its model down the chain (same
        // provider) — the provider name is then the honest identity.
        toModel: p.to.model ?? p.to.provider,
      };
    }

    case 'agentfootprint.tools.effect': {
      const p = event.payload;
      // Both reasons are optional on the payload, so both are clauses: an
      // effect that carried no words says nothing in their place.
      const reason = (p.reason ?? '').trim();
      const refusalReason = (p.refusalReason ?? '').trim();
      return {
        ...base,
        toolName: p.toolName,
        targetSkillId: p.targetSkillId ?? '',
        reason,
        instructionId: p.instructionId ?? '',
        deliveryLease: p.deliveryLease ?? '',
        reasonClause: reason
          ? renderCommentary(templates['tools.effect.reason'] ?? '', { reason })
          : '',
        refusalClause: refusalReason
          ? renderCommentary(templates['tools.effect.refusalReason'] ?? '', { refusalReason })
          : '',
      };
    }

    case 'agentfootprint.tools.result_refused': {
      const p = event.payload;
      const narrowBy = p.narrowBy ?? [];
      const narrowClause =
        narrowBy.length === 0
          ? ''
          : narrowBy.length === 1
          ? renderCommentary(templates['tools.result_refused.narrowOne'] ?? '', {
              narrowBy: narrowBy[0],
            })
          : renderCommentary(templates['tools.result_refused.narrowMany'] ?? '', {
              narrowBy: narrowBy.map((n) => `\`${n}\``).join(' or '),
            });
      return {
        ...base,
        toolName: p.toolName,
        size: humanizeChars(p.sizeChars),
        limit: humanizeChars(p.maxChars),
        narrowClause,
      };
    }

    case 'agentfootprint.tools.repeated_call': {
      const p = event.payload;
      // The fingerprints stay off the prose deliberately — they answer "is this
      // the same?" and a reader already has that answer in the sentence.
      return { ...base, toolName: p.toolName, occurrences: String(p.occurrences) };
    }

    case 'agentfootprint.artifacts.minted': {
      const p = event.payload;
      const label = (p.label ?? '').trim();
      const size = humanizeBytes(p.bytes);
      const subject = label
        ? renderCommentary(templates['artifacts.minted.subject.labeled'] ?? '', {
            label,
            kind: p.kind,
            size,
          })
        : renderCommentary(templates['artifacts.minted.subject.plain'] ?? '', {
            kind: p.kind,
            size,
          });
      const parentCount = p.parentRefs?.length ?? 0;
      return {
        ...base,
        tool: p.tool ?? '',
        actor: artifactActor(p.tool, templates),
        kind: p.kind,
        size,
        subject,
        derivedClause:
          parentCount > 0
            ? renderCommentary(templates['artifacts.minted.derived'] ?? '', {
                parentCount: String(parentCount),
                parentPlural: parentCount === 1 ? '' : 's',
              })
            : '',
      };
    }

    case 'agentfootprint.artifacts.presented': {
      const p = event.payload;
      const label = (p.snapshot.label ?? '').trim();
      const size = humanizeBytes(p.snapshot.bytes);
      const subject = label
        ? renderCommentary(templates['artifacts.presented.subject.labeled'] ?? '', {
            label,
            kind: p.snapshot.kind,
            size,
          })
        : renderCommentary(templates['artifacts.presented.subject.plain'] ?? '', {
            kind: p.snapshot.kind,
            size,
          });
      // `as` is the model's own consumer vocabulary, stored as data — rendered
      // exactly as spoken, never normalized into a word we prefer.
      return { ...base, subject, as: p.as, kind: p.snapshot.kind, size };
    }

    case 'agentfootprint.artifacts.resolved': {
      const p = event.payload;
      return {
        ...base,
        actor: artifactActor(p.tool, templates),
        kind: p.kind,
        size: humanizeBytes(p.bytes),
      };
    }

    case 'agentfootprint.artifacts.refused': {
      const p = event.payload;
      // `detail` (the thrown refusal sentence) stays out of prose on purpose:
      // it is an error string, and error strings are the one place a secret has
      // ever ridden into a log. The typed `reason` says enough to act on.
      return {
        ...base,
        actor: artifactActor(p.tool, templates),
        tool: p.tool ?? '',
        opPhrase: phraseFor(ARTIFACT_OP_PHRASES, p.op, 'an artifact request'),
        reasonPhrase: phraseFor(
          ARTIFACT_REFUSAL_PHRASES,
          p.reason,
          'the store did not say why in words this build knows',
        ),
      };
    }

    case 'agentfootprint.artifacts.hand_over_failed': {
      const p = event.payload;
      return {
        ...base,
        causePhrase: phraseFor(
          HAND_OVER_FAILURE_PHRASES,
          p.cause,
          'failed for a reason this build does not have words for',
        ),
        opClause:
          p.op !== undefined
            ? renderCommentary(templates['artifacts.hand_over_failed.op'] ?? '', {
                opPhrase: phraseFor(ARTIFACT_OP_PHRASES, p.op, 'an artifact request'),
              })
            : '',
      };
    }

    case 'agentfootprint.artifacts.expired': {
      const p = event.payload;
      const tool = (p.tool ?? '').trim();
      return {
        ...base,
        kind: p.kind,
        size: humanizeBytes(p.bytes),
        reasonPhrase: phraseFor(
          ARTIFACT_SWEEP_PHRASES,
          p.reason,
          'for a reason this build does not have words for',
        ),
        noticedClause: tool
          ? renderCommentary(templates['artifacts.expired.noticed'] ?? '', { tool })
          : '',
      };
    }

    case 'agentfootprint.skill.route_conflict': {
      const p = event.payload;
      const losers = p.losers ?? [];
      const loserList = losers.map((l) => `\`${l.toolName}\` → \`${l.target}\``).join(' and ');
      // The head counts EVERY result in the conflict (winner + losers) — a
      // 3-result batch says "Three", never a hard-coded "Two". An event that
      // lists no losers can only honestly say "Multiple" (a conflict implies
      // more than one result by definition; the emitter always lists them).
      const count = losers.length + 1;
      const conflictCount =
        losers.length === 0
          ? 'Multiple'
          : count < CONFLICT_COUNT_WORDS.length
          ? CONFLICT_COUNT_WORDS[count]
          : String(count);
      // Pre-rendered was/were clause so the outer key never has to split.
      const losersClause =
        losers.length === 0
          ? ''
          : renderCommentary(
              templates[
                losers.length === 1
                  ? 'skill.route_conflict.suppressedOne'
                  : 'skill.route_conflict.suppressedMany'
              ] ?? '',
              { losers: loserList },
            );
      return {
        ...base,
        conflictCount,
        winnerTool: p.winner.toolName,
        winnerTarget: p.winner.target,
        losersClause,
      };
    }

    case 'agentfootprint.skill.rejected':
      return {
        ...base,
        requestedId: event.payload.requestedId,
        currentSkillId: event.payload.currentSkillId ?? '',
      };

    case 'agentfootprint.cost.limit_hit': {
      const p = event.payload;
      // The sentence has to say whether the run STOPPED, and only `action`
      // knows: a `costBudget` may warn or halt, and `max_iterations` always
      // stops. Pre-rendered here as a clause so the template stays one flat
      // key that a consumer's existing override still resolves.
      const outcome =
        p.action === 'abort'
          ? templates['cost.limit_hit.stopped'] ?? ''
          : templates['cost.limit_hit.continued'] ?? '';
      const limitNoun =
        p.kind === 'max_iterations'
          ? 'iteration limit'
          : p.kind === 'max_cost'
          ? 'cost limit'
          : p.kind === 'max_tokens'
          ? 'token limit'
          : 'time limit';
      return {
        ...base,
        limitNoun,
        limit: String(p.limit),
        actual: String(p.actual),
        outcome,
      };
    }

    // Most templates only need {{appName}} / {{agentName}} — no token
    // counts, no IDs, no durations make it into prose. Those live in
    // DETAILS.
    default:
      return base;
  }
}
