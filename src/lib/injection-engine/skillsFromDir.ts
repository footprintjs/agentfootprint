/**
 * skillsFromDir — load Skills that were AUTHORED AS FILES.
 *
 * The just-in-time half of skills already ships: `defineSkill` produces an
 * Injection whose `description` is all the model sees until it calls
 * `read_skill(<id>)`, at which point the body enters the context. What did not
 * ship was the other half — a way to keep those bodies where prose belongs, in
 * files, next to the code they describe, reviewable in a diff.
 *
 * This is that loader, and nothing more. It reads a directory of `SKILL.md`
 * files and hands each one to `defineSkill`. The progressive disclosure, the
 * activation tool, the slot routing — all unchanged, all upstream of here.
 *
 *   skills/
 *     billing/SKILL.md
 *     refunds/SKILL.md
 *
 *   ---
 *   name: billing
 *   description: Use for refunds, charges and billing questions.
 *   ---
 *   When handling billing: confirm identity first, then …
 *
 *   const skills = await skillsFromDir('./skills');
 *   const agent = Agent.create({ provider, model }).skills({ list: () => skills }).build();
 *
 * The frontmatter is the disclosure stub (`name` + `description` — what the
 * model reads when deciding), and everything after the closing fence is the
 * body (what it reads after deciding). That is the same file convention Claude
 * Code made familiar, so a skill folder is portable between the two.
 *
 * ── What a SKILL.md can carry (9.36.0: the whole runbook) ────────────────────
 * A runbook you already have on disk is three things — what to do (prose),
 * what to do it WITH (tools), and in what order (steps). This door used to
 * carry the first and drop the other two, so the one thing the library exists
 * to say ("extract the workflow you already have") arrived two-thirds empty.
 * All three now cross:
 *
 *   ---
 *   name: billing
 *   description: Use for refunds, charges and billing questions.
 *   tools: lookup_order, issue_refund
 *   steps:
 *     - lookup_order: look up the order before touching money
 *     - issue_refund: refund only what the lookup found
 *   onSkip: hold
 *   ---
 *   When handling billing: confirm identity first, then …
 *
 *   const skills = await skillsFromDir('./skills', {
 *     tools: [lookupOrder, issueRefund],   // the real Tools, from YOUR code
 *   });
 *
 * The remaining limits, and why each one is a decision rather than an
 * oversight:
 *
 *   - **the file names a tool; it never defines one.** A tool is code with an
 *     `execute`, and a markdown file has none. `tools:` is a list of NAMES,
 *     resolved against the `tools` registry the CALLER passes — so the file
 *     can only ever pick from capabilities you already handed in, and reading a
 *     directory can never introduce one. See "why this is not a code-execution
 *     vector" below.
 *   - **a name the registry does not carry is refused BY NAME at load** —
 *     never a skill that quietly loads without the tool it asked for, because
 *     that skill runs, sounds confident, and cannot do the job.
 *   - **no per-step `produces` / `consumes`** — the artifact vocabularies
 *     (9.25.0) are a build-time contract between skills, not runbook prose;
 *     declare them with `defineSkill` where the rest of the agent is declared.
 *   - **no `autoActivate`** — a directory does not decide the agent's tool
 *     posture. Say it once on the agent with `.toolsFromActiveSkill()`
 *     (9.36.0), which scopes every skill's tools to that skill's activation.
 *     Without it, a loaded skill's tools are on the wire from iteration 1, the
 *     same as any hand-written `defineSkill({ tools })`.
 *   - **no per-file `surfaceMode`, `cache` or `refreshPolicy`** — `surfaceMode`
 *     is settable for the WHOLE directory via `opts`, all of them or none; the
 *     others take `defineSkill`'s defaults.
 *   - unknown frontmatter keys are still IGNORED, not rejected, so a file
 *     carrying another tool's metadata still loads here. `name`,
 *     `description`, `tools`, `steps`, `onSkip` and `routes` are the KNOWN
 *     keys — a file that used one of those six for something else is the one
 *     case a release can change, and it changes it loudly.
 *
 * ── The routing, and the door that reads it (9.43.0) ─────────────────────────
 * A runbook says what to do, what to do it with, in what order — and where the
 * work goes NEXT. That last part is the graph, and until now it had to be
 * hand-wired in code even when the files said it plainly. `routes:` closes it:
 *
 *   ---
 *   name: billing
 *   tools: lookup_order, issue_refund
 *   routes:
 *     - escalation: on issue_refund status=denied
 *     - receipts: on issue_refund
 *   ---
 *
 *   const runbook = await runbookFromDir('./skills', { tools: [...] });
 *   const graph = skillGraph({ ...runbook, start: 'billing' });
 *
 * TWO DOORS, one truth: `skillsFromDir` returns skills and REFUSES a file that
 * declares `routes:` (a door that dropped the routing would hand back a graph
 * you believed was declared on disk); {@link runbookFromDir} returns
 * `{ skills, steps }`. Same law as `tools:` — the file PICKS (a route names a
 * skill id this directory declares; an unknown id is refused at load, by name,
 * listing what is available), it never DEFINES. A guard is one of the two DATA
 * conditions a route already has (`on <tool_name>`, `status=<outcome>`), and
 * nothing else: a `when` predicate is CODE, no file can carry code, and that
 * conditional stays in your source. See `skillsFromDirRoutes.ts` for the whole
 * grammar and every refusal.
 *
 * A worked example feeding this into a graph:
 * `examples/features/47-skills-from-dir-graph.ts`.
 *
 * ── Why authorship is decided here, at load time ─────────────────────────────
 * A Skill body is *instructions to a model*. Where it came from is therefore a
 * security property, not a convenience: content fetched at run time from
 * somewhere else is content someone else can change after you reviewed it.
 * This loader accepts a local directory and nothing else — a URL is refused BY
 * NAME rather than fetched — because "these files are mine" is a claim you can
 * only make about a path on your own disk at build time. Each file is read
 * ONCE, here; a later edit does not reach a run already in flight.
 *
 * ── Why carrying tools is not a code-execution vector ───────────────────────
 * Nothing in a SKILL.md is evaluated, imported, required or resolved as a
 * path. `tools:` is a list of strings, and the only thing a string can do here
 * is MATCH — against `tool.schema.name` in a registry the caller constructed in
 * their own source, from their own imports. A hostile file can therefore ask
 * for a tool you already gave the agent (and it would have to guess the name);
 * it can never name a module, widen the agent's capabilities, or cause one byte
 * of new code to run. The set of things this directory can do is a SUBSET of
 * what the calling file already decided to do, which is the same property the
 * local-path rule above buys for bodies.
 *
 * Node-only. `node:fs/promises` and `node:path` are imported lazily inside the
 * call, the same gating `lib/tool-lint/cli.ts` uses: this module is reachable
 * from the `agentfootprint/context` barrel, and a TOP-LEVEL node:fs
 * import detonates a browser bundle at module-eval even when nothing calls it.
 */

