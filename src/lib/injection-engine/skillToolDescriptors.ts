/**
 * skillToolDescriptors — the graph DESCRIBING the tools it needs (9.34.0).
 *
 * `read_skill` is not an ordinary tool. It is how the model asks to move the
 * skill-graph cursor: its enum is the catalog, its description is the offer
 * (what is reachable from here, what will be refused, what this turn's menu
 * proposes), and its result is what the model reads about the skill it just
 * activated. Every one of those sentences is the GRAPH's to write.
 *
 * What the graph must NOT do is construct a framework's tool object. That is
 * why this module produces {@link SkillToolDescriptor} POJOs — name,
 * description, input schema, a pure `execute` — and `skillTools.ts` (the host
 * adapter) is the one line that turns each into an agentfootprint `Tool` with
 * `defineTool`. A host on another framework calls the same functions and
 * wraps the result in its own tool type instead.
 *
 * ONE catalog, ONE grammar: the Agent's auto-attach path, `SkillRegistry`
 * and any foreign host all read the descriptions from here, so they cannot
 * drift the way a second hand-written `read_skill` would.
 *
 * Zone: PURE CORE. Pinned by
 * `test/lib/injection-engine/skill-graph-fence.test.ts`.
 */

import type { SkillToolDescriptor } from './hostContract.js';
import type { Injection } from './types.js';

/**
 * What the gate will ACTUALLY grant right now — the ids `read_skill` should be
 * offering, as opposed to the ids it can dispatch (8.5.0).
 *
 * Without this the tool enumerated every registered skill while the skill-graph gate
 * admitted only `reachableSkills(cursor) ∪ open`, so a route target the cursor cannot
 * reach was advertised on every iteration and refused on every call. The model was
 * being asked to choose from a menu the library knew it would reject.
 */
export interface ReadSkillOffer {
  /**
   * Ids the gate will grant from the current cursor. Omit when there is no
   * graph — then the description is the plain catalog it has always been,
   * minus anything {@link ReadSkillOffer.hiddenIds} removes.
   */
  readonly grantable?: readonly string[];
  /** Say the rest are refusable rather than hiding them. Hiding a skill it can see
   *  in `list_skills` (and in the enum) would just move the confusion; naming the
   *  boundary lets the model route around it in one step instead of guessing. */
  readonly showRefusable?: boolean;
  /**
   * Ids removed from the description ENTIRELY — not listed as reachable, not
   * listed as refusable, not named at all (9.11.0).
   *
   * The opposite treatment from the graph's `shut` set above, and deliberately
   * so. A graph refusal is about WHERE THE CURSOR IS: the skill exists for this
   * caller, it is simply not reachable from here, so naming it lets the model
   * route to it in one step. A hidden skill is about WHO IS ASKING: no cursor
   * move makes it available, and naming it would tell a role about a capability
   * it will never be allowed to use — leaking the shape of somebody else's
   * permissions into this model's prompt.
   *
   * The ENUM keeps the full catalog either way (see below). Narrowing it would
   * turn a policy refusal into a generic schema error, and the model would
   * never read the policy's own message.
   */
  readonly hiddenIds?: readonly string[];
  /**
   * Turn-start MENU (SG-C): when set, the description LEADS with these
   * candidates (id + one-line description; advisory relevance %s beside
   * near-tie candidates), names the cursor, and states STAY as a first-class
   * option ("answer without calling read_skill to stay in '<cursor>'").
   *
   * Set only while the turn's menu verdict is outstanding (turn start, before
   * any accepted pick) — the tools slot reads it off the SAME verdict the
   * record carries, so the offer can never drift from `turn_routed.offered`.
   * The enum stays the full catalog (the 8.5.0 law below — narrowing it would
   * retire four honesty mechanisms), and {@link ReadSkillOffer.hiddenIds}
   * filters menu rows exactly as it filters every other list: a role-hidden
   * skill is never NAMED, menu or no menu.
   */
  readonly menu?: {
    readonly candidates: ReadonlyArray<{ readonly id: string; readonly relevance?: number }>;
    /** Names the cursor the STAY sentence refers to ("you are in billing"). */
    readonly cursorId?: string;
    /** STAY spelled out as a first-class option (mid-conversation menus). */
    readonly stay?: boolean;
  };
}

