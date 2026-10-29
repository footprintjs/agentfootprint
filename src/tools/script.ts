/**
 * tools/script — a tool's declaration that it RUNS a program, and the one rule
 * that judges the declaration.
 *
 * Pattern: Map. `Tool.script` is plain data on the tool, judged by ONE assert
 *          at the three doors a declaration crosses (the `askOrAssume`
 *          precedent, `tools/declare.ts`): definition (`tools.ts` ·
 *          `defineTool`), dispatch (`scriptOf`, for a Tool built by hand or
 *          served by a ToolProvider, which never passes `defineTool`) and MCP
 *          ingest (`mcp/toolExtras.ts` · `readToolExtras`).
 * Role:    tools/ layer leaf (L7). Imports nothing from the agent.
 * Emits:   N/A.
 *
 * ## Declared, never inferred
 *
 * A tool is code-running because it SAYS so. The library never reads it off a
 * tool's name (`run_code`), a property named `code` or the description. A tool
 * that runs code and does not declare it has no submissions on the record, so
 * a script the model shows for it is prose, as it always was. `codeRunnerTool`
 * declares `{ argument: 'code', language }` on the tool it builds.
 *
 * What the declaration arms (design: docs/design/2026-10-script-artifact.md):
 * the dispatch loop files one `script` row per call of the tool while
 * `.namesAndNumbersFromEvidence({ code: 'match' })` or
 * `.scriptTravelsWithTheAnswer()` is on — the program SUBMITTED to the tool,
 * and what the runner reported. Never evidence for a value.
 *
 * @example
 * ```ts
 * const runSql = defineTool({
 *   name: 'run_sql',
 *   description: 'Run a read-only SQL query and print the rows.',
 *   inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
 *   script: { argument: 'query', language: 'sql' },
 *   execute: async ({ query }) => db.read(query),
 * });
 * ```
 */

import { isDevMode } from 'footprintjs';

/** Where a code-running tool's program travels, and its language. */
export interface ToolScript {
  /** The ONE string argument of the input schema that carries the program. */
  readonly argument: string;
  /**
   * The program's language — the info string of the fence the library renders
   * the program in (`python`, `sql`). One plain token: no line break, no
   * backtick (a backtick fence's info string may not hold one), at most 64
   * characters. Absent → a fence with no info string.
   */
  readonly language?: string;
}

const MAX_LANGUAGE_CHARS = 64;
const KEYS: readonly string[] = ['argument', 'language'];

/** Whether a unit may sit in a fence's info string: printable, no backtick. */
function infoUnitAllowed(unit: number): boolean {
  if (unit < 0x20 || unit === 0x7f || unit === 0x60) return false;
  // Line and paragraph separators end a line for some readers.
  return unit !== 0x2028 && unit !== 0x2029;
}

/**
 * The one judge of a `script` declaration: refuses, naming the tool, the field
 * and the fix — a declaration the dispatch loop could not honour, never one it
 * would quietly repair.
 *
 * - a plain object holding only `argument` and `language`;
 * - `argument` names a property of the input schema whose `type` is `'string'`
 *   (a program is text), and not a `wants` argument (that one carries an
 *   artifact ref, then its data — never the program);
 * - `language`, when present, is one plain token the fence can carry.
 */
