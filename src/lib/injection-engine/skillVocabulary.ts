/**
 * skillVocabulary — what a skill PRODUCES and CONSUMES, as data (9.25.0).
 *
 * Two programs meet here. The claim-check store gave artifacts a consumer
 * vocabulary — `kind` (`'dataset/rows'`, `'chart/spec'`), declared by the
 * producer and exact-matched by every consumer. The skill graph gave a run a
 * declared shape — which skill holds the tenure, in what order, running which
 * steps. Neither could see the other: a skill whose whole job was to turn a
 * dataset into a chart said so only in prose, so nothing could check that
 * anything on the agent ever MAKES a dataset.
 *
 *   defineSkill({ id: 'charting', …,
 *     consumes: ['dataset/rows'],      // what it needs to arrive
 *     produces: ['chart/spec'],        // what it leaves behind
 *     steps: [{ tool: 'fetch',   note: '…', produces: ['dataset/rows'] },
 *             { tool: 'render',  note: '…', consumes: ['dataset/rows'] }] })
 *
 * Vocabularies are DECLARATIONS, not machinery: nothing at run time reads
 * them, nothing is enforced at dispatch (that is `wants`' job, and it happens
 * against the real store), and a skill that declares none is byte-identical to
 * one that never heard of them. What they buy is (1) a build-time check that
 * a consumed kind has a producer somewhere, and (2) a fact on the skill's
 * metadata that a lens can draw — the data legs of a run, before the run.
 *
 * ── The satisfiability rule, and exactly what it can see ────────────────────
 * A consumed kind `K` at a consumer `C` is SATISFIED when any of these holds:
 *
 *   1. **A wants-declaring tool in scope names `K`.** For a skill: any of its
 *      own tools. For a step: the tool that step runs. This is the honest
 *      escape hatch — `wants` is redeemed at dispatch against the live store,
 *      and the ref the model speaks may have been minted by another agent, an
 *      earlier turn, or a job that ran last night. A declaration backed by a
 *      real redemption path is never called unsatisfied.
 *   2. **Something on this agent declares `produces: K`** — any skill, or any
 *      step of any skill, including `C` itself.
 *   3. (steps only) **An earlier step of the same skill produces `K`**, or
 *      **the skill's own `consumes` names `K`** — it arrived from outside, and
 *      the skill's contract says so.
 *
 * Otherwise: `artifact-kind-unsatisfied`, a WARNING.
 *
 * **The boundary, stated because a check that overclaims is worse than none.**
 * This does NOT reason about route order. A producer declared anywhere on the
 * agent silences the check, even if no declared route reaches the consumer
 * from it — because `read_skill` can put the cursor on any open skill, and the
 * artifact store OUTLIVES the turn. The only thing this proves is the strong
 * one: *nothing on this agent claims to make what this consumer claims to
 * need.* Cross-agent and cross-run flows through the store are invisible to
 * it, and so is any tool that mints an artifact without a `produces`
 * declaration — which is why the warning says so in its own message and why
 * it is never an error.
 */

import type { GraphProblem } from './skillGraphCheckup.js';
import type { Injection } from './types.js';

/** The two vocabularies a skill or a step may declare. */
export interface ArtifactVocabulary {
  /** Artifact KINDS this leaves behind for something later to redeem. */
  readonly produces?: readonly string[];
  /** Artifact KINDS this needs to have arrived. */
  readonly consumes?: readonly string[];
}

/** The metadata bag key set a skill's vocabularies ride on. */
interface VocabularyMetadata {
  readonly produces?: readonly string[];
  readonly consumes?: readonly string[];
  readonly steps?: ReadonlyArray<{
    readonly tool: string;
    readonly produces?: readonly string[];
    readonly consumes?: readonly string[];
  }>;
}

/**
 * Validate one declaration at its authoring point. Every refusal happens
 * where both halves are in hand — the `validateSkillSteps` law, applied to
 * the other declaration on the same options bag.
 *
 * @param where  the refusal's first words, e.g. `defineSkill(billing)`.
 * @param what   which field is being checked, for the message.
 */
export function assertArtifactVocabulary(
  where: string,
  what: 'produces' | 'consumes',
  kinds: readonly string[] | undefined,
): void {
  if (kinds === undefined) return;
  if (!Array.isArray(kinds)) {
    throw new Error(
      `${where}: \`${what}\` must be an array of artifact kinds (e.g. ` +
        `${what}: ['dataset/rows']). Got ${typeof kinds}.`,
    );
  }
  if (kinds.length === 0) {
    throw new Error(
      `${where}: \`${what}: []\` declares nothing — say what you mean and omit the field. ` +
        `A skill without vocabularies is byte-identical to one that never heard of them.`,
    );
  }
  const seen = new Set<string>();
  for (const kind of kinds) {
    if (typeof kind !== 'string' || kind.trim().length === 0) {
      throw new Error(
        `${where}: \`${what}\` contains ${JSON.stringify(kind)}, which is not an artifact ` +
          `kind. A kind is the consumer vocabulary a ticket carries — the exact string a ` +
          `meta.kind must equal ('dataset/rows', 'chart/spec').`,
      );
    }
    if (seen.has(kind)) {
      throw new Error(
        `${where}: \`${what}\` names '${kind}' twice. A vocabulary is a SET — the repeat says ` +
          `nothing the first mention did not, and reads like two different things were meant.`,
      );
    }
    seen.add(kind);
  }
}

/** Read a skill injection's declared vocabularies off its metadata bag (the
 *  `steps` precedent — the engine ignores unknown keys). `undefined` when the
 *  skill declared none, so a caller can skip the whole feature. */
