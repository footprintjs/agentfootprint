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
import { classifySkillTarget } from './skillGraph.js';
import { spoken } from '../spokenIds.js';
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
   * WHERE THE CURSOR STANDS — the skill the model is already IN (9.84.0).
   *
   * Passed on every call that has a cursor, menu or no menu. It does two jobs
   * the offer could not do before: it NAMES the current skill in the
   * description (previously only the menu's stay clause ever did, and a
   * decisively-routed turn has no menu), and it keeps that skill out of the
   * "Not reachable from here" list — where it appeared purely as an artefact of
   * being filtered out of its own successor set.
   *
   * {@link ReadSkillOffer.menu}'s `cursorId` is the same value and still
   * honoured; this one is simply not conditional on a menu being outstanding.
   *
   * It is NOT exempt from {@link ReadSkillOffer.hiddenIds}. A cursor the
   * caller's role may not see is not named — see the filter in `describeOffer`.
   */
  readonly cursorId?: string;
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
  /**
   * The mounted graph is a decision `tree()` (9.86.0).
   *
   * A tree routes by predicate on every iteration and keeps no cursor, so
   * `reachableSkills()` is empty from every position and EVERY routing pick is
   * refused by construction. Offering `read_skill` anyway asked the model to
   * choose from a menu the library knew it would reject — the same defect
   * 8.5.0 fixed for the flat graph's unreachable ids, left standing for the
   * one shape where it is total.
   *
   * With no open skill left after {@link ReadSkillOffer.hiddenIds}, the tool is
   * not offered at all ({@link readSkillDescriptor} returns `undefined`); with
   * open skills, the description says a tree has no cursor to move and names
   * exactly the skills a pick CAN open. Either way the name stays dispatchable
   * — position governs the offer, never dispatch — so a model that calls it
   * from a restored transcript still reads the gate's own refusal.
   */
  readonly treeRouted?: boolean;
}

/**
 * The skills an offer may NAME — the role filter, in one place (9.86.0).
 *
 * "Hidden first, so nothing below can name one" is the description's own law,
 * and the tree arm needs the same answer BEFORE it decides whether there is
 * anything left to offer. Two call sites, one filter.
 */
function visibleSkills(
  allSkills: readonly Injection[],
  offer?: ReadSkillOffer,
): readonly Injection[] {
  const hidden = new Set(offer?.hiddenIds ?? []);
  return hidden.size > 0 ? allSkills.filter((s) => !hidden.has(s.id)) : allSkills;
}

/**
 * The visible skills this offer's gate would admit and this description would
 * LIST — `grantable`, role-filtered, cursor excluded.
 *
 * Through `classifySkillTarget`, the same owner the list forty lines below
 * uses (9.86.0 fix pass). It used to ask a slightly different question — a bare
 * `grantable.has(s.id)`, which keeps the cursor — so the withhold test and the
 * list it withholds could disagree about whether there was anything to show: a
 * cursor that is its own sole grantable id offered the tool and then printed an
 * empty list under the tree paragraph. Not reachable today (a `tree()` keeps no
 * cursor, so `cursorId` is undefined on this path), and the point is that it
 * cannot become reachable — one question, one implementation.
 */
function grantableRows(
  allSkills: readonly Injection[],
  offer: ReadSkillOffer,
): readonly Injection[] {
  return visibleSkills(allSkills, offer).filter(
    (s) =>
      classifySkillTarget({
        ...(offer.cursorId !== undefined && { cursor: offer.cursorId }),
        target: s.id,
        hops: offer.grantable ?? [],
      }) === 'hop',
  );
}

