/**
 * skillsFromDirRoutes — the `routes:` half of the on-disk runbook grammar.
 *
 * ## What a file may say about routing, and why it is this little
 *
 * `skillsFromDir` reads prose, `tools:` and `steps:` — everything about ONE
 * skill — and stopped exactly where the value was supposed to start: the
 * routing. A directory of runbooks still had to be hand-wired into a graph in
 * code, which is the work the graph exists to remove.
 *
 * This module adds the missing key under the SAME security law the tools list
 * follows: **the file PICKS, it never DEFINES.**
 *
 *   ---
 *   name: billing
 *   tools: lookup_order, issue_refund
 *   routes:
 *     - escalation: on issue_refund status=denied
 *     - receipts: on issue_refund
 *     - audit
 *   ---
 *
 * A route names a SKILL ID and, optionally, a guard. Both halves are picks:
 *
 *   • the id is resolved against the skills THIS DIRECTORY declares — an id
 *     nothing here declares is refused at load, by name, listing what is
 *     available. Never a half-graph: one bad id fails the whole load, because
 *     a graph missing one edge routes silently wrong, which is worse than a
 *     graph that refuses to exist;
 *   • the guard is one of the two DATA conditions a route already has
 *     (`onToolReturn`, `onToolStatus`), and the tool it names must be one of
 *     this file's own `tools:` — the same law `steps:` follows, for the same
 *     reason (an edge out of this skill fires on this skill's work).
 *
 * Nothing is evaluated, imported or resolved as a path. The strings can only
 * MATCH — against ids the loader already read off disk and against a closed
 * status vocabulary.
 *
 * ## What a file CANNOT express, said plainly
 *
 * A `when:` predicate is CODE. There is no honest way for a markdown file to
 * carry it: reading one would mean evaluating a string, which is the one thing
 * this loader exists never to do. So the grammar has no `when` and no
 * expression language of any kind — a conditional a file cannot express is a
 * conditional that stays in code:
 *
 *   skillGraph({ skills, steps: [{ from: 'billing', to: 'escalation',
 *                                  when: r => JSON.parse(r.result).tier > 2 }] });
 *
 * Anything that is not one of the three forms is refused with the whole grammar
 * quoted, rather than half-understood by a parser inventing a mini-language.
 *
 * Zone: HOST (it belongs to the file loader). Pure over strings all the same —
 * it reads no filesystem; `skillsFromDir.ts` hands it the parsed lines.
 */

import type { SkillGraphStep } from './skillGraph.js';
import { TOOL_RESULT_STATUSES, type ToolResultStatus } from './toolOutcome.js';

/**
 * One frontmatter list item, structurally — `skillsFromDir`'s module-private
 * `ListItem` satisfies it unchanged, so the two never import each other.
 */
export interface RouteItem {
  /** Text before the first `:` — the target skill id. */
  readonly key: string;
  /** Text after the first `:` — the guard. Undefined when the item has none. */
  readonly value?: string;
  /** 1-based line number in the file. Every refusal quotes it. */
  readonly line: number;
}

/** One route as the FILE declared it: a target id and a parsed guard. The id is
 *  still unresolved here — a file cannot know what the rest of the directory
 *  carries, so that refusal waits for {@link toGraphSteps}. */
export interface DeclaredRoute {
  readonly to: string;
  readonly onToolReturn?: string;
  readonly onToolStatus?: readonly ToolResultStatus[];
  readonly line: number;
}

/** The grammar, quoted back by every refusal — one string, so the three forms
 *  can never be described two different ways. */
const ROUTE_GRAMMAR =
  '  - <skill>                                  (no guard — a model edge: the graph draws it and ' +
  'read_skill may take it)\n' +
  "  - <skill>: on <tool_name>                  (this skill's own tool returned)\n" +
  '  - <skill>: status=denied                   (a tool of this skill declared that outcome)\n' +
  '  - <skill>: on <tool_name> status=denied,failure\n' +
  `Statuses: ${TOOL_RESULT_STATUSES.join(', ')}.`;

/** `on <tool>`, `status=a,b`, or both in that order. Anything else is refused. */
const GUARD_RE = /^(?:on\s+([A-Za-z0-9_-]+))?\s*(?:status=([A-Za-z,\s]+))?$/;

/**
 * Read one file's `routes:` items into declared routes, refusing every shape
 * the grammar does not carry. Pure; every message names the file and the line,
 * because "malformed routes" over a directory of forty runbooks has told the
 * author nothing.
 *
 * @param items      the `routes:` block-list items, in file order.
 * @param file       the path, quoted by every refusal.
 * @param toolNames  this file's own `tools:` — a guard may only name one of
 *                   them (undefined when the file declared no tools at all).
 */