import type { Injection } from './types.js';
import type { Tool } from '../../core/tools.js';
import type { OnSkipPolicy, SkillStep } from './skillSteps.js';
import { defineSkill, type SurfaceMode } from './factories/defineSkill.js';
import type { SkillGraphStep } from './skillGraph.js';
import { readDeclaredRoutes, toGraphSteps, type DeclaredRoute } from './skillsFromDirRoutes.js';

/** The file name every skill folder is expected to use. */
const SKILL_FILE = 'SKILL.md';

/**
 * Skill ids ride into `read_skill`'s `enum` and into the skill-graph's node
 * ids. The house tool-name charset keeps them quotable in a prompt, comparable
 * as plain strings, and safe as an object key.
 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/** Anything of the form `scheme://…` — http, https, s3, git+ssh, file, … */
const URL_LIKE_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

/** How many registry names a refusal lists before it stops. Long enough to
 *  spot the typo, short enough that a 200-tool agent's error is still readable. */
const NAMES_IN_REFUSAL = 20;

export interface SkillsFromDirOptions {
  /**
   * Where a loaded skill's body lands once activated. Defaults to
   * `defineSkill`'s own default, `'auto'`. See {@link SurfaceMode}.
   */
  readonly surfaceMode?: SurfaceMode;
  /**
   * The tools a file may NAME (9.36.0) — the resolution registry for every
   * `tools:` declaration in the directory, matched by `tool.schema.name`.
   *
   * This is the half a markdown file cannot supply. The file picks; you decide
   * what there is to pick FROM, in your own source, from your own imports. A
   * declared name that is not in here is refused at load, naming the file, the
   * name, and what this registry does carry.
   *
   * Pass every tool the directory might use; a tool nothing names is simply
   * unused (no skill gets it, and no error). Omit the option entirely on a
   * prose-only directory — a file that declares `tools:` with no registry
   * passed is refused rather than loaded without them.
   */
  readonly tools?: readonly Tool[];
}

/**
 * What a parsed `SKILL.md` yielded, before it becomes an Injection. Kept
 * separate from the Injection so collision reporting can name the FILE each
 * offending skill came from, not just the id.
 */