/** Compose the tool description: one catalog, or the offer split in two. */
function describeOffer(
  allSkills: readonly Injection[],
  line: (s: Injection) => string,
  fullCatalog: string,
  offer?: ReadSkillOffer,
): string {
  const tail =
    `Pass the skill's id. The skill's body becomes part of the system prompt and any ` +
    `gated tools become available on the next call.`;
  if (!offer) {
    return `Activate a skill for the next iteration. Available skills:\n${fullCatalog}\n\n${tail}`;
  }
  // Hidden first, so nothing below can name one — the menu, the graph split,
  // the "not reachable" list and the plain catalog all read from this.
  const hidden = new Set(offer.hiddenIds ?? []);
  const skills = hidden.size > 0 ? allSkills.filter((s) => !hidden.has(s.id)) : allSkills;
  // The turn-start MENU leads (SG-C) — rendered from the turn verdict, ids
  // resolved against the (hidden-filtered) catalog so an id this description
  // may not name, or one that is not a skill here, is silently skipped rather
  // than fabricated into a row.
  const byId = new Map(skills.map((s) => [s.id, s] as const));
  const menuRows = (offer.menu?.candidates ?? [])
    .filter((c) => byId.has(c.id))
    .map((c) => {
      const pct =
        c.relevance !== undefined ? ` (relevance ~${Math.round(c.relevance * 100)}%)` : '';
      return `${line(byId.get(c.id)!)}${pct}`;
    });
  const menuLead =
    offer.menu !== undefined && menuRows.length > 0
      ? `This turn needs a routing choice — no declared rule or intent decisively matched. ` +
        `Closest candidates (advisory; an offline scorer ranked them and cannot see the ` +
        `conversation):\n${menuRows.join('\n')}\n` +
        (offer.menu.stay === true && offer.menu.cursorId !== undefined
          ? `You are in '${offer.menu.cursorId}'. Staying is a first-class option: answer ` +
            `WITHOUT calling read_skill to stay in '${offer.menu.cursorId}'.\n\n`
          : `Answering WITHOUT calling read_skill is also allowed.\n\n`)
      : '';
  if (offer.grantable === undefined) {
    // No graph — the plain catalog, filtered. A role with nothing left is told
    // plainly rather than handed an empty list to interpret.
    return skills.length === 0
      ? `Activate a skill for the next iteration. No skills are available to you — ` +
          `answer without one, or say what you are unable to do.\n\n${tail}`
      : `${menuLead}Activate a skill for the next iteration. Available skills:\n${skills
          .map(line)
          .join('\n')}\n\n${tail}`;
  }
  const grantable = new Set(offer.grantable);
  const open = skills.filter((s) => grantable.has(s.id));
  const shut = skills.filter((s) => !grantable.has(s.id));
  const parts = [
    open.length > 0
      ? `Reachable from here:\n${open.map(line).join('\n')}`
      : 'Nothing is reachable from here — answer with the skill you are in, or finish.',
  ];
  if (offer.showRefusable !== false && shut.length > 0) {
    parts.push(
      `Not reachable from here (read_skill for these will be refused):\n${shut
        .map(line)
        .join('\n')}`,
    );
  }
  return `${menuLead}Activate a skill for the next iteration.\n\n${parts.join('\n\n')}\n\n${tail}`;
}

/**
 * Describe the `list_skills` tool — a no-arg tool that returns the registered
 * skills as `{ id, description }[]`. Lets the LLM discover skills without
 * paying the prompt-token cost of embedding the catalog into every system
 * prompt.
 *
 * Pairs with {@link readSkillDescriptor} (which actually activates a skill by
 * id). Returns `undefined` when there are no skills — a tool offering an
 * empty catalog is noise.
 */