export function readDeclaredRoutes(
  items: readonly RouteItem[],
  file: string,
  toolNames: readonly string[] | undefined,
): readonly DeclaredRoute[] {
  if (items.length === 0) {
    throw new Error(
      `skillsFromDir: '${file}' declares 'routes' with no items. Say what you mean and omit ` +
        `the key — a skill that routes nowhere is byte-identical to one that never heard of ` +
        `routes. Otherwise:\nroutes:\n${ROUTE_GRAMMAR}`,
    );
  }
  const declared = new Set(toolNames ?? []);
  const seen = new Set<string>();
  return items.map((item) => {
    if (item.key.length === 0) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: this route names no skill. Every route ` +
          `is:\n${ROUTE_GRAMMAR}`,
      );
    }
    if (seen.has(item.key)) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: routes to '${item.key}' twice. Two edges ` +
          `between the same pair means the first one that fires wins and the second is dead ` +
          `wiring — keep the guard you meant, and drop the other.`,
      );
    }
    seen.add(item.key);

    const guard = item.value?.trim() ?? '';
    if (guard.length === 0) return { to: item.key, line: item.line };

    const parsed = GUARD_RE.exec(guard);
    const toolName = parsed?.[1];
    const statusList = parsed?.[2];
    if (parsed === null || (toolName === undefined && statusList === undefined)) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: the route to '${item.key}' declares the ` +
          `guard '${guard}', which this grammar cannot express. A SKILL.md PICKS, it never ` +
          `DEFINES — a \`when\` predicate is code, and nothing in a SKILL.md is ever ` +
          `evaluated, so the only guards a file can carry are the two DATA conditions a route ` +
          `already has:\n${ROUTE_GRAMMAR}\nA conditional a file cannot express stays in code: ` +
          `skillGraph({ skills, steps: [{ from: '<this skill>', to: '${item.key}', when: r => ` +
          `… }] }).`,
      );
    }

    if (toolName !== undefined && !declared.has(toolName)) {
      throw new Error(
        `skillsFromDir: '${file}' line ${item.line}: the route to '${item.key}' fires on ` +
          `'${toolName}', which is not in this file's 'tools'${
            toolNames === undefined ? ' (this file declares none)' : ` (${toolNames.join(', ')})`
          }. An edge out of this skill fires on THIS skill's work, so it may only name a tool ` +
          `the skill carries — add it to 'tools:', fix the name, or declare this edge in code ` +
          `where the whole agent's tools are in hand.`,
      );
    }

    const statuses = (statusList ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const status of statuses) {
      if (!(TOOL_RESULT_STATUSES as readonly string[]).includes(status)) {
        throw new Error(
          `skillsFromDir: '${file}' line ${item.line}: the route to '${item.key}' names the ` +
            `status '${status}', which is not one this library has. The vocabulary is closed ` +
            `so both sides spell an outcome identically: ${TOOL_RESULT_STATUSES.join(', ')}.`,
        );
      }
    }

    return {
      to: item.key,
      ...(toolName !== undefined && { onToolReturn: toolName }),
      ...(statuses.length > 0 && { onToolStatus: statuses as readonly ToolResultStatus[] }),
      line: item.line,
    };
  });
}

/**
 * Resolve one file's declared routes into graph steps, refusing an id no
 * SKILL.md in the directory declares.
 *
 * The refusal lists what IS available and fails the whole load. A route to a
 * name nothing declares is the one mistake that cannot be reported later: the
 * loader would return a skill set the graph then wires with a missing edge, and
 * a graph that silently does not route is exactly the failure the check-up
 * exists to prevent. Half a graph is not a smaller version of the graph.
 *
 * @param from   the id of the skill whose file declared these routes.
 * @param file   that skill's path, quoted by the refusal.
 * @param known  every skill id the directory declared.
 */
export function toGraphSteps(
  from: string,
  routes: readonly DeclaredRoute[],
  file: string,
  known: ReadonlySet<string>,
): readonly SkillGraphStep[] {
  return routes.map((route) => {
    if (!known.has(route.to)) {
      const available = [...known].sort().join(', ');
      throw new Error(
        `skillsFromDir: '${file}' line ${route.line} routes to '${route.to}', which no ` +
          `SKILL.md in this directory declares. A route NAMES a skill; a file can never ` +
          `define one, so an unresolved id would leave you a graph with a missing edge that ` +
          `nothing routes and nothing reports. Available skills: ${available}. Fix the name, ` +
          `add the skill folder, or declare this edge in code.`,
      );
    }
    return {
      from,
      to: route.to,
      ...(route.onToolReturn !== undefined && { onToolReturn: route.onToolReturn }),
      ...(route.onToolStatus !== undefined && { onToolStatus: route.onToolStatus }),
    };
  });
}