interface ParsedSkillFile {
  readonly name: string;
  readonly description: string;
  readonly body: string;
  /** Tool NAMES the file declared, in declaration order. Absent when the file
   *  declared no `tools:` key at all — which is not the same as an empty list
   *  (that is refused). */
  readonly toolNames?: readonly string[];
  /** Steps as data, already shaped like `defineSkill`'s `steps`. */
  readonly steps?: readonly SkillStep[];
  readonly onSkip?: OnSkipPolicy;
  /** The ROUTING this file declared (9.43.0) — target ids + data guards, still
   *  unresolved: a file cannot know what the rest of the directory carries.
   *  Absent when the file declared no `routes:` key, which is what every file
   *  written before this release does. */
  readonly routes?: readonly DeclaredRoute[];
  /** Absolute-ish path as given to the reader — what error messages quote. */
  readonly file: string;
}

/**
 * A whole runbook directory, read as the two things a graph is made of
 * (9.43.0): the skills, and the edges between them.
 *
 * Spreads straight into the graph — the field names are the graph's own, so
 * nothing has to be translated at the call site:
 *
 *   const runbook = await runbookFromDir('./skills', { tools });
 *   const graph = skillGraph({ ...runbook, start: 'triage' });
 */
export interface DirRunbook {
  /** Every `SKILL.md` under the directory, as Skill Injections — byte-identical
   *  to what `skillsFromDir` returns for the same directory. */
  readonly skills: readonly Injection[];
  /**
   * The declared edges, ready for `skillGraph({ steps })`. In skill-name order,
   * then file order, so a graph built from a directory is stable.
   *
   * NAME NOTE, because two different things are spelled `steps` in this
   * library: a file's own `steps:` key is that SKILL's tool sequence (which
   * rides on the skill, unchanged); these `steps` are the GRAPH's edges, read
   * from each file's `routes:` key. They never meet.
   */
  readonly steps: readonly SkillGraphStep[];
}

/**
 * Load every `SKILL.md` under `dir` as a Skill Injection.
 *
 * Two layouts are accepted, and they can be mixed:
 *   - `dir/<anything>/SKILL.md` — one folder per skill (the portable layout,
 *     and the one to prefer: the folder can hold the skill's other assets).
 *   - `dir/SKILL.md` — the directory IS one skill.
 *
 * The returned array is sorted by skill name, so a chart built from it is
 * stable regardless of the order the filesystem happened to hand back.
 *
 * @param dir - A local filesystem path. A URL (or any `scheme://` string, or a
 *   UNC network path) is refused by name — see the module header for why.
 * @param opts - Applied uniformly to every loaded skill.
 *
 * @throws when `dir` is not a local path, does not exist, is not a directory,
 *   or contains no `SKILL.md` at all; when a file's frontmatter is malformed
 *   (the message names the file); when two files claim the same skill name
 *   (the message names both); or when a file names a tool the `tools` registry
 *   does not carry, or sequences a tool the file itself did not declare.
 */
export async function skillsFromDir(
  dir: string,
  opts: SkillsFromDirOptions = {},
): Promise<readonly Injection[]> {
  const { parsed, skills } = await loadSkillDir(dir, opts);
  // A file that declares `routes:` loaded through THIS door would hand back a
  // skill set with its routing silently dropped — the same failure the tool
  // registry refuses ("a skill that loads without the tool it asked for still
  // runs and still sounds sure of itself"). Refused by name, pointing at the
  // door that reads the whole runbook.
  const routing = parsed.find((skill) => skill.routes !== undefined);
  if (routing !== undefined) {
    throw new Error(
      `skillsFromDir: '${routing.file}' declares 'routes', and skillsFromDir returns SKILLS ` +
        `only — the routing would be dropped without a word, leaving you a graph you thought ` +
        `was declared on disk. Read the whole runbook instead: ` +
        `const { skills, steps } = await runbookFromDir(dir, opts); ` +
        `skillGraph({ skills, steps, start: '<entry id>' }). ` +
        `(If 'routes' in this file belongs to another program, rename that key — it is a key ` +
        `this loader now reads.)`,
    );
  }
  return skills;
}

/**
 * Load a directory as a whole RUNBOOK (9.43.0) — the skills AND the edges
 * between them.
 *
 * `skillsFromDir` reads what one skill is; this reads what the skills are TO
 * EACH OTHER, from each file's `routes:` key, and hands back both halves ready
 * for `skillGraph({ ...runbook, start })`. Everything else is identical: same
 * layouts, same frontmatter, same tool registry, same refusals.
 *
 * The routing a file may carry is deliberately small, and the boundary is a
 * security property rather than a limitation — see `skillsFromDirRoutes.ts`:
 * a route NAMES a skill this directory declares (an unknown id is refused at
 * load, by name, listing what is available — never a half-graph), and a guard
 * is one of the two DATA conditions a route already has (`on <tool>`,
 * `status=<outcome>`). A `when` predicate is code, so no file can express one;
 * that conditional stays in your source, where `skillGraph({ steps })` takes it.
 *
 * @param dir - A local filesystem path. Same rule as `skillsFromDir`.
 * @param opts - Applied uniformly to every loaded skill.
 *
 * @throws everything `skillsFromDir` throws, plus: a route to an id no
 *   `SKILL.md` in the directory declares (the message lists what is
 *   available), a guard the grammar cannot express (the message quotes the
 *   whole grammar), a guard naming a tool the file itself does not declare,
 *   and a file routing to the same skill twice.
 */
