/**
 * skillGraph check-up — build-time validation of a declared graph.
 *
 * Pure + side-effect-free. Catches wiring mistakes at authoring time instead of
 * mid-run: a skill nobody can reach, an edge to a skill that isn't in the graph,
 * two un-prioritized edges leaving one skill, a graph with no start, a self-loop,
 * an entry menu with no way to choose from it, a transition the cursor can never take.
 *
 * Surfaced two ways:
 *   • `graph.checkup()` → `{ ok, problems }` — always available, call it whenever.
 *   • `.build({ check: 'throw' | 'warn' | 'off' })` — run it at build time.
 *
 * **Only `unknown-skill` and `no-entry` are ERRORS.** Everything else is a WARNING,
 * and deliberately so: this file reports what it can PROVE from the declaration, and
 * a graph the model can still navigate is not a broken graph. `unreachable-skill`,
 * `model-edge-only` and `dead-entry-step` all describe skills or transitions that
 * deterministic routing cannot reach — but `read_skill` can, so calling them errors
 * would claim more than the declaration supports.
 *
 * ## What "reachable" means here (8.7.0)
 *
 * The BFS walks **deterministic** edges only — an edge with a `when` or an
 * `onToolReturn`. A bare `.route(a, b)` compiles to no trigger at all (`b` keeps its
 * `llm-activated` default), so counting it as reachability answered a question nobody
 * asked: the graph does not route there, the model does. Bare edges get their own
 * code, `model-edge-only`, which says exactly that and names the one cursor position
 * the gate will grant the jump from.
 */

/**
 * The compiled trigger kinds this file needs to tell apart. Mirrors
 * `InjectionTrigger['kind']` without importing it — the check-up is pure over
 * strings and must not depend on the engine's types.
 */
export type CheckupTriggerKind = 'always' | 'rule' | 'on-tool-return' | 'llm-activated';

export type GraphProblemCode =
  | 'unknown-skill'
  | 'no-entry'
  | 'unreachable-skill'
  | 'model-edge-only' // 8.7.0 — the only way in is a bare (model) edge, not deterministic routing
  | 'multi-entry-fanout' // 8.7.0 — an entry menu with no way to choose from it
  | 'dead-entry-step' // 8.7.0 — an entry that can never be the cold-start cursor routes out of itself
  | 'ambiguous-routes'
  | 'self-loop'
  // Proposal 009 Tier 1 — skill-body ↔ tool-contract consistency (WARNINGS):
  | 'body-foreign-tool' // body names a tool that belongs to another skill (not callable here)
  | 'body-unknown-tool'; // body has a `tool_name(` reference to a tool that exists nowhere

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

/** One declared entry, in declaration order. */
export interface CheckupEntry {
  readonly id: string;
  /** Has a `when` predicate — i.e. it does NOT unconditionally win the cold-start cursor. */
  readonly conditional: boolean;
}

export interface CheckupInput {
  /** Every skill id IN the graph. */
  readonly skillIds: ReadonlySet<string>;
  /** Declared entries, in declaration order (the order the cursor resolver reads). */
  readonly entries: readonly CheckupEntry[];
  /** Declared edges; `deterministic` = has a `when`/`onToolReturn` predicate. */
  readonly routes: ReadonlyArray<{ fromId: string; toId: string; deterministic: boolean }>;
  /** Decision-`tree()` graphs are exhaustive by construction — only id checks apply. */
  readonly isTree: boolean;
  /**
   * The entries are EXCLUSIVE — a scorer (`.entryBy()`/`.entryByRelevance()`) or
   * `.entryByRead()` picks exactly one. When true, the fan-out checks do not apply:
   * choosing among the entries is precisely what those strategies do.
   */
  readonly exclusiveEntries: boolean;
  /**
   * The COMPILED trigger kind per skill id. Read only to keep `unreachable-skill`'s
   * sentence true: "the model can still open it with read_skill" holds for an
   * `llm-activated` trigger and for no other kind — the agent's gate admits an open
   * pick only for that one (`Agent.openSkillIds`). A skill that arrived carrying a
   * hand-authored `rule` trigger keeps it (`deriveTrigger` returns null for an
   * unwired skill), and for that skill the old sentence was false.
   */
  readonly triggerKinds: ReadonlyMap<string, CheckupTriggerKind>;
}

