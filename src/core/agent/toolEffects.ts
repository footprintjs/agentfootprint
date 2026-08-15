/**
 * toolEffects — the typed tool-effects channel (9.19.0). ONE owner of the
 * result-envelope grammar: the two effect kinds, the outcome-status
 * vocabulary, the envelope recognizer, and the instruction-lease shapes.
 *
 * THE LAW this module implements: *push mandatory procedure; pull optional
 * knowledge; never let arbitrary text promote itself into control authority.*
 * Before this channel, a tool that wanted to steer the run had exactly one
 * medium — its result STRING — and any convention riding it ("ROUTE:billing")
 * was arbitrary text one prompt-injection away from control authority. The
 * envelope replaces the convention with DATA the framework validates:
 *
 *   • `propose-transition` — the typed replacement for string routing
 *     markers. The GRAPH decides: an accepted proposal moves the cursor like
 *     a declared edge (a same-batch declared edge still wins — the
 *     `reroute_superseded` precedent), a refusal is teaching and recorded.
 *     Proposals come from TOOLS — deterministic code the author shipped — so
 *     they are framework-tier evidence: admitted under every posture
 *     (`assist`/`guard`/`rails`), but always reachability-checked against
 *     the graph's own law. An unreachable target is refused, out loud.
 *
 *   • `require-instruction` — pushes a REGISTERED instruction (a skill body
 *     or a declared snippet) into the next iteration(s) per a delivery
 *     lease. `read_skill` stays the pull door; this is the push door, and it
 *     can only push what was registered at build — an unknown id is refused,
 *     never improvised.
 *
 * Beside the effects rides an optional `status` — the outcome-status
 * normalization: `'denied'` must never route like `'success'`, so route
 * edges can key on MEANING (`onToolStatus`) instead of parsing prose.
 *
 * RECOGNITION IS STRICT, and the strictness is the zero-cost guarantee.
 * A value is an envelope iff it is a plain object whose keys are a subset of
 * `{ content, effects, status }`, `content` is present, `effects` is an
 * array, and EVERY element carries one of the two known `kind`s (an empty
 * `effects: []` needs a valid `status` to say anything at all). Everything
 * else — every shape any tool has ever returned — takes the exact path it
 * always took, byte for byte. The two `kind` strings are therefore RESERVED
 * vocabulary on the tool-result wire; a recognized envelope whose fields are
 * malformed is refused teachingly (recorded), never half-applied.
 */

// ─── The outcome-status vocabulary ─────────────────────────────────────

/**
 * The outcome words, re-exported under the names they have always had.
 *
 * They are DECLARED in `lib/injection-engine/toolOutcome.ts` (9.34.0) — a
 * zero-import leaf — because a skill-graph route edge keys on them
 * (`onToolStatus`) and `InjectionContext.toolResults[].status` is typed by
 * them. Leaving the declaration here meant the graph's own context type
 * reached into the agent loop for one string union, which points the
 * dependency backwards: the loop depends on the graph, never the reverse.
 *
 * This module remains the owner of the ENVELOPE grammar below — the two
 * effect kinds, the recognizer, the lease shapes — all of which are
 * genuinely loop-side. Only the vocabulary moved down.
 */
export type { ToolResultStatus } from '../../lib/injection-engine/toolOutcome.js';
export { TOOL_RESULT_STATUSES } from '../../lib/injection-engine/toolOutcome.js';

import type { ToolResultStatus } from '../../lib/injection-engine/toolOutcome.js';
import { TOOL_RESULT_STATUSES } from '../../lib/injection-engine/toolOutcome.js';

// ─── The two effect kinds ──────────────────────────────────────────────

/** A tool proposes moving the skill-graph cursor. The graph decides. */
export interface ProposeTransitionEffect {
  readonly kind: 'propose-transition';
  /** The skill node to move to. Reachability-checked against the graph's
   *  own law (`reachableSkills(cursor)`); unreachable = teaching refusal. */
  readonly targetSkillId: string;
  /** Why — goes on the record (`tools.effect`), never optional: a routing
   *  proposal with no reason is exactly the arbitrary authority this
   *  channel exists to replace. */
  readonly reason: string;
}