export async function runbookFromDir(
  dir: string,
  opts: SkillsFromDirOptions = {},
): Promise<DirRunbook> {
  const { parsed, skills } = await loadSkillDir(dir, opts);
  // Resolved only once every file is in hand: "which ids exist" is a fact about
  // the DIRECTORY, and no single file can be asked it.
  const known = new Set(parsed.map((skill) => skill.name));
  const steps = parsed.flatMap((skill) =>
    skill.routes === undefined ? [] : toGraphSteps(skill.name, skill.routes, skill.file, known),
  );
  return { skills, steps };
}

/**
 * The shared load: read the directory, parse every file, resolve the tools,
 * build the skills. Both doors run exactly this — they differ only in what they
 * do with the ROUTING each file declared, which is the one thing a skill list
 * cannot carry.
 *
 * Returns the parsed files and the built skills IN THE SAME ORDER (sorted by
 * skill name), so a caller can pair them by index.
 */
async function loadSkillDir(
  dir: string,
  opts: SkillsFromDirOptions,
): Promise<{ parsed: readonly ParsedSkillFile[]; skills: readonly Injection[] }> {
  assertLocalDirectoryArgument(dir);
  assertNoViaToolNameOption(opts);

  // Lazy node imports (browser-compat) — see module header.
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');

  let isDirectory = false;
  try {
    isDirectory = (await stat(dir)).isDirectory();
  } catch {
    throw new Error(
      `skillsFromDir: '${dir}' does not exist. Pass the directory that holds your ` +
        `${SKILL_FILE} folders.`,
    );
  }
  if (!isDirectory) {
    throw new Error(
      `skillsFromDir: '${dir}' is a file, not a directory. Pass the directory that holds ` +
        `your ${SKILL_FILE} folders.`,
    );
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  // `dir/SKILL.md` — the whole directory is one skill.
  if (entries.some((e) => e.isFile() && e.name === SKILL_FILE)) {
    files.push(join(dir, SKILL_FILE));
  }
  // `dir/<folder>/SKILL.md` — the portable layout.
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = join(dir, entry.name, SKILL_FILE);
    try {
      if ((await stat(candidate)).isFile()) files.push(candidate);
    } catch {
      // A subdirectory without a SKILL.md is not an error — a skill folder can
      // sit next to assets, fixtures, or anything else the author keeps here.
    }
  }

  if (files.length === 0) {
    throw new Error(
      `skillsFromDir: no ${SKILL_FILE} found under '${dir}'. Expected '${dir}/<skill>/${SKILL_FILE}' ` +
        `or '${dir}/${SKILL_FILE}'.`,
    );
  }

  const parsed: ParsedSkillFile[] = [];
  for (const file of files.sort()) {
    parsed.push(parseSkillFile(await readFile(file, 'utf8'), file));
  }

  // Collisions are refused naming BOTH files: with only the id in the message
  // you would know a duplicate exists and still have to go find the pair.
  const byName = new Map<string, ParsedSkillFile>();
  for (const skill of parsed) {
    const clash = byName.get(skill.name);
    if (clash) {
      throw new Error(
        `skillsFromDir: two files claim the skill name '${skill.name}' — '${clash.file}' and ` +
          `'${skill.file}'. Skill ids must be unique (read_skill dispatches by id); rename one.`,
      );
    }
    byName.set(skill.name, skill);
  }

  // The registry, indexed once for the whole directory. Built even when no file
  // declares tools — an empty Map costs nothing and keeps the resolve path one
  // shape. `undefined` (option omitted) is DISTINCT from an empty registry: the
  // refusals say different things, because the fixes are different.
  const registry = indexToolRegistry(opts.tools);

  const sorted = parsed.slice().sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const skills = sorted.map((skill) => {
    const tools = resolveDeclaredTools(skill, opts.tools, registry);
    return defineSkill({
      id: skill.name,
      description: skill.description,
      body: skill.body,
      ...(tools !== undefined && { tools }),
      ...(skill.steps !== undefined && { steps: skill.steps }),
      ...(skill.onSkip !== undefined && { onSkip: skill.onSkip }),
      ...(opts.surfaceMode !== undefined && { surfaceMode: opts.surfaceMode }),
    });
  });
  return { parsed: sorted, skills };
}