export function assertToolScript(
  toolName: string,
  script: unknown,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
  wants?: Readonly<Record<string, unknown>>,
): void {
  if (script === undefined) return;
  const at = `defineTool('${toolName}'): \`script\``;
  if (script === null || typeof script !== 'object' || Array.isArray(script)) {
    throw new Error(
      `${at} must be { argument, language? } — the string argument that carries the program ` +
        `and its language. Got ${
          script === null ? 'null' : Array.isArray(script) ? 'an array' : typeof script
        }.`,
    );
  }
  const unknown = Object.keys(script).filter((k) => !KEYS.includes(k));
  if (unknown.length > 0) {
    throw new Error(
      `${at} has unknown key(s) ${unknown.map((k) => `'${k}'`).join(', ')}. ` +
        'It holds `argument` (the string argument carrying the program) and `language`.',
    );
  }
  const { argument, language } = script as { argument?: unknown; language?: unknown };
  if (typeof argument !== 'string' || argument.length === 0) {
    throw new Error(
      `${at}.argument must name the ONE string argument that carries the program — got ` +
        `${JSON.stringify(argument) ?? typeof argument}.`,
    );
  }
  const properties = (inputSchema as { properties?: unknown } | undefined)?.properties;
  const property =
    properties !== null && typeof properties === 'object' && Object.hasOwn(properties, argument)
      ? (properties as Record<string, unknown>)[argument]
      : undefined;
  if (
    property === null ||
    typeof property !== 'object' ||
    (property as { type?: unknown }).type !== 'string'
  ) {
    throw new Error(
      `${at}.argument is '${argument}', which the input schema does not declare as a string ` +
        `property. Declare \`properties.${argument}: { type: 'string' }\` — the program is ` +
        'the text the model passes there.',
    );
  }
  if (wants !== undefined && Object.hasOwn(wants, argument)) {
    throw new Error(
      `${at}.argument is '${argument}', which is a \`wants\` argument: it carries an artifact ` +
        'ref, and then the artifact’s data — never the program. Name the argument that ' +
        'holds the code.',
    );
  }
  if (language === undefined) return;
  if (typeof language !== 'string' || language.length === 0) {
    throw new Error(
      `${at}.language must be a non-empty string (\`python\`, \`sql\`) when present — got ` +
        `${JSON.stringify(language) ?? typeof language}.`,
    );
  }
  if (language.length > MAX_LANGUAGE_CHARS) {
    throw new Error(
      `${at}.language is ${language.length} characters; at most ${MAX_LANGUAGE_CHARS}. It is ` +
        'the fence’s info string, one token.',
    );
  }
  for (let i = 0; i < language.length; i++) {
    if (!infoUnitAllowed(language.charCodeAt(i))) {
      throw new Error(
        `${at}.language holds a line break, a control character or a backtick. It becomes ` +
          'the info string of the fence the library renders the program in, which may carry ' +
          'none of them.',
      );
    }
  }
}

/** A frozen copy of a well-formed declaration: the two fields, nothing else. */
export function copyToolScript(script: ToolScript): ToolScript {
  return Object.freeze({
    argument: script.argument,
    ...(script.language !== undefined && { language: script.language }),
  });
}

/** The tool shape the dispatch door reads — structurally any `Tool`. */
export interface ScriptToolLike {
  readonly schema: {
    readonly name: string;
    readonly inputSchema?: Readonly<Record<string, unknown>>;
  };
  readonly script?: unknown;
  readonly wants?: Readonly<Record<string, unknown>>;
}

/** One verdict per tool object: a judged declaration, or `null` when refused. */
const verdicts = new WeakMap<object, ToolScript | null>();
/** Tools already warned about at the dispatch door — one warning per tool per process. */
const warned = new WeakSet<object>();

/**
 * THE DISPATCH DOOR — the tool's `script` declaration, judged once per tool
 * object, or `undefined` when it declares none.
 *
 * A tool built by hand or served by a ToolProvider never passed `defineTool`,
 * so its declaration is judged here by the same assert. One that fails it is
 * NOT a code-running tool for the record (no row is filed, a block the model
 * shows for it is prose) — never half-honoured — and dev mode names the rule
 * once, the MCP ingest law (`mcp/toolExtras.ts`): the rail stays unarmed and
 * the developer is told which and why.
 */
export function scriptOf(tool: ScriptToolLike | undefined): ToolScript | undefined {
  if (tool === undefined || tool.script === undefined) return undefined;
  const cached = verdicts.get(tool);
  if (cached !== undefined) return cached ?? undefined;
  let verdict: ToolScript | null;
  try {
    assertToolScript(tool.schema.name, tool.script, tool.schema.inputSchema, tool.wants);
    verdict = copyToolScript(tool.script as ToolScript);
  } catch (error) {
    verdict = null;
    if (isDevMode() && !warned.has(tool)) {
      warned.add(tool);
      // eslint-disable-next-line no-console
      console.warn(
        `agentfootprint: tool '${tool.schema.name}' declares a \`script\` the library cannot ` +
          `read, so its calls file no script row — ${
            error instanceof Error ? error.message : String(error)
          }`,
      );
    }
  }
  verdicts.set(tool, verdict);
  return verdict ?? undefined;
}