/** How long a pushed instruction stays delivered. */
export type InstructionDeliveryLease = 'next-call' | 'until-skill-exit';

/** A tool pushes a registered instruction into the coming iteration(s). */
export interface RequireInstructionEffect {
  readonly kind: 'require-instruction';
  /** A REGISTERED injection id (a skill or an instruction). Unknown ids are
   *  refused teachingly — the push door serves the declared catalog only. */
  readonly instructionId: string;
  /** `'next-call'` — exactly the next LLM call; `'until-skill-exit'` — every
   *  call while the tenure that granted it holds (the skill the cursor was
   *  on when the tool returned). */
  readonly deliveryLease: InstructionDeliveryLease;
}

/** The typed effects a tool result may carry. Two kinds — deliberately. */
export type ProposedEffect = ProposeTransitionEffect | RequireInstructionEffect;

/**
 * What a tool handler returns to opt into the channel:
 * `{ content, effects, status? }`. `content` is what the model reads (any
 * value — strings pass through, objects stringify exactly as a bare return
 * would). Returning anything else keeps today's path, byte for byte.
 *
 * `effects` is REQUIRED — it is the envelope marker itself. The recognizer
 * refuses to treat a value without an `effects` array as an envelope (that
 * strictness IS the zero-cost guarantee: `{ content, status: 'success' }`
 * is a shape a domain object could already have), so the type says exactly
 * what the recognizer accepts. Status-only is spelled `effects: []` — the
 * explicit marker when only `status` matters.
 */
export interface ToolResultEnvelope {
  readonly content: unknown;
  readonly effects: readonly ProposedEffect[];
  readonly status?: ToolResultStatus;
}

// ─── Recognition + validation ──────────────────────────────────────────

const ENVELOPE_KEYS = new Set(['content', 'effects', 'status']);
const EFFECT_KINDS = new Set(['propose-transition', 'require-instruction']);

/** A recognized envelope, read: content unwrapped, VALID effects listed,
 *  malformed ones named (one teaching entry per bad effect). */
export interface ReadToolResultEnvelope {
  readonly content: unknown;
  readonly effects: readonly ProposedEffect[];
  readonly status?: ToolResultStatus;
  /** Effects that carried a known `kind` with malformed fields — refused
   *  loudly (recorded + a teaching sentence), never half-applied. */
  readonly malformed: ReadonlyArray<{
    readonly kind: ProposedEffect['kind'];
    readonly refusalReason: string;
  }>;
}

function isToolResultStatus(v: unknown): v is ToolResultStatus {
  return typeof v === 'string' && (TOOL_RESULT_STATUSES as readonly string[]).includes(v);
}

/**
 * Recognize (or decline to recognize) a tool's return value as an effects
 * envelope. `undefined` = not an envelope: the caller keeps today's path
 * untouched. See the module header for the exact recognition rule and why
 * it is strict.
 */