export function listSkillsDescriptor(
  skills: readonly Injection[],
): SkillToolDescriptor<Record<string, never>, string> | undefined {
  if (skills.length === 0) return undefined;

  // Capture a stable snapshot — the registry/agent calls this at
  // build time, so the tool reflects the catalog as of registration.
  const catalog = skills.map((s) => ({
    id: s.id,
    description: s.description ?? '(no description)',
  }));

  return {
    name: 'list_skills',
    description:
      'List all available skills with their ids and descriptions. ' +
      'Use this to discover what skills exist before calling read_skill.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => {
      // Return as a JSON-serialized string so the LLM can parse easily.
      return JSON.stringify(catalog, null, 2);
    },
  };
}

/**
 * Describe the `read_skill` tool — THE cursor door. The LLM picks WHICH skill
 * via the `id` argument; the host's loop is what turns an accepted pick into a
 * cursor move (see `SkillGraphHost`, obligations 2 and 3).
 *
 * `execute` returns a confirmation string, or the skill body verbatim for the
 * `'tool-only'` / `'both'` surface modes (recency-first delivery). The actual
 * bookkeeping — appending the requested id to the activated set, gating it
 * against `reachableSkills`, publishing the accepted pick — is the HOST's,
 * because only the host sees the tool call.
 *
 * Pass `offer` to scope the DESCRIPTION to what the graph's gate will actually
 * grant from the current cursor (8.5.0); the enum stays the full catalog
 * either way. Omit it and the description is byte-identical to the plain
 * catalog it has always been.
 *
 * Returns `undefined` when there are no skills.
 */
export function readSkillDescriptor(
  skills: readonly Injection[],
  offer?: ReadSkillOffer,
): SkillToolDescriptor<{ id: string }, string> | undefined {
  if (skills.length === 0) return undefined;

  const skillIds = skills.map((s) => s.id);
  const line = (s: Injection): string => `  - ${s.id}: ${s.description ?? '(no description)'}`;
  const skillCatalog = skills.map(line).join('\n');

  // Index per-skill body + surfaceMode (Block C — runtime per-mode dispatch).
  // For 'tool-only' / 'both' surface modes, the read_skill tool result
  // CONTAINS the skill body (recency-first delivery). For 'system-prompt'
  // and 'auto', the result is a confirmation string only — the body
  // lands via system slot on the next iteration.
  type SkillEntry = { body: string; surfaceMode: string };
  const byId = new Map<string, SkillEntry>();
  for (const s of skills) {
    const meta = s.metadata as { surfaceMode?: string } | undefined;
    byId.set(s.id, {
      body: s.inject.systemPrompt ?? '',
      surfaceMode: meta?.surfaceMode ?? 'auto',
    });
  }

  return {
    name: 'read_skill',
    description: describeOffer(skills, line, skillCatalog, offer),
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          // The FULL catalog, always — deliberately NOT narrowed to the reachable
          // set (8.5.0). `toolArgValidation` defaults to `'enforce'` and runs BEFORE
          // the skill-graph gate, rejecting an off-enum id with a generic schema
          // error and `error = true`, which the gate then skips. Narrowing this
          // would silently retire the gate's teaching refusal, the
          // `agentfootprint.skill.rejected` event, `routeRecorder`'s rejection hops
          // and the rejected-cap governor's only input — four honesty mechanisms
          // traded for one. The OFFER is narrowed in the description instead, which
          // is what the model actually reads to choose.
          enum: skillIds,
          description: 'The skill id to activate.',
        },
      },
      required: ['id'],
    },
    execute: ({ id }) => {
      const entry = byId.get(id);
      if (!entry) {
        return `Unknown skill '${id}'. Available: ${skillIds.join(', ')}`;
      }
      // Block C — per-mode tool-result dispatch:
      //   - 'tool-only' / 'both' → return body verbatim (recency-first
      //     delivery; LLM sees it as the most recent tool result).
      //   - 'system-prompt' / 'auto' / unspecified → return confirmation
      //     only; body lands via system slot on the next iteration.
      if ((entry.surfaceMode === 'tool-only' || entry.surfaceMode === 'both') && entry.body) {
        return entry.body;
      }
      return `Skill '${id}' activated for the next iteration.`;
    },
  };
}