// ─── Authorship guard ──────────────────────────────────────────────

/**
 * Refuse a `viaToolName` option that no longer exists (9.0.0 grace error).
 *
 * Deprecated in 8.7.0, removed here — see the same guard in `defineSkill` for
 * the whole story. It is refused rather than ignored because a directory
 * loaded with this option used to produce skills that an agent then REFUSED at
 * mount, and silently accepting them now would be a downgrade: the caller
 * would believe a per-directory activation tool exists. It never did.
 *
 * Deleted in 10.0.0.
 */
function assertNoViaToolNameOption(opts: object): void {
  const legacy = (opts as { readonly viaToolName?: unknown }).viaToolName;
  if (legacy === undefined) return;
  throw new Error(
    `skillsFromDir: \`viaToolName\` was removed in 9.0.0 (deprecated since 8.7.0), and this ` +
      `call passes '${String(legacy)}'. Nothing ever read it — 'read_skill' is the only ` +
      `activation tool this library builds, and every skill loaded here already shares it. ` +
      `Drop the option; the model picks WHICH skill by id.`,
  );
}

/**
 * Refuse anything that is not a local path, BY NAME. The message quotes what
 * was passed, because the whole point is that the reader can see the thing
 * that was rejected.
 */
function assertLocalDirectoryArgument(dir: unknown): asserts dir is string {
  if (typeof dir !== 'string' || dir.trim().length === 0) {
    throw new Error(`skillsFromDir: expected a local directory path, got ${JSON.stringify(dir)}.`);
  }
  const scheme = URL_LIKE_RE.exec(dir);
  if (scheme) {
    throw new Error(
      `skillsFromDir: '${dir}' is a ${scheme[0].slice(0, -3)} URL, not a local directory. ` +
        `Skill bodies are instructions to a model, so this loader only reads files you own ` +
        `at build time — fetch remote content yourself, review it, and pass defineSkill(...) ` +
        `the result.`,
    );
  }
  if (dir.startsWith('\\\\')) {
    throw new Error(
      `skillsFromDir: '${dir}' is a network (UNC) path, not a local directory. ` +
        `Skill bodies are instructions to a model, so this loader only reads files you own ` +
        `at build time.`,
    );
  }
}

// ─── Tool resolution (names on disk → Tools from your code) ────────

/**
 * Index the caller's registry by wire name.
 *
 * `undefined` in, empty Map out — the CALLER's `undefined` is remembered
 * separately by `resolveDeclaredTools`, because "you passed no registry" and
 * "your registry does not carry that one" need different sentences.
 *
 * Two registry entries under one name is refused here rather than resolved by
 * last-wins: which of the two a skill got would depend on array order, and a
 * skill silently running the wrong `execute` is the failure this whole door is
 * supposed to make impossible.
 */
function indexToolRegistry(tools: readonly Tool[] | undefined): ReadonlyMap<string, Tool> {
  const index = new Map<string, Tool>();
  for (const tool of tools ?? []) {
    const name = tool?.schema?.name;
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error(
        `skillsFromDir: the \`tools\` registry contains an entry with no \`schema.name\`. ` +
          `Every entry must be a Tool (defineTool(...) produces one) — a SKILL.md resolves ` +
          `tools BY NAME, so an unnamed one can never be picked.`,
      );
    }
    const prior = index.get(name);
    if (prior !== undefined && prior !== tool) {
      throw new Error(
        `skillsFromDir: the \`tools\` registry carries two different tools named '${name}'. ` +
          `A SKILL.md names a tool by that string, so which implementation a skill got would ` +
          `depend on array order. Rename one, or pass only the one you mean.`,
      );
    }
    index.set(name, tool);
  }
  return index;
}

/** The registry's names, sorted and capped — the material every refusal ends with. */
function availableNames(registry: ReadonlyMap<string, Tool>): string {
  if (registry.size === 0) return '(the registry you passed is empty)';
  const names = [...registry.keys()].sort();
  const shown = names.slice(0, NAMES_IN_REFUSAL).join(', ');
  return names.length > NAMES_IN_REFUSAL
    ? `${shown}, …and ${names.length - NAMES_IN_REFUSAL} more`
    : shown;
}

/**
 * Turn one file's declared tool NAMES into real Tools, or refuse by name.
 *
 * Undefined out means the file declared no `tools:` key — a prose-only skill,
 * byte-identical to what this loader has always produced. It never means "the
 * names did not resolve": that throws.
 */