export function readToolResultEnvelope(result: unknown): ReadToolResultEnvelope | undefined {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.every((k) => ENVELOPE_KEYS.has(k))) return undefined;
  if (!('content' in record)) return undefined;
  const rawEffects = record.effects;
  if (!Array.isArray(rawEffects)) return undefined;
  // Every element must speak the reserved vocabulary, or the whole value is
  // data (a domain object that happens to have an `effects` array must keep
  // its bytes). An EMPTY effects array is an envelope only when the status
  // says something — `{ content, effects: [] }` alone declares nothing.
  const allKnownKinds = rawEffects.every(
    (e) =>
      typeof e === 'object' &&
      e !== null &&
      EFFECT_KINDS.has((e as { kind?: unknown }).kind as string),
  );
  if (!allKnownKinds) return undefined;
  const status = record.status;
  if (status !== undefined && !isToolResultStatus(status)) return undefined;
  if (rawEffects.length === 0 && status === undefined) return undefined;

  const effects: ProposedEffect[] = [];
  const malformed: Array<{ kind: ProposedEffect['kind']; refusalReason: string }> = [];
  rawEffects.forEach((raw, i) => {
    const e = raw as Record<string, unknown>;
    const n = i + 1;
    if (e.kind === 'propose-transition') {
      if (typeof e.targetSkillId !== 'string' || e.targetSkillId.trim().length === 0) {
        malformed.push({
          kind: 'propose-transition',
          refusalReason:
            `effect ${n} (propose-transition) names no targetSkillId — the proposal was ` +
            `refused. A transition proposal is { kind: 'propose-transition', targetSkillId, ` +
            `reason }.`,
        });
        return;
      }
      if (typeof e.reason !== 'string' || e.reason.trim().length === 0) {
        malformed.push({
          kind: 'propose-transition',
          refusalReason:
            `effect ${n} (propose-transition → '${String(e.targetSkillId)}') carries no ` +
            `reason — refused. The reason goes on the record; a routing proposal without ` +
            `one is the arbitrary authority this channel replaces.`,
        });
        return;
      }
      effects.push({
        kind: 'propose-transition',
        targetSkillId: e.targetSkillId,
        reason: e.reason,
      });
      return;
    }
    // require-instruction
    if (typeof e.instructionId !== 'string' || e.instructionId.trim().length === 0) {
      malformed.push({
        kind: 'require-instruction',
        refusalReason:
          `effect ${n} (require-instruction) names no instructionId — refused. It is ` +
          `{ kind: 'require-instruction', instructionId, deliveryLease: 'next-call' | ` +
          `'until-skill-exit' }.`,
      });
      return;
    }
    if (e.deliveryLease !== 'next-call' && e.deliveryLease !== 'until-skill-exit') {
      malformed.push({
        kind: 'require-instruction',
        refusalReason:
          `effect ${n} (require-instruction '${String(e.instructionId)}') has deliveryLease ` +
          `'${String(e.deliveryLease)}', which is not a lease this library has — refused. ` +
          `The two are 'next-call' (exactly the next LLM call) and 'until-skill-exit' ` +
          `(every call while the granting tenure holds).`,
      });
      return;
    }
    effects.push({
      kind: 'require-instruction',
      instructionId: e.instructionId,
      deliveryLease: e.deliveryLease,
    });
  });

  return {
    content: record.content,
    effects,
    ...(status !== undefined && { status: status as ToolResultStatus }),
    malformed,
  };
}

/**
 * Name the ONE near-miss a tool author is likeliest to write: a status-only
 * envelope with the `effects` marker left off — `{ content, status: 'denied' }`.
 * That shape is NOT an envelope (recognition demands the `effects` array;
 * see `ToolResultEnvelope`), and it stays data byte-for-byte — but a value
 * whose only keys are envelope keys AND whose `status` speaks the closed
 * outcome vocabulary is far more likely a dropped `effects: []` than a
 * coincidence, and letting it route like an undeclared result with no word
 * of why would be accepted-and-silently-wrong. Returns the teaching sentence
 * for the caller's dev-mode warning; `undefined` for every other value.
 * Diagnosis only — never changes what any value does.
 */
export function explainStatusOnlyNearMiss(result: unknown): string | undefined {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  const keys = Object.keys(record);
  if (!keys.every((k) => ENVELOPE_KEYS.has(k))) return undefined;
  if (!('content' in record) || 'effects' in record) return undefined;
  if (!isToolResultStatus(record.status)) return undefined;
  return (
    `the result { content, status: '${record.status}' } looks like a status-only ` +
    `envelope missing its marker — an envelope REQUIRES the effects array, so this ` +
    `value was treated as data: the status was not recorded and no onToolStatus edge ` +
    `can fire on it. Opt in with { content, effects: [], status: '${record.status}' }, ` +
    `or rename the keys if this is a domain object.`
  );
}

// ─── The accepted-proposal + lease carriers (scope state shapes) ────────

/**
 * The transition proposal the tool-calls stage ACCEPTED this iteration —
 * validated (graph mounted, target reachable), first-accepted-wins across
 * the batch. One-shot BY DATA, not by clearing writes: it is stamped with
 * the iteration that granted it, and the Evaluate stage honors it exactly
 * once — on the following iteration — so nothing ever has to write the key
 * back to undefined (zero-cost stays zero for agents that never see one).
 */
export interface PendingToolTransition {
  readonly targetSkillId: string;
  /** The proposing tool — provenance for the record. */
  readonly toolName: string;
  readonly toolCallId?: string;
  /** The effect's own declared reason. */
  readonly reason: string;
  /** The ReAct iteration whose batch granted it (valid for iteration + 1). */
  readonly iteration: number;
}

