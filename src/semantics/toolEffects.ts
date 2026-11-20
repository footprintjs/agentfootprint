/**
 * toolEffects — the typed tool-effects channel (9.19.0). ONE owner of the
 * result-envelope grammar: the two effect kinds, the outcome-status
 * vocabulary and the envelope recognizer. (The instruction-lease carriers a
 * granted `require-instruction` effect becomes are `injection-engine/leases.ts`.)
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
 * `effects: []` needs a valid `status` to say anything at all; the word is
 * read by `toolOutcome.ts` · `readToolResultStatus`, so `'FAILURE'` and
 * `' failure '` both name `'failure'`). Everything
 * else — every shape any tool has ever returned — takes the exact path it
 * always took, byte for byte. The two `kind` strings are therefore RESERVED
 * vocabulary on the tool-result wire; a recognized envelope whose fields are
 * malformed is refused teachingly (recorded), never half-applied.
 */

// ─── The outcome-status vocabulary ─────────────────────────────────────

/**
 * The outcome words, re-exported under the names they have always had.
 *
 * They are DECLARED in `semantics/toolOutcome.ts` (9.34.0) — a
 * zero-import leaf — because a skill-graph route edge keys on them
 * (`onToolStatus`) and `InjectionContext.toolResults[].status` is typed by
 * them. Leaving the declaration here meant the graph's own context type
 * reached into the agent loop for one string union, which points the
 * dependency backwards: the loop depends on the graph, never the reverse.
 *
 * This module remains the owner of the ENVELOPE grammar below — the two
 * effect kinds and the recognizer. Only the vocabulary moved down; the lease
 * carriers live with their reader, `injection-engine/leases.ts`.
 */
export type { ToolResultStatus } from './toolOutcome.js';
export { TOOL_RESULT_STATUSES } from './toolOutcome.js';

import type { ToolResultStatus } from './toolOutcome.js';
import { readToolResultStatus, TOOL_RESULT_STATUSES } from './toolOutcome.js';
import { plainLineOf } from '../lib/plainLine.js';

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

/**
 * The envelope's SHAPE, everything but the status word: a plain object whose
 * keys are envelope keys, with `content`, and an `effects` array whose every
 * element names a known `kind`. One check, read by the recognizer and by
 * `unknownStatusOf`, so "an envelope but for its status" means exactly that.
 */
function envelopeShaped(result: unknown): Record<string, unknown> | undefined {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  if (!Object.keys(record).every((k) => ENVELOPE_KEYS.has(k))) return undefined;
  if (!('content' in record)) return undefined;
  const rawEffects = record.effects;
  if (!Array.isArray(rawEffects)) return undefined;
  // Every element must speak the reserved vocabulary, or the whole value is
  // data (a domain object that happens to have an `effects` array must keep
  // its bytes).
  const allKnownKinds = rawEffects.every(
    (e) =>
      typeof e === 'object' &&
      e !== null &&
      EFFECT_KINDS.has((e as { kind?: unknown }).kind as string),
  );
  return allKnownKinds ? record : undefined;
}

/**
 * Recognize (or decline to recognize) a tool's return value as an effects
 * envelope. `undefined` = not an envelope: the caller keeps today's path
 * untouched. See the module header for the exact recognition rule and why
 * it is strict.
 */
export function readToolResultEnvelope(result: unknown): ReadToolResultEnvelope | undefined {
  const record = envelopeShaped(result);
  if (record === undefined) return undefined;
  const rawEffects = record.effects as readonly unknown[];
  // The status word is read once (`toolOutcome.ts` · `readToolResultStatus`):
  // 'FAILURE' or ' failure ' is 'failure'; a word that names none of the
  // seven makes the whole value data. An EMPTY effects array is an envelope
  // only when the status says something — `{ content, effects: [] }` alone
  // declares nothing.
  const status = record.status === undefined ? undefined : readToolResultStatus(record.status);
  if (record.status !== undefined && status === undefined) return undefined;
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
    ...(status !== undefined && { status }),
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
  const status = readToolResultStatus(record.status);
  if (status === undefined) return undefined;
  return (
    `the result { content, status: '${status}' } looks like a status-only ` +
    `envelope missing its marker — an envelope REQUIRES the effects array, so this ` +
    `value was treated as data: the status was not recorded and no onToolStatus edge ` +
    `can fire on it. Opt in with { content, effects: [], status: '${status}' }, ` +
    `or rename the keys if this is a domain object.`
  );
}

/** The seven words as a sentence fragment, for the warning below. */
const TOOL_RESULT_STATUSES_TEXT = TOOL_RESULT_STATUSES.map((w) => `'${w}'`).join(', ');

/** The longest unknown status word told back, in characters; longer is cut. */
const MAX_UNKNOWN_STATUS_CHARS = 40;

/**
 * The status word of a value that is an envelope in every way but its
 * status — the envelope keys, `content`, a well-formed `effects` array (the
 * marker), and a `status` that names none of the seven words — cleaned for
 * quoting (`lib/plainLine.ts` · `plainLineOf`: no control, separator or
 * invisible format character, at most 40 characters). `undefined` for every
 * other value, including a real envelope and a value with no marker.
 *
 * Why: such a value is data (the recognizer's law is unchanged), so the call
 * declared no status — but its tool plainly tried to, and a procedure step
 * that advanced on it must not tell the model "no status" as if the tool had
 * said nothing. The step names the word instead (`skill.step_advanced`
 * `unknownStatus`, and the step sentence). The marker is required for the
 * same reason the recognizer requires it: `{ content, status: 'draft' }` is
 * a shape a domain object can have.
 *
 * Diagnosis only — never changes what any value does.
 *
 * @example unknownStatusOf({ content: 'x', effects: [], status: 'oops' })   // 'oops'
 * @example unknownStatusOf({ content: 'x', effects: [], status: 'FAILURE' }) // undefined (a known word)
 */
export function unknownStatusOf(result: unknown): string | undefined {
  const record = envelopeShaped(result);
  if (record === undefined) return undefined;
  const raw = record.status;
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean')
    return undefined;
  if (readToolResultStatus(raw) !== undefined) return undefined;
  const word = plainLineOf(String(raw), MAX_UNKNOWN_STATUS_CHARS);
  return word.length > 0 ? word : undefined;
}

/**
 * The dev-mode teaching sentence for a word `unknownStatusOf` returned —
 * beside `explainStatusOnlyNearMiss`, for the near-miss that does carry the
 * marker. Diagnosis only.
 */
export function unknownStatusWarning(word: string): string {
  return (
    `the result is an effects envelope in every way but its status ${JSON.stringify(word)}, ` +
    `which is not one of the seven status words (${TOOL_RESULT_STATUSES_TEXT}) — so this ` +
    `value was treated as data: no status was recorded, no onToolStatus edge can fire on ` +
    `it, and a procedure step it ran advanced without being held.`
  );
}