/** Run the check-up. Pure. */
export function checkupGraph(input: CheckupInput): GraphCheckup {
  const { skillIds, entries, routes, isTree, exclusiveEntries, triggerKinds } = input;
  const entryIds = entries.map((e) => e.id);
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
  if (entries.length === 0) {
    problems.push({
      kind: 'error',
      code: 'no-entry',
      message: 'The graph has no entry skill — declare at least one `.entry(...)`.',
    });
  }

  // 3. reachability — BFS from the entries over the DETERMINISTIC edges only (8.7.0).
  //    A bare `.route(a, b)` compiles to no trigger; `b` keeps `llm-activated` and is
  //    reached by a model pick, not by routing. Counting it here reported "reachable"
  //    for a skill the graph never activates, which is the question this check exists
  //    to answer. Bare-edge targets fall through to `model-edge-only` below.
  const successors = new Map<string, string[]>();
  for (const r of routes) {
    if (!r.deterministic) continue;
    const list = successors.get(r.fromId);
    if (list) list.push(r.toId);
    else successors.set(r.fromId, [r.toId]);
  }
  const reached = new Set<string>(entryIds);
  const queue = [...entryIds];
  while (queue.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const cur = queue.shift()!;
    for (const to of successors.get(cur) ?? []) {
      if (!reached.has(to)) {
        reached.add(to);
        queue.push(to);
      }
    }
  }
  for (const id of skillIds) {
    if (reached.has(id)) continue;
    // A bare (model) edge INTO this skill is a declared, drawn way in — just not a
    // deterministic one. Report it as itself rather than as "unreachable", and name
    // the cursor positions the gate will actually grant the jump from: the runtime
    // gate's allowed set is `reachableSkills(cursor)`, which includes every declared
    // successor of the cursor, bare edges included.
    const incoming = routes.filter((r) => r.toId === id);
    const bareSources = dedupe(incoming.filter((r) => !r.deterministic).map((r) => r.fromId));
    // Deterministic edges into an UNREACHED skill necessarily come from skills that are
    // themselves unreached (otherwise the BFS would have arrived). Named rather than
    // omitted: "the way in is a bare route" would be false while one of these exists.
    const deadSources = dedupe(incoming.filter((r) => r.deterministic).map((r) => r.fromId));
    if (bareSources.length > 0) {
      problems.push({
        kind: 'warning',
        code: 'model-edge-only',
        message:
          `Skill "${id}" is not reachable from any entry over the graph's deterministic edges. ` +
          `The declared way in is ${
            bareSources.length === 1 ? 'a bare route' : `${bareSources.length} bare routes`
          } from ${quoteList(bareSources)}, and a bare route compiles to no trigger — so ` +
          `nothing in the graph activates it: the model has to ask for it with read_skill, and ` +
          `the gate grants that only while the cursor is on ${quoteList(bareSources)} (never at ` +
          `cold start).` +
          (deadSources.length > 0
            ? ` (It also has ${
                deadSources.length === 1
                  ? 'a deterministic route'
                  : `${deadSources.length} deterministic routes`
              } in, from ${quoteList(deadSources)} — but nothing reaches ${
                deadSources.length === 1 ? 'that skill' : 'those skills'
              } either.)`
            : '') +
          ` Add a \`when\`/\`onToolReturn\` to route there deterministically, or keep the bare ` +
          `edge if a model pick is what you meant.`,
        skill: id,
        ...(bareSources[0] !== undefined && { from: bareSources[0] }),
      });
      continue;
    }
    problems.push({
      kind: 'warning',
      code: 'unreachable-skill',
      message: unreachableMessage(id, triggerKinds.get(id)),
      skill: id,
    });
  }

  // 4. multi-entry-fanout (WARNING) — an entry menu with entries that DON'T take turns.
  //
  //    Provable without running a predicate, and only for UNCONDITIONAL entries: an
  //    entry with no `when` compiles to `{ kind: 'always' }` and is therefore on the
  //    wire beside whatever the cursor is on, every iteration, forever. That is the
  //    fan-out — extras loading their body and tools without routing anything.
  //
  //    An entry that HAS a `when` is not a fan-out (8.15.0). It compiles cursor-gated,
  //    so it is active exactly while the cursor is on it and exactly one entry is
  //    loaded at a time — a deterministic rule-router, which is a taught shape, not a
  //    mistake. This check used to fire on `entries.length >= 2` full stop, so a
  //    three-rule router was warned at with advice ("give the extras a `when`") they
  //    had already taken. It computed the `unconditional` list and then only used it to
  //    soften the middle of the sentence.
  //
  //    (The old rationale here — "an entry's compiled trigger is cursor-INDEPENDENT" —
  //    stopped being true of conditional entries in 8.3.0 and is wholly false in
  //    8.15.0. It is why the check over-fired.)
  //
  //    `.entryBy()`/`.entryByRead()` make the menu exclusive by construction, which is
  //    why this is silent under either.
  const unconditional = entries.filter((e) => !e.conditional).map((e) => e.id);
  if (!exclusiveEntries && entries.length >= 2 && unconditional.length > 0) {
    problems.push({
      kind: 'warning',
      code: 'multi-entry-fanout',
      message:
        `The graph declares ${plural(entries.length, 'entry', 'entries')} ` +
        `(${quoteList(entryIds)}), and ${quoteList(unconditional)} ${
          unconditional.length === 1 ? 'has' : 'have'
        } no \`when\` — so ${
          unconditional.length === 1 ? 'it compiles' : 'they compile'
        } to \`always\` and ${
          unconditional.length === 1 ? 'is' : 'are'
        } on the wire on EVERY iteration, beside whatever the cursor is on. Only one entry ` +
        `can be the cursor, so ${
          unconditional.length === 1 ? 'that one loads its' : 'those load their'
        } body and tools without routing anything. Give ${quoteList(unconditional)} a ` +
        `\`when\` (a conditional entry is active only while the cursor is on it), make ` +
        `${unconditional.length === 1 ? 'it a route target' : 'them route targets'} instead of ${
          unconditional.length === 1 ? 'an entry' : 'entries'
        }, rank the menu ` +
        `with .entryBy(keywordScorer()), or let the model choose with .entryByRead(). If ` +
        `${
          unconditional.length === 1 ? 'it is' : 'they are'
        } meant to be always-on beside the graph, that is what .steering(...) / .skill(...) ` +
        `are for.`,
      skill: unconditional[0],
    });
  }

  // 5. dead-entry-step (WARNING) — a transition declared out of an entry the cold-start
  //    cursor can never be on. The resolver returns at the FIRST entry with no `when`
  //    (declaration order), so every entry after it loses the cold start outright.
  //    A warning, not an error: entries are always in the read_skill reachable set, so
  //    a model pick can still put the cursor there — the message says so rather than
  //    claiming the step is dead.
  if (!exclusiveEntries) {
    const firstUnconditional = entries.findIndex((e) => !e.conditional);
    if (firstUnconditional >= 0) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const winner = entries[firstUnconditional]!.id;
      for (let i = firstUnconditional + 1; i < entries.length; i++) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const entry = entries[i]!;
        const outgoing = routes.filter((r) => r.fromId === entry.id && r.deterministic);
        if (outgoing.length === 0) continue;
        // A deterministic edge INTO it is a real way for the cursor to arrive, so the
        // step is not stranded at all — say nothing.
        if (routes.some((r) => r.toId === entry.id && r.deterministic)) continue;
        problems.push({
          kind: 'warning',
          code: 'dead-entry-step',
          message:
            `Entry "${entry.id}" is declared after "${winner}", which has no \`when\` and ` +
            `therefore always wins the cold-start cursor — so "${entry.id}" can never be the ` +
            `cursor at the start of a turn, and the ${plural(
              outgoing.length,
              'route',
              'routes',
            )} out of it (${quoteList(outgoing.map((r) => r.toId))}) can never fire from there. ` +
            `The one remaining path is a read_skill pick onto "${entry.id}" mid-run (entries are ` +
            `always offered), because nothing routes into it either. Reorder the entries, give ` +
            `"${winner}" a \`when\`, or route out of "${winner}" instead.`,
          skill: entry.id,
          from: entry.id,
        });
      }
    }
  }

  // 6. ambiguous-routes (WARNING) — ≥2 deterministic edges share a source skill with
  //    no priority field (there is none yet), so the first by declaration order wins.
  const deterministicByFrom = new Map<string, number>();
  for (const r of routes) {
    if (r.deterministic)
      deterministicByFrom.set(r.fromId, (deterministicByFrom.get(r.fromId) ?? 0) + 1);
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

  // 7. self-loop (WARNING) — an edge from a skill back to itself (rarely intended).
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

/**
 * The `unreachable-skill` sentence, told per TRIGGER KIND (8.7.0).
 *
 * "It can only be reached by the model via read_skill" is true for an `llm-activated`
 * skill and for no other kind — `Agent.openSkillIds()` admits an open pick only for
 * that trigger. An unwired skill keeps whatever trigger it arrived with
 * (`deriveTrigger` returns null when nothing routes in), so a hand-authored `rule`
 * trigger produced a skill the old sentence described wrongly: read_skill would be
 * refused, and what actually activates it is its own predicate, outside the graph.
 */
function unreachableMessage(id: string, kind: CheckupTriggerKind | undefined): string {
  const head = `Skill "${id}" is not reachable from any entry over the graph's deterministic edges`;
  if (kind === 'llm-activated' || kind === undefined) {
    // Safe to promise read_skill here. A skill with a deterministic edge into it —
    // even a DEAD one, out of a skill nothing reaches — compiles to a `rule` trigger
    // (`deriveTrigger` returns null only when `incoming` is empty), so it lands in the
    // branch below instead. `llm-activated` and "no incoming deterministic edge" are
    // the same statement here, which is exactly what `openSkillIds()` keys on.
    return `${head} — the model can still open it by name with read_skill (it is an OPEN skill: the agent's gate admits it from any cursor). Wire an edge to it if the graph is meant to route there.`;
  }
  if (kind === 'always') {
    return `${head}, and its trigger is \`always\` — so instead of being routed it loads on EVERY iteration, cursor or no cursor. Make it an \`.entry()\` if that is what you meant, or wire an edge to it.`;
  }
  return `${head}, and its trigger is \`${kind}\`, not \`llm-activated\` — so read_skill cannot open it either (the agent's gate admits an open pick only for \`llm-activated\`). It activates only when its own trigger fires, outside the graph. Wire an edge to it, or drop it from the graph and register it on the agent.`;
}

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"` — a list a human reads aloud. */
function quoteList(ids: readonly string[]): string {
  const quoted = ids.map((id) => `"${id}"`);
  if (quoted.length <= 1) return quoted[0] ?? '';
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

/** Format a check-up for a thrown error / console warning. */
export function formatCheckup(checkup: GraphCheckup): string {
  return checkup.problems.map((p) => `  [${p.kind}] ${p.code}: ${p.message}`).join('\n');
}