function resolveDeclaredTools(
  skill: ParsedSkillFile,
  passed: readonly Tool[] | undefined,
  registry: ReadonlyMap<string, Tool>,
): readonly Tool[] | undefined {
  if (skill.toolNames === undefined) return undefined;
  // The commonest mistake, and the one with the most misleading failure: the
  // file is right, the call site forgot the half a file cannot carry. Refused
  // with the whole list it asked for, so the fix is a copy-paste.
  if (passed === undefined) {
    throw new Error(
      `skillsFromDir: '${skill.file}' declares tools '${skill.toolNames.join(', ')}', but ` +
        `skillsFromDir was called without a tool registry. A markdown file can NAME a tool; ` +
        `only your code can supply one. Pass them: ` +
        `skillsFromDir(dir, { tools: [${skill.toolNames.join(', ')}] }). ` +
        `(If \`tools\` in this file belongs to another program, rename that key — it is a ` +
        `key this loader now reads.)`,
    );
  }
  const resolved: Tool[] = [];
  for (const name of skill.toolNames) {
    const tool = registry.get(name);
    if (tool === undefined) {
      throw new Error(
        `skillsFromDir: '${skill.file}' names the tool '${name}', which the \`tools\` registry ` +
          `passed to skillsFromDir does not carry. A skill that loads without the tool it ` +
          `asked for still runs and still sounds sure of itself, so this is refused instead. ` +
          `Add it to the registry, or fix the name — available: ${availableNames(registry)}.`,
      );
    }
    resolved.push(tool);
  }
  return resolved;
}

// ─── Frontmatter ───────────────────────────────────────────────────

/**
 * One frontmatter value: a scalar (`key: value`) or a block list (`key:` with
 * nothing after it, followed by indented `- …` items).
 *
 * The list arm exists because `steps` is PAIRS — `{ tool, note }` — and a
 * single line cannot carry an ordered list of pairs without inventing a
 * separator soup that nobody can read at 5pm. A `- <tool>: <why>` item reuses
 * the `key: value` rule the frontmatter already has, one level in.
 */
type FieldValue =
  | { readonly kind: 'scalar'; readonly text: string }
  | { readonly kind: 'list'; readonly items: readonly ListItem[] };

interface ListItem {
  /** Text before the first `:`, or the whole item when it has none. */
  readonly key: string;
  /** Text after the first `:`, unquoted. Undefined when the item has no colon. */
  readonly value?: string;
  /** 1-based line number in the file — every refusal quotes it. */
  readonly line: number;
}

/**
 * Parse one `SKILL.md`. Every refusal names the file — a loader that says
 * "malformed frontmatter" over a directory of forty files has told you nothing.
 *
 * The grammar is deliberately small: an opening `---` line, `key: value` lines
 * (`#` comments and blank lines skipped, single/double quotes stripped), a
 * closing `---` line, then the body. A key with NOTHING after the colon opens a
 * block list, whose items are the following `- …` lines. Keys other than the
 * five known ones are IGNORED rather than rejected, so a file carrying extra
 * frontmatter for another tool still loads here.
 */
function parseSkillFile(raw: string, file: string): ParsedSkillFile {
  // Strip a UTF-8 BOM — an editor artifact, not the author's intent.
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const lines = text.split(/\r?\n/);

  if (lines[0]?.trim() !== '---') {
    throw new Error(
      `skillsFromDir: '${file}' does not start with a '---' frontmatter block. ` +
        `Expected:\n---\nname: my-skill\ndescription: When to use it.\n---\n<the body>`,
    );
  }

  const closingIndex = lines.findIndex((line, i) => i > 0 && line.trim() === '---');
  if (closingIndex === -1) {
    throw new Error(
      `skillsFromDir: '${file}' opens a '---' frontmatter block that is never closed. ` +
        `Add a '---' line after the last frontmatter key.`,
    );
  }

  const fields = parseFrontmatterFields(lines, closingIndex, file);

  const name = readScalar(fields, 'name', file);
  const description = readScalar(fields, 'description', file);
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .trim();

  if (name.length === 0) {
    throw new Error(
      `skillsFromDir: '${file}' frontmatter is missing 'name'. It becomes the skill id the ` +
        `model passes to read_skill.`,
    );
  }
  if (!SKILL_NAME_RE.test(name)) {
    throw new Error(
      `skillsFromDir: '${file}' frontmatter name '${name}' must match ` +
        `/^[a-zA-Z0-9_-]{1,64}$/ — it is the id the model passes to read_skill.`,
    );
  }
  if (description.length === 0) {
    throw new Error(
      `skillsFromDir: '${file}' frontmatter is missing 'description'. It is the ONLY thing ` +
        `the model reads when deciding whether to open this skill.`,
    );
  }
  if (body.length === 0) {
    throw new Error(
      `skillsFromDir: '${file}' has no body after the closing '---'. The body is what the ` +
        `model reads once it activates the skill.`,
    );
  }

  const toolNames = readToolNames(fields, file);
  const steps = readSteps(fields, file, toolNames);
  const onSkip = readOnSkip(fields, file, steps);
  const routes = readRoutes(fields, file, toolNames);

  return {
    name,
    description,
    body,
    ...(toolNames !== undefined && { toolNames }),
    ...(steps !== undefined && { steps }),
    ...(onSkip !== undefined && { onSkip }),
    ...(routes !== undefined && { routes }),
    file,
  };
}