/**
 * Compose the tool description: one catalog, or the offer split in two.
 *
 * ── THE LENS LAW ──────────────────────────────────────────────────────────
 *
 *   A Lens may omit; it may claim absence or refusal only from authoritative
 *   evidence for the epoch it describes.
 *
 * A Lens is anything that shows the model a narrowed view of a wider set. This
 * function is the framework's sharpest one — it is handed every registered
 * skill and returns a text that shows some of them — and it is the law's home
 * because it is the ONE site that does both halves the law governs. It OMITS
 * (`hiddenIds` removes a skill from the menu, from both columns, and from the
 * cursor sentence), and it CLAIMS REFUSAL ("read_skill for these will be
 * refused"). Every other candidate site does one half: `skillRefusal` in the
 * tool-calls stage only refuses, and it refuses a call that has already been
 * judged, so its evidence is a verdict rather than a prediction.
 *
 * What the two halves cost, and why they are asymmetric:
 *
 *   OMISSION is free. A skill this description does not name is a skill the
 *   model does not consider — no false sentence exists, and a role-hidden
 *   skill is silently absent rather than declared forbidden, which is the
 *   whole reason `hiddenIds` omits instead of refusing (naming it would teach
 *   a role the shape of somebody else's permissions).
 *
 *   ABSENCE is a CLAIM, and a claim needs evidence for THIS epoch. So every
 *   sentence here that could be read as absence is written cursor-relative and
 *   epoch-scoped: "Not reachable FROM HERE", "Nothing is reachable FROM HERE".
 *   Never "does not exist", never "you do not have", never "unavailable". The
 *   difference is not politeness. This description is recomposed for one
 *   request from that request's own cursor (the `request-ephemeral` argument
 *   in `test/helpers/modelFacingClaims.ts`), so "from here" is a fact it holds
 *   evidence for; "does not exist" is a claim about a catalog it was handed a
 *   filtered view of, and about postures and parks it cannot see. The
 *   production failure this whole area exists for was exactly that misreading:
 *   a model read the gate's refusal of its own cursor id as "that skill is
 *   unavailable" and gave up mid-turn, having never left the skill it was in.
 *
 * AND OMISSION IS NOT A SPECIAL CASE OF ABSENCE (9.86.0 fix pass). The law was
 * stated here and then broken three lines from the bottom: both columns were
 * computed from a catalog `visibleSkills` had already role-filtered, so "the
 * graph wires nothing out of here" and "the role may not be told about the one
 * edge it wires" composed the same sentence — "Nothing is reachable from here"
 * over a graph holding `alpha → beta`. The hop set is now classified over the
 * UNFILTERED catalog and put through `spoken`, which keeps `held`: where the
 * filter is what emptied the column, the clause is dropped and the description
 * names the cursor and stops. With nothing wired out at all the sentence still
 * stands, because that absence is one this description has evidence for.
 *
 * The known gap is on the record, not hidden: the refusal column is a
 * compose-time PREDICTION of the gate, and the module header names the two
 * shipped mechanisms that falsify it in both directions (a `'rails'`/off-menu
 * `'guard'` posture refuses a hop this list calls reachable; the re-engagement
 * arm admits a parked member this list calls refusable). Stating a law does not
 * close a gap — but it does say which sentences the gap is allowed to touch.
 *
 * Pinned by `test/core/agent/epoch-laws.test.ts`.
 */
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
  const skills = visibleSkills(allSkills, offer);
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
  // ── THE CURSOR IS NAMED ON EVERY CALL THAT HAS ONE (9.84.0) ─────────
  // This used to be the STAY clause and nothing else, so it appeared only while
  // a turn-start menu was outstanding. A turn that routed DECISIVELY has no
  // menu — and therefore had no sentence anywhere telling the model which skill
  // it was in. It received a body with no name on it, then read the gate's
  // refusal of its own id as "that skill is unavailable" and gave up mid-turn.
  // So the cursor rides the offer whenever it exists, and the stay clause still
  // rides it when a menu is open.
  //
  // ROLE VISIBILITY WINS OVER THE POSITIVE SIGNAL. `hidden` is built above
  // precisely so nothing below can name a hidden skill, and reading
  // `offer.cursorId` raw walked past it: a role denied `skill_read` on the
  // cursor's own skill was still told "You are in 'alpha'" — the one leak the
  // hidden set exists to prevent, because it teaches a role the name of a
  // capability no cursor move will ever make available to it. Naming nothing
  // is the honest fallback: that role loses the positive signal, which is the
  // price its own policy asked for.
  const named = offer.cursorId ?? offer.menu?.cursorId;
  const cursorId = named !== undefined && !hidden.has(named) ? named : undefined;
  const staying = offer.menu?.stay === true && cursorId !== undefined;
  // WHAT THE SECOND HALF MAY SAY: outside an outstanding menu, NOTHING.
  //
  // Naming the cursor is the whole fix for the production failure this release
  // exists for — a model that could not tell it was already in a skill read a
  // refusal as "unavailable" and gave up. Naming it is enough. Every sentence
  // added ALONGSIDE the name has turned out false somewhere, five rounds
  // running, and the last one is worth recording because it looked safest of
  // all: " You do not need read_skill to go on using it." was argued to be a
  // claim about NECESSITY that no posture, budget or hold-out could falsify.
  // The PARK falsifies it. A parked map member keeps the cursor and loses its
  // body and its tools, and `read_skill` is then the only door back — the
  // re-engagement arm at `toolCalls.ts` exists precisely because 9.59.0 found
  // that telling a parked model to answer with the current skill made parking
  // permanent for the rest of the turn. This description cannot see the park
  // (see the note below on hold-outs), so it cannot know when it would be
  // lying. So it says the name and stops.
  //
  // What it must NOT say is what `read_skill` would DO from here. The deleted
  // wording ("read_skill MOVES you to a DIFFERENT skill") was that, and it is
  // false at compose time under two of the three declared postures: `'rails'`
  // refuses every model hop outright and `'guard'` refuses every hop that is
  // not on an outstanding menu, so `read_skill` moves nobody — the posture arm
  // answers a taken-up pick with "read_skill here reaches only the open skills:
  // …" and contradicts this sentence head-on. Nor is that fixable by making
  // the sentence posture-aware: the gate's verdict also turns on whether the
  // pick lands on a menu that is still outstanding, and on whether it is a
  // parked map member the re-engagement arm admits — facts about a call that
  // has not happened. A description that predicts the gate can only be a
  // partial mirror, and a partial mirror is how each of the previous rounds
  // ended. So it predicts nothing.
  const cursorLead =
    cursorId === undefined
      ? ''
      : `You are in '${cursorId}'.` +
        (staying
          ? ` Staying is a first-class option: answer WITHOUT calling read_skill to ` +
            `stay in '${cursorId}'.\n\n`
          : `\n\n`);
  // Deliberately no claim about tools here. This description is composed before
  // the step and park hold-outs filter the wire, so it cannot see what actually
  // rides; the gate's self-call notice names tools because it reads the merged
  // list after the fact.
  const menuLead =
    offer.menu !== undefined && menuRows.length > 0
      ? `This turn needs a routing choice — no declared rule or intent decisively matched. ` +
        `Closest candidates (advisory; an offline scorer ranked them and cannot see the ` +
        `conversation):\n${menuRows.join('\n')}\n` +
        (staying
          ? cursorLead
          : `Answering WITHOUT calling read_skill is also allowed.\n\n${cursorLead}`)
      : cursorLead;
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
  // The four target classes, from their ONE owner (9.86.0). `grantable` is the
  // gate's admitted set (hops ∪ open), so what this description needs from the
  // classifier is the SELF case: the cursor belongs in neither column, and the
  // `s.id !== cursorId` check that used to say so lived here, in `toolCalls`,
  // in `Agent` and in `makeReachableSkills` — four copies of one rule.
  const classOf = (id: string): ReturnType<typeof classifySkillTarget> =>
    classifySkillTarget({
      ...(cursorId !== undefined && { cursor: cursorId }),
      target: id,
      hops: offer.grantable ?? [],
    });
  // ── OMIT, NEVER DENY, ON THE SURFACE THE MODEL CHOOSES FROM ─────────
  // (9.86.0 fix pass.) `skills` is already role-filtered, so branching on its
  // length answered "did the role filter empty this?" with the words for "was
  // the graph holding nothing?" — the identical defect the refusal composer was
  // repaired for, on the one surface the model actually reads to pick. So the
  // hop set is classified over the UNFILTERED catalog and put through `spoken`,
  // which keeps both halves: `named` is what may be listed, `held` is whether
  // the graph was holding a hop at all. Where the filter is what emptied it,
  // the negative sentence is omitted rather than printed.
  const hopRows = allSkills.filter((s) => classOf(s.id) === 'hop');
  const hopsSpoken = spoken(
    hopRows.map((s) => s.id),
    (id) => !hidden.has(id),
  );
  const nameable = new Set(hopsSpoken.named);
  const open = hopRows.filter((s) => nameable.has(s.id));
  // ── THE TREE ARM (9.86.0) — a tree has no cursor to move ────────────
  // `reachableSkills()` is empty from every position under a `tree()`, so the
  // split above would print "Nothing is reachable from here" and invite a pick
  // the gate refuses every time. What IS true is named instead: the tree's own
  // routing, and the open skills a pick can still activate. (With none of
  // those, `readSkillDescriptor` never gets here — it withholds the tool.)
  if (offer.treeRouted === true) {
    return (
      `${menuLead}Activate a skill for the next iteration. This map is a decision TREE: ` +
      `it routes by predicate on every iteration and keeps no cursor, so read_skill ` +
      `cannot move it — a pick of a routed skill is refused. What a pick CAN open are ` +
      `the skills the tree does not route:\n${open.map(line).join('\n')}\n\n${tail}`
    );
  }
  // The cursor is never in `grantable` — `makeReachableSkills` filters it out of
  // its own successor set, because a MOVE to where you already are is not a move.
  // Listing it under "Not reachable" turned that into a claim about
  // AVAILABILITY, which is the one thing this list must not say about the skill
  // the model is standing in. (What this point can and cannot see is settled 30
  // lines up: the wire is composed AFTER this, so no claim about tools belongs
  // in either column. The gate's self-call notice is where tools get named,
  // because it reads the merged list after the fact.) It belongs in neither
  // column, so it is named once, above, by `cursorLead`.
  const shut = skills.filter((s) => classOf(s.id) === 'unreachable');
  const parts: string[] = [];
  if (open.length > 0) {
    parts.push(`Reachable from here:\n${open.map(line).join('\n')}`);
  } else if (!hopsSpoken.held) {
    // Nothing was wired out of here at all — an absence this description holds
    // evidence for, cursor-relative and epoch-scoped, so it may be stated.
    parts.push('Nothing is reachable from here — answer with the skill you are in, or finish.');
  }
  if (offer.showRefusable !== false && shut.length > 0) {
    parts.push(
      `Not reachable from here (read_skill for these will be refused):\n${shut
        .map(line)
        .join('\n')}`,
    );
  }
  // With every clause omitted the description names the cursor and stops, which
  // is the honest floor: a filtered-away hop is still a hop the graph holds.
  const body = parts.length > 0 ? `\n\n${parts.join('\n\n')}` : '';
  return `${menuLead}Activate a skill for the next iteration.${body}\n\n${tail}`;
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
  // ── A TREE WITH NOTHING TO OPEN IS NOT OFFERED (9.86.0) ─────────────
  // Under a `tree()` every routing pick is refused by construction (the tree
  // keeps no cursor for read_skill to move), so with no open skill left after
  // the role filter there is no id this tool could accept. Offering it anyway
  // is the 8.5.0 defect in its total form: a menu the library knows it will
  // reject, re-read on every iteration. The NAME stays in the dispatch map, so
  // a pick made from a restored transcript still reaches the gate's refusal.
  if (offer?.treeRouted === true && grantableRows(skills, offer).length === 0) return undefined;

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
      return skillActivationConfirmation(id);
    },
  };
}

/**
 * What `read_skill` answers when it activated a skill but did NOT carry its body
 * (surface modes `'system-prompt'` / `'auto'` — the body lands via the system
 * slot next iteration).
 *
 * Exported because the skill-graph gate has to tell this sentence apart from a
 * body: a SELF-CALL keeps the body (the model asked to re-read where it is, and
 * under `'tool-only'` the tool result is the only place that body ever appears)
 * but must not keep a promise of an activation that is not pending. Comparing
 * against the one owner of the string beats guessing at its shape.
 */
export function skillActivationConfirmation(id: string): string {
  return `Skill '${id}' activated for the next iteration.`;
}