export function vocabularyOf(injection: Injection): ArtifactVocabulary | undefined {
  const meta = injection.metadata as VocabularyMetadata | undefined;
  const produces = meta?.produces;
  const consumes = meta?.consumes;
  if (produces === undefined && consumes === undefined) return undefined;
  return {
    ...(produces !== undefined && { produces }),
    ...(consumes !== undefined && { consumes }),
  };
}

/** The `wants` kinds a tool declares, if any. */
function toolWantKinds(tool: unknown): readonly string[] {
  const wants = (tool as { wants?: Record<string, string> } | undefined)?.wants;
  if (wants === undefined || wants === null || typeof wants !== 'object') return [];
  return Object.values(wants).filter((kind): kind is string => typeof kind === 'string');
}

/** One skill's tools, as the checkup sees them. */
function skillTools(skill: Injection): ReadonlyArray<{ name: string; wants: readonly string[] }> {
  const tools = (skill as { inject?: { tools?: ReadonlyArray<{ schema: { name: string } }> } })
    .inject?.tools;
  return (tools ?? []).map((tool) => ({
    name: tool.schema.name,
    wants: toolWantKinds(tool),
  }));
}

/** `'a'`, `'a' and 'b'`, `'a', 'b' and 'c'` — a list a human reads aloud. */
function quoteKinds(kinds: readonly string[]): string {
  const quoted = [...kinds].map((k) => `'${k}'`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** The clause that names what the agent CAN make — the innerRunRecords law:
 *  correct by naming what exists, never by only saying what does not. */
function producedClause(produced: ReadonlySet<string>): string {
  if (produced.size === 0) {
    return `Nothing on this agent declares \`produces\` at all`;
  }
  const listed = [...produced].sort();
  return `What this agent declares it produces: ${quoteKinds(listed)}`;
}

/** The honesty paragraph every one of these warnings carries. */
const BOUNDARY =
  `This check reads DECLARATIONS only: a tool that mints an artifact without a ` +
  `\`produces\` declaration is invisible to it, and so is anything the store received in an ` +
  `earlier run, from another agent, or from a job outside this process — artifacts outlive ` +
  `the turn that made them. It also does not follow route order: a producer declared ` +
  `anywhere on this agent silences it, because read_skill can put the cursor on any open ` +
  `skill. If the kind really arrives from outside, declare a tool that \`wants\` it (that is ` +
  `the redemption path the framework honors) or drop the declaration — the warning is never ` +
  `an error, because it cannot see enough to be one.`;

/**
 * Check every declared vocabulary on a set of skills. Pure + side-effect-free,
 * and returns `[]` immediately when nothing declares a vocabulary (the
 * zero-cost gate — an agent that never heard of this feature pays one
 * `Array.some`).
 *
 * @param skills every skill injection the agent will carry.
 */
export function checkArtifactVocabularies(skills: readonly Injection[]): GraphProblem[] {
  const declared = skills.filter((skill) => skill.flavor === 'skill');
  const bags = declared.map((skill) => ({
    skill,
    id: skill.id,
    vocabulary: vocabularyOf(skill),
    steps: (skill.metadata as VocabularyMetadata | undefined)?.steps ?? [],
    tools: skillTools(skill),
  }));
  const anyDeclared = bags.some(
    (bag) =>
      bag.vocabulary !== undefined ||
      bag.steps.some((step) => step.produces !== undefined || step.consumes !== undefined),
  );
  if (!anyDeclared) return [];

  // Everything anything on this agent claims to make — skills and steps alike.
  const produced = new Set<string>();
  for (const bag of bags) {
    for (const kind of bag.vocabulary?.produces ?? []) produced.add(kind);
    for (const step of bag.steps) for (const kind of step.produces ?? []) produced.add(kind);
  }

  const problems: GraphProblem[] = [];

  for (const bag of bags) {
    // The kinds a wants-declaring tool of THIS skill redeems at dispatch.
    const skillWants = new Set(bag.tools.flatMap((tool) => tool.wants));

    for (const kind of bag.vocabulary?.consumes ?? []) {
      if (produced.has(kind) || skillWants.has(kind)) continue;
      problems.push({
        kind: 'warning',
        code: 'artifact-kind-unsatisfied',
        message:
          `Skill "${bag.id}" declares consumes: '${kind}', and nothing on this agent declares ` +
          `it produces that kind — no skill, no step. ${producedClause(produced)}. ` +
          `A consumer whose kind nobody makes reads its refs as "no live '${kind}' artifacts ` +
          `exist in this run's scope" at dispatch, every time. ${BOUNDARY}`,
        skill: bag.id,
      });
    }

    // Steps: the same rule with two more ways to be satisfied — an EARLIER
    // step of this skill, or the skill's own `consumes` (it arrived from
    // outside, and the skill's contract already says so).
    const earlier = new Set<string>();
    for (const [index, step] of bag.steps.entries()) {
      const carried = new Set(bag.tools.find((tool) => tool.name === step.tool)?.wants ?? []);
      for (const kind of step.consumes ?? []) {
        if (
          produced.has(kind) ||
          earlier.has(kind) ||
          carried.has(kind) ||
          (bag.vocabulary?.consumes ?? []).includes(kind)
        ) {
          continue;
        }
        problems.push({
          kind: 'warning',
          code: 'artifact-kind-unsatisfied',
          message:
            `Step ${index + 1} of "${bag.id}" ('${step.tool}') declares consumes: '${kind}', ` +
            `and nothing that can precede it declares it produces that kind: no earlier step ` +
            `of this skill, no skill on this agent, and "${bag.id}" does not list it in its ` +
            `own \`consumes\` (which is how a step says the kind arrived from outside). ` +
            `${producedClause(produced)}. ${BOUNDARY}`,
          skill: bag.id,
        });
      }
      for (const kind of step.produces ?? []) earlier.add(kind);
    }
  }

  return problems;
}
