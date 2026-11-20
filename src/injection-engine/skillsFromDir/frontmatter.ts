import type { OnSkipPolicy, SkillStep } from '../skillSteps.js';
import { readDeclaredRoutes, type DeclaredRoute } from '../skillsFromDirRoutes.js';

/**
 * Skill ids ride into `read_skill`'s `enum` and into the skill-graph's node
 * ids. The house tool-name charset keeps them quotable in a prompt, comparable
 * as plain strings, and safe as an object key.
 */
const SKILL_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

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

export { parseSkillFile };
export type { ParsedSkillFile };
