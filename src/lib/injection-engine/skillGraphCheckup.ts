/**
 * skillGraph check-up — build-time validation of a declared graph.
 *
 * Pure + side-effect-free. Catches wiring mistakes at authoring time instead of
 * mid-run: a skill nobody can reach, an edge to a skill that isn't in the graph,
 * two un-prioritized edges leaving one skill, a graph with no start, a self-loop.
 *
 * Surfaced two ways:
 *   • `graph.checkup()` → `{ ok, problems }` — always available, call it whenever.
 *   • `.build({ check: 'throw' | 'warn' | 'off' })` — run it at build time.
 *
 * `unreachable-skill` is a WARNING, not an error: a skill with no incoming edge is
 * still legitimately reachable by the model via `read_skill`. Only `unknown-skill`
 * and `no-entry` are true errors.
 */

export type GraphProblemCode =
  | 'unknown-skill'
  | 'no-entry'
  | 'unreachable-skill'
  | 'ambiguous-routes'
  | 'self-loop';

/** One issue found by the check-up. `kind: 'error'` fails `ok` (and `'throw'`). */
export interface GraphProblem {
  readonly kind: 'error' | 'warning';
  readonly code: GraphProblemCode;
  readonly message: string;
  /** The skill the problem is about (unreachable/ambiguous source). */
  readonly skill?: string;
  readonly from?: string;
  readonly to?: string;
}

/** Result of `graph.checkup()`. `ok` is false iff there is ≥1 `error`. */
export interface GraphCheckup {
  readonly ok: boolean;
  readonly problems: readonly GraphProblem[];
}

export interface CheckupInput {
  /** Every skill id IN the graph. */
  readonly skillIds: ReadonlySet<string>;
  /** Declared entry skill ids. */
  readonly entryIds: readonly string[];
  /** Declared edges; `deterministic` = has a `when`/`onToolReturn` predicate. */
  readonly routes: ReadonlyArray<{ fromId: string; toId: string; deterministic: boolean }>;
  /** Decision-`tree()` graphs are exhaustive by construction — only id checks apply. */
  readonly isTree: boolean;
}

/** Run the check-up. Pure. */
export function checkupGraph(input: CheckupInput): GraphCheckup {
  const { skillIds, entryIds, routes, isTree } = input;
  const problems: GraphProblem[] = [];

  // 1. unknown-skill (ERROR) — an entry/edge references a skill not in the graph.
  //    Vacuous under the fluent builder (every edge registers its skills); the real
  //    value is the object form, where skills are listed independently of the wiring.
  const referenced = new Set<string>(entryIds);
  for (const r of routes) {
    referenced.add(r.fromId);
    referenced.add(r.toId);
  }
  for (const id of referenced) {
    if (!skillIds.has(id)) {
      problems.push({
        kind: 'error',
        code: 'unknown-skill',
        message: `Skill "${id}" is referenced by an edge/entry but is not in the graph's skill list.`,
        skill: id,
      });
    }
  }

  if (isTree) {
    // Tree mode: predicate leaves are exhaustive by construction; reachability + entry
    // checks don't apply (the tree IS the entry).
    return { ok: !problems.some((p) => p.kind === 'error'), problems };
  }

  // 2. no-entry (ERROR) — a flat graph with no entry can never start.
  if (entryIds.length === 0) {
    problems.push({
      kind: 'error',
      code: 'no-entry',
      message: 'The graph has no entry skill — declare at least one `.entry(...)`.',
    });
  }

  // 3. unreachable-skill (WARNING) — BFS from the entries over the declared edges;
  //    a skill never reached is read_skill-only (legitimate, but often a mistake).
  const successors = new Map<string, string[]>();
  for (const r of routes) {
    const list = successors.get(r.fromId);
    if (list) list.push(r.toId);
    else successors.set(r.fromId, [r.toId]);
  }
  const reached = new Set<string>(entryIds);
  const queue = [...entryIds];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const to of successors.get(cur) ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  for (const id of skillIds) {
    if (!reached.has(id)) {
      problems.push({
        kind: 'warning',
        code: 'unreachable-skill',
        message: `Skill "${id}" is not reachable from any entry — it can only be reached by the model via read_skill.`,
        skill: id,
      });
    }
  }

  // 4. ambiguous-routes (WARNING) — ≥2 deterministic edges share a source skill with
  //    no priority field (there is none yet), so the first by declaration order wins.
  const deterministicByFrom = new Map<string, number>();
  for (const r of routes) {
    if (r.deterministic) deterministicByFrom.set(r.fromId, (deterministicByFrom.get(r.fromId) ?? 0) + 1);
  }
  for (const [from, count] of deterministicByFrom) {
    if (count >= 2) {
      problems.push({
        kind: 'warning',
        code: 'ambiguous-routes',
        message: `Skill "${from}" has ${count} outgoing edges with predicates and no priority — the first one matching (by declaration order) wins.`,
        from,
      });
    }
  }

  // 5. self-loop (WARNING) — an edge from a skill back to itself (rarely intended).
  for (const r of routes) {
    if (r.fromId === r.toId) {
      problems.push({
        kind: 'warning',
        code: 'self-loop',
        message: `Skill "${r.fromId}" has an edge to itself.`,
        from: r.fromId,
        to: r.toId,
      });
    }
  }

  return { ok: !problems.some((p) => p.kind === 'error'), problems };
}

/** Format a check-up for a thrown error / console warning. */
export function formatCheckup(checkup: GraphCheckup): string {
  return checkup.problems
    .map((p) => `  [${p.kind}] ${p.code}: ${p.message}`)
    .join('\n');
}