/**
 * One granted `require-instruction` lease. Validity is COMPUTED, never
 * mutated: `'next-call'` serves exactly the Evaluate pass of
 * `iteration + 1`; `'until-skill-exit'` serves every pass while the tenant
 * that granted it (`skillId`) still holds the tenure.
 *
 * Death is PERMANENT, and the Evaluate tenure sweep is what makes it so:
 * `skillId === tenant` alone cannot tell "still holding the tenure" from
 * "re-entered the skill later" (a cyclic graph makes both real), so the
 * Evaluate stage prunes dead leases on EVERY pass — the same pass a tenure
 * ends, the leases it granted leave the record, and a cursor that comes back
 * finds nothing to resurrect. The tool-calls stage also prunes when it
 * appends a new grant (keeps mid-batch arrays tight), but the sweep is the
 * law's owner: it runs whether or not anything new was granted.
 */
export interface InstructionLease {
  readonly instructionId: string;
  readonly deliveryLease: InstructionDeliveryLease;
  /** The tenure that granted it (advanced cursor, else the activation tail);
   *  absent when no tenant existed at grant. `'until-skill-exit'` compares
   *  the CURRENT tenant against this — both-undefined still matches. */
  readonly skillId?: string;
  /** The granting tool — provenance for the record. */
  readonly toolName: string;
  readonly toolCallId?: string;
  /** The ReAct iteration whose batch granted it. */
  readonly iteration: number;
}

/** Who holds the tenure — the advanced cursor on graph agents, else the tail
 *  of `activatedInjectionIds` (the shipped `activeSkillId` notion the step
 *  pointer's re-key already uses). */
export function tenantOf(
  cursor: string | undefined,
  activatedInjectionIds: readonly string[] | undefined,
): string | undefined {
  if (cursor !== undefined) return cursor;
  const activated = activatedInjectionIds ?? [];
  return activated[activated.length - 1];
}

/**
 * The lease-served injection ids for ONE Evaluate pass — pure. `iteration`
 * is the pass being composed; `tenant` is who holds the tenure on it (the
 * ADVANCED cursor — a lease dies the same pass its tenure ends).
 *
 * `skillId === tenant` is a sound "tenure still holds" test ONLY because the
 * Evaluate tenure sweep (`pruneLeases`, every pass) removes a dead lease the
 * pass its tenure ends — so a cursor that re-enters the granting skill later
 * finds nothing to match, instead of resurrecting an ended grant.
 */
export function activeLeaseIds(
  leases: readonly InstructionLease[] | undefined,
  iteration: number,
  tenant: string | undefined,
): readonly string[] {
  if (leases === undefined || leases.length === 0) return [];
  const ids: string[] = [];
  for (const lease of leases) {
    const live =
      lease.deliveryLease === 'next-call'
        ? lease.iteration + 1 === iteration
        : lease.skillId === tenant;
    if (live && !ids.includes(lease.instructionId)) ids.push(lease.instructionId);
  }
  return ids;
}

/**
 * Drop leases that can never serve again. `iteration` is the CURRENT pass;
 * a `'next-call'` lease older than the previous iteration is spent, and an
 * `'until-skill-exit'` lease whose tenant is no longer current is dead.
 *
 * TWO call sites, one law. The Evaluate stage sweeps on EVERY pass (writing
 * the survivors under `nextInstructionLeases`, the cursor's alias round
 * trip) — that sweep is what makes death permanent: it records the death the
 * same pass the tenure ends, before any later pass could see the cursor
 * re-enter the granting skill and mistake re-entry for an unbroken tenure.
 * The tool-calls stage also prunes when it appends a new grant, so a
 * mid-batch array never carries spent leases into the commit.
 */
export function pruneLeases(
  leases: readonly InstructionLease[] | undefined,
  iteration: number,
  currentTenant: string | undefined,
): readonly InstructionLease[] {
  if (leases === undefined || leases.length === 0) return [];
  return leases.filter((lease) =>
    lease.deliveryLease === 'next-call'
      ? lease.iteration + 1 > iteration
      : lease.skillId === currentTenant,
  );
}