/**
 * The frontmatter lines → `key → value` map.
 *
 * A `- …` line is an ITEM only while a list is open (the line above it was a
 * key with an empty value). Anywhere else it falls through to the `key: value`
 * rule exactly as it always did — so a stray dash in somebody's unknown key
 * keeps loading, and only a deliberate block list is read as one.
 */
function parseFrontmatterFields(
  lines: readonly string[],
  closingIndex: number,
  file: string,
): ReadonlyMap<string, FieldValue> {
  const fields = new Map<string, FieldValue>();
  let openList: ListItem[] | undefined;
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith('#')) continue;

    if (openList !== undefined && (trimmed === '-' || trimmed.startsWith('- '))) {
      const item = trimmed === '-' ? '' : trimmed.slice(2).trim();
      const separator = item.indexOf(':');
      openList.push(
        separator === -1
          ? { key: item, line: i + 1 }
          : {
              key: item.slice(0, separator).trim(),
              value: unquote(item.slice(separator + 1).trim()),
              line: i + 1,
            },
      );
      continue;
    }

    const separator = line.indexOf(':');
    if (separator === -1) {
      throw new Error(
        `skillsFromDir: '${file}' frontmatter line ${i + 1} is not 'key: value' — got ` +
          `${JSON.stringify(line)}.`,
      );
    }
    const key = line.slice(0, separator).trim();
    if (key.length === 0) {
      throw new Error(
        `skillsFromDir: '${file}' frontmatter line ${i + 1} has an empty key — got ` +
          `${JSON.stringify(line)}.`,
      );
    }
    const value = unquote(line.slice(separator + 1).trim());
    if (value.length === 0) {
      // An empty value OPENS a list. With no items after it the field stays an
      // empty list, which every reader below treats exactly as the empty string
      // it used to be — so `name:` with nothing after it still says "missing
      // 'name'", not something new about lists.
      const items: ListItem[] = [];
      openList = items;
      fields.set(key, { kind: 'list', items });
    } else {
      openList = undefined;
      fields.set(key, { kind: 'scalar', text: value });
    }
  }
  return fields;
}

/** A single-valued key, as it always read. An empty block list reads as '' — a
 *  key with nothing under it never carried a value in the first place. */
function readScalar(fields: ReadonlyMap<string, FieldValue>, key: string, file: string): string {
  const field = fields.get(key);
  if (field === undefined) return '';
  if (field.kind === 'scalar') return field.text;
  if (field.items.length === 0) return '';
  throw new Error(
    `skillsFromDir: '${file}' frontmatter '${key}' is a list, and '${key}' takes one value. ` +
      `Write it as '${key}: <value>' on one line.`,
  );
}

/**
 * `tools:` → the declared names, or undefined when the key is absent.
 *
 * Two spellings, because both read naturally at the size they are for:
 * `tools: a, b` for the two-tool skill, and a block list once there are six.
 */
function readToolNames(
  fields: ReadonlyMap<string, FieldValue>,
  file: string,
): readonly string[] | undefined {
  const field = fields.get('tools');
  if (field === undefined) return undefined;

  const names =
    field.kind === 'scalar'
      ? field.text
          .split(',')
          .map((n) => unquote(n.trim()))
          .filter((n) => n.length > 0)
      : field.items.map((item) => {
          if (item.value !== undefined) {
            throw new Error(
              `skillsFromDir: '${file}' line ${item.line}: a 'tools' item is a NAME, not a ` +
                `pair — write '- ${item.key}'. (Did you mean to put this under 'steps', where ` +
                `each item is '- <tool>: <why>'?)`,
            );
          }
          return item.key;
        });

  if (names.length === 0) {
    throw new Error(
      `skillsFromDir: '${file}' declares 'tools' with no names. Say what you mean and omit ` +
        `the key — a skill with no tools is exactly what this loader has always produced. ` +
        `Otherwise: 'tools: lookup_order, issue_refund', or a '- <name>' block list.`,
    );
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) {
      throw new Error(
        `skillsFromDir: '${file}' lists the tool '${name}' twice in 'tools'. Each tool ` +
          `belongs to a skill once (a skill's tools must be unique within itself); repeat it ` +
          `in 'steps' instead if the procedure runs it twice.`,
      );
    }
    seen.add(name);
  }
  return names;
}

