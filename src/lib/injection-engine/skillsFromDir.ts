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
 * ── What a SKILL.md can and cannot carry ─────────────────────────────────────
 * `name`, `description`, the body. That is the whole per-file surface, and the
 * limits follow from it rather than from an oversight:
 *
 *   - **no `tools`** — a tool is code with an `execute`, and a markdown file has
 *     none. Every loaded skill is body-only. To give one tools, define that skill
 *     with `defineSkill` and mix the lists (`[...loaded, codeAuthored]`), or put
 *     the tools on the route target you declare in code.
 *   - **no `autoActivate`** — so a loaded skill never scopes the agent's tool list
 *     on its own (it has no tools to scope).
 *   - **no per-file `surfaceMode`, `cache` or `refreshPolicy`** — `surfaceMode` is
 *     settable for the WHOLE directory via `opts`, all of them or none; the others
 *     take `defineSkill`'s defaults.
 *   - unknown frontmatter keys are IGNORED, not rejected, so a file carrying
 *     another tool's metadata still loads here.
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
 * Node-only. `node:fs/promises` and `node:path` are imported lazily inside the
 * call, the same gating `lib/tool-lint/cli.ts` uses: this module is reachable
 * from the `agentfootprint/context` barrel, and a TOP-LEVEL node:fs
 * import detonates a browser bundle at module-eval even when nothing calls it.
 */

import type { Injection } from './types.js';
import { defineSkill, type SurfaceMode } from './factories/defineSkill.js';

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

export interface SkillsFromDirOptions {
  /**
   * Where a loaded skill's body lands once activated. Defaults to
   * `defineSkill`'s own default, `'auto'`. See {@link SurfaceMode}.
   */
  readonly surfaceMode?: SurfaceMode;
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
  /** Absolute-ish path as given to the reader — what error messages quote. */
  readonly file: string;
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
 *   (the message names the file); or when two files claim the same skill name
 *   (the message names both).
 */
export async function skillsFromDir(
  dir: string,
  opts: SkillsFromDirOptions = {},
): Promise<readonly Injection[]> {
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

  return parsed
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((skill) =>
      defineSkill({
        id: skill.name,
        description: skill.description,
        body: skill.body,
        ...(opts.surfaceMode !== undefined && { surfaceMode: opts.surfaceMode }),
      }),
    );
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

// ─── Frontmatter ───────────────────────────────────────────────────

/**
 * Parse one `SKILL.md`. Every refusal names the file — a loader that says
 * "malformed frontmatter" over a directory of forty files has told you nothing.
 *
 * The grammar is deliberately small: an opening `---` line, `key: value` lines
 * (`#` comments and blank lines skipped, single/double quotes stripped), a
 * closing `---` line, then the body. Keys other than `name` and `description`
 * are IGNORED rather than rejected, so a file carrying extra frontmatter for
 * another tool still loads here.
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

  const fields = new Map<string, string>();
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i] ?? '';
    if (line.trim().length === 0 || line.trimStart().startsWith('#')) continue;
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
    fields.set(key, unquote(line.slice(separator + 1).trim()));
  }

  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
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

  return { name, description, body, file };
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