/**
 * `steps:` → the procedure, as data.
 *
 * Validated against the file's OWN `tools` here, ahead of `defineSkill`'s
 * identical check, for one reason: this message can name the FILE and the LINE.
 * `defineSkill` sees a skill id and cannot.
 */
function readSteps(
  fields: ReadonlyMap<string, FieldValue>,
  file: string,
  toolNames: readonly string[] | undefined,
): readonly SkillStep[] | undefined {
  const field = fields.get('steps');
  if (field === undefined) return undefined;
  if (field.kind === 'scalar') {
    throw new Error(
      `skillsFromDir: '${file}' writes 'steps' on one line, and a procedure is an ORDERED ` +
        `list of pairs. Write it as a block:\nsteps:\n  - lookup_order: look up the order ` +
        `first\n  - issue_refund: refund only what the lookup found`,
    );
  }
  if (field.items.length === 0) {
    throw new Error(
      `skillsFromDir: '${file}' declares 'steps' with no items. Say what you mean and omit ` +
        `the key — a skill without steps is byte-identical to one that never heard of them.`,
    );
  }
  if (toolNames === undefined) {
    throw new Error(
      `skillsFromDir: '${file}' declares 'steps' but no 'tools'. Every step runs one of the ` +
        `skill's own tools, so a sequence with nothing to sequence can never engage. Add ` +
        `'tools: …', or drop 'steps'.`,
    );
  }
  const declared = new Set(toolNames);
  return field.items.map((item) => {
    if (item.value === undefined || item.value.length === 0) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: every step is '- <tool>: <why>' and ` +
          `this one has no why. The note is the sentence the model reads about why the step ` +
          `exists — a step without one is a force-march instruction, and the note is the ` +
          `whole point.`,
      );
    }
    if (item.key.length === 0) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: this step names no tool. Every step is ` +
          `'- <tool>: <why>'.`,
      );
    }
    if (!declared.has(item.key)) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: step '${item.key}' is not in this ` +
          `file's 'tools' (${toolNames.join(', ')}). Steps may only sequence the skill's own ` +
          `tools — add it to 'tools', or fix the name. Everything else the agent has stays ` +
          `available as an escape hatch, unsequenced.`,
      );
    }
    return { tool: item.key, note: item.value };
  });
}

/**
 * `routes:` → the edges out of this skill (9.43.0), as data.
 *
 * A block list, like `steps:` and for the same reason: routing is an ordered
 * list of pairs (a target and its guard), and one line cannot carry that
 * without a separator soup. The grammar itself — and every refusal in it —
 * lives in `skillsFromDirRoutes.ts`; this reader only decides that the key is
 * present and shaped like a list.
 */
function readRoutes(
  fields: ReadonlyMap<string, FieldValue>,
  file: string,
  toolNames: readonly string[] | undefined,
): readonly DeclaredRoute[] | undefined {
  const field = fields.get('routes');
  if (field === undefined) return undefined;
  if (field.kind === 'scalar') {
    throw new Error(
      `skillsFromDir: '${file}' writes 'routes' on one line, and routing is a LIST of edges ` +
        `(each with its own guard). Write it as a block:\nroutes:\n  - escalation: on ` +
        `issue_refund status=denied\n  - receipts: on issue_refund`,
    );
  }
  return readDeclaredRoutes(field.items, file, toolNames);
}

/** `onSkip:` → the skip policy. Refused here rather than at `defineSkill` so
 *  the message can name the file the author has to open. */
function readOnSkip(
  fields: ReadonlyMap<string, FieldValue>,
  file: string,
  steps: readonly SkillStep[] | undefined,
): OnSkipPolicy | undefined {
  if (fields.get('onSkip') === undefined) return undefined;
  const raw = readScalar(fields, 'onSkip', file);
  if (steps === undefined) {
    throw new Error(
      `skillsFromDir: '${file}' declares 'onSkip' with no 'steps'. It says what a SKIPPED ` +
        `step does, and this file declares no steps. Add 'steps:', or drop 'onSkip'.`,
    );
  }
  if (raw !== 'advance' && raw !== 'hold') {
    throw new Error(
      `skillsFromDir: '${file}' declares onSkip '${raw}', which is not a policy this ` +
        `library has. The two are 'advance' (record the skip and move on — the default) and ` +
        `'hold' (record the skip and keep the step current).`,
    );
  }
  return raw;
}

/** Strip one layer of matching single or double quotes from a YAML-ish scalar. */
function unquote(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
