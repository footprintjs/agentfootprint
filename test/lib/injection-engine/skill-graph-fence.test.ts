/**
 * THE FENCE — the skill-graph runtime imports no engine and no agent loop.
 *
 * WHY THIS EXISTS. The skill graph is a pure decision layer: given one
 * iteration's context it says where the cursor goes, what is reachable from
 * there, and which injections are active. That is a claim about the IMPORT
 * GRAPH, and nothing in the type system states it. Inside one package an
 * import costs nothing, so the boundary eroded one free import at a time —
 * `isDevMode` from footprintjs for a dev warning, the agent loop's
 * `ToolResultStatus` inside the graph's own context type, the framework's
 * `Tool` (and, transitively, artifacts, credentials, check-in and tool
 * sessions) for a five-field tool shape. Each was reasonable on its own day.
 * Together they meant `agentfootprint/skill-graph` could not exist.
 *
 * A comment saying "keep this pure" does not survive three minor releases.
 * A test does. This walks the TRANSITIVE import graph — via the TypeScript
 * compiler's own parser, so `import type`, `export … from`, `await import()`
 * and inline `import('…').T` are all seen — and fails on any edge that leaves
 * the fence, naming the file, the import, and what to do instead.
 *
 * TWO ZONES, because one of them honestly cannot be pure:
 *
 *   • PURE CORE — the graph, its scorers, its context type, the boundary
 *     contract. Reaches nothing outside itself except three verified
 *     zero-import leaves. This is exactly what `agentfootprint/skill-graph`
 *     exports.
 *   • PROVIDER LAYER — `constrainedEnumPick` + `llmClassifier`. These make a
 *     MODEL CALL, so they need an `LLMProvider`; a port that pretends
 *     otherwise is a fake abstraction. They may import `adapters/types.js`
 *     (and the closed type-only cluster it points at) and nothing else new.
 *     They are deliberately NOT on the door.
 *
 * Everything else in `src/lib/injection-engine/` is the HOST zone — the
 * factories, the subflow, the tool adapters — where importing the framework
 * is the job. The fence does not check those, but it does insist every file
 * be placed in exactly one zone, so a new file cannot arrive unclassified.
 *
 * Modelled on footprintjs's `branch-segment-prefixer-equivalence.test.ts`:
 * a test whose product is a design decision the compiler cannot see.
 *
 * Test types: Unit (one module's edges) · Functional (the door's whole
 * closure) · Contract (zone completeness + the structural mirrors).
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../../..');
const IE = 'src/lib/injection-engine';

// ── The zones ────────────────────────────────────────────────────────────

/**
 * PURE CORE. Verified by reading, not assumed: every file here must resolve
 * to nothing outside {@link PURE_LEAVES}.
 */
const PURE_CORE = [
  `${IE}/devWarn.ts`,
  `${IE}/entryScorer.ts`,
  `${IE}/evaluator.ts`,
  `${IE}/hostContract.ts`,
  `${IE}/intentScorer.ts`,
  `${IE}/promptTemplate.ts`,
  `${IE}/routingPolicy.ts`,
  `${IE}/skillContract.ts`,
  `${IE}/skillEntryEvidence.ts`,
  `${IE}/skillExamples.ts`,
  `${IE}/skillGraph.ts`,
  `${IE}/skillGraphCheckup.ts`,
  `${IE}/skillGuard.ts`,
  `${IE}/skillIntent.ts`,
  `${IE}/skillMatch.ts`,
  `${IE}/skillNeverRoutes.ts`,
  `${IE}/skillPartition.ts`,
  `${IE}/skillSteps.ts`,
  `${IE}/skillToolDescriptors.ts`,
  `${IE}/skillVocabulary.ts`,
  `${IE}/softmax.ts`,
  `${IE}/startRuleClaim.ts`,
  `${IE}/toolOutcome.ts`,
  `${IE}/types.ts`,
];

/**
 * The ONLY files outside `injection-engine/` the pure core may reach — and
 * WHY each one is here. All three are checked below to be genuine leaves
 * (zero imports of their own), because an allow-listed file that imports the
 * loop would hand the loop to the graph through the back door.
 */
const PURE_LEAVES: ReadonlyArray<readonly [file: string, why: string]> = [
  [
    'src/events/types.ts',
    "`ContextRole` / `ContextSource` — the observability vocabulary an Injection's " +
      'flavor and messages are spelled in. Pure type declarations, no imports, no runtime.',
  ],
  [
    'src/memory/embedding/types.ts',
    '`Embedder` — the one-method port `embeddingScorer` scores against. A type with no ' +
      'imports; the implementations live behind `agentfootprint/providers`.',
  ],
  [
    'src/lib/iterationBudget.ts',
    '`iterationsRemainingOf` — one line of arithmetic over two numbers, extracted so the ' +
      'injection engine, the cache decision and the request assembly cannot drift by one ' +
      'about how many actions a turn has left. No imports, no runtime, nothing agent-shaped.',
  ],
  [
    'src/memory/embedding/cosine.ts',
    '`cosineSimilarity` — twelve lines of arithmetic over two number arrays. Nothing in ' +
      'it knows what an agent is.',
  ],
];

/** The two files that make a model call, and may therefore see the adapter port. */
const PROVIDER_LAYER = [`${IE}/constrainedEnumPick.ts`, `${IE}/llmClassifier.ts`];

/** What the provider layer may reach on top of the pure set. */
const PROVIDER_LEAVES: ReadonlyArray<readonly [file: string, why: string]> = [
  [
    'src/adapters/types.ts',
    '`LLMProvider` / `LLMRequest` / `LLMResponse` / `LLMToolSchema` — the provider PORT. ' +
      'A constrained-enum pick is one model call; there is no honest way to describe it ' +
      'without naming a provider.',
  ],
  ['src/thinking/types.ts', 'reached by `adapters/types.ts` for `ThinkingBlock`. No imports.'],
  [
    'src/cache/types.ts',
    'reached by `adapters/types.ts` for `CacheMarker` (`LLMRequest.cacheMarkers`), and it ' +
      'points straight back — the four files here are one closed cluster of pure TYPE ' +
      'declarations with no runtime between them. Note the pure core does NOT get this one: ' +
      'it uses the `SkillCachePolicy` mirror instead.',
  ],
];

/** Files where importing the framework is the job. Listed so the zone check
 *  can insist every file is placed, not so the fence inspects them. */
const HOST_ZONE = [
  `${IE}/SkillRegistry.ts`,
  `${IE}/buildInjectionEngineSubflow.ts`,
  `${IE}/devWarnHost.ts`,
  `${IE}/index.ts`,
  `${IE}/messagesSlotRefusal.ts`,
  `${IE}/skillBodyDelivery.ts`,
  `${IE}/skillTools.ts`,
  `${IE}/skillsFromDir.ts`,
  `${IE}/skillsFromDirRoutes.ts`,
  `${IE}/factories/defineFact.ts`,
  `${IE}/factories/defineInjection.ts`,
  `${IE}/factories/defineInstruction.ts`,
  `${IE}/factories/defineMenuHint.ts`,
  `${IE}/factories/defineRelevanceHint.ts`,
  `${IE}/factories/defineSkill.ts`,
  `${IE}/factories/defineSteering.ts`,
  `${IE}/factories/defineStepsHint.ts`,
];

const DOOR = 'src/doors/skill-graph.ts';

// ── Reading the import graph ─────────────────────────────────────────────

/**
 * Every module specifier a file names, via the compiler's own parser.
 *
 * The parser is the point: a regex would miss `import('../../x.js').T` in a
 * type position (which is how `ToolResultStatus` crossed the boundary for two
 * minors) and would trip over specifiers quoted inside doc comments — and this
 * file's own doc comments quote several.
 */
function specifiersOf(absFile: string): string[] {
  const src = ts.createSourceFile(
    absFile,
    readFileSync(absFile, 'utf8'),
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  const out: string[] = [];
  const take = (node: ts.Node | undefined): void => {
    if (node && ts.isStringLiteral(node)) out.push(node.text);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      take(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node)) {
      // `import('./x.js').T` — the type-position form.
      const arg = node.argument;
      if (ts.isLiteralTypeNode(arg)) take(arg.literal);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length > 0
    ) {
      take(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

/** Resolve a RELATIVE specifier to a repo-relative source path, or undefined. */
function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = resolve(REPO, dirname(fromFile), spec);
  const candidates = [
    base.replace(/\.js$/, '.ts'),
    base.replace(/\.js$/, '.tsx'),
    `${base}.ts`,
    join(base, 'index.ts'),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return relative(REPO, c);
  }
  return undefined;
}

interface Edge {
  readonly from: string;
  readonly spec: string;
  /** Repo-relative target, or undefined for a bare (package) specifier. */
  readonly to?: string;
}

/**
 * Walk the transitive closure of `roots`, STOPPING at the fence.
 *
 * Descending into a refused file would be honest but useless: one import of
 * `core/tools.js` would report eleven more violations from inside
 * `core/tools.js` itself, burying the one edge the author has to delete. So
 * the walk stays inside `allowed` and every reported edge is a BOUNDARY
 * crossing made by a file that is supposed to be inside.
 */
function closure(
  roots: readonly string[],
  allowed: ReadonlySet<string>,
): { files: Set<string>; escapes: Edge[] } {
  const files = new Set<string>();
  const escapes: Edge[] = [];
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (files.has(file)) continue;
    files.add(file);
    for (const spec of specifiersOf(resolve(REPO, file))) {
      const to = spec.startsWith('.') ? resolveRelative(file, spec) : undefined;
      if (to !== undefined && allowed.has(to)) {
        queue.push(to);
        continue;
      }
      escapes.push(to === undefined ? { from: file, spec } : { from: file, spec, to });
    }
  }
  return { files, escapes };
}

// ── The refusal ──────────────────────────────────────────────────────────

/** Why this particular crossing is refused, and what to do instead. */
function teach(spec: string): string {
  if (spec === 'footprintjs' || spec.startsWith('footprintjs/')) {
    return (
      'footprintjs is the FLOWCHART ENGINE. The skill graph is a decision layer that runs ' +
      'anywhere; importing the engine for it makes `agentfootprint/skill-graph` a lie. If you ' +
      'need the dev-mode flag, use the seam: `devWarn(msg)` / `devMode()` from `./devWarn.js`, ' +
      'which the host binds (see `devWarnHost.ts`).'
    );
  }
  if (spec.includes('core/tools')) {
    return (
      '`core/tools.ts` drags artifacts, credentials, check-in and tool sessions behind it. If ' +
      'you need a tool SHAPE, use `SkillTool` from `./hostContract.js` (a schema and something ' +
      'to run — the framework `Tool` satisfies it). If you need to DESCRIBE a tool, return a ' +
      '`SkillToolDescriptor` and let the host call `defineTool` on it — see ' +
      '`skillToolDescriptors.ts` and `skillTools.ts`.'
    );
  }
  if (spec.includes('core/agent/')) {
    return (
      'that is the AGENT LOOP. The loop depends on the graph, never the reverse — a loop type ' +
      'the graph needs is a type in the wrong place. Move it down to a leaf both sides can ' +
      'import (`toolOutcome.ts` is the worked example: `ToolResultStatus` moved here and ' +
      '`core/agent/toolEffects.ts` re-exports it) and put the graph-facing shape on ' +
      '`hostContract.ts`.'
    );
  }
  if (spec.includes('adapters/')) {
    return (
      'the ADAPTER layer is provider vocabulary. The pure core does not make model calls. Use ' +
      'the structural mirror `SkillToolSchema` from `./hostContract.js`; if this file genuinely ' +
      'needs a provider, it belongs in the PROVIDER LAYER zone in this test, beside ' +
      '`llmClassifier.ts` — and then it must stay off `src/doors/skill-graph.ts`.'
    );
  }
  if (spec.includes('cache/')) {
    return (
      'the cache layer reaches the adapter layer. Use `SkillCachePolicy` from ' +
      '`./hostContract.js` — the structural mirror pinned by ' +
      '`test/type-regressions/SkillGraphBoundary.assignability.test.ts`.'
    );
  }
  if (spec.includes('recorder')) {
    return (
      'recorders are OBSERVERS of a run. The graph is consulted by a run; it does not watch ' +
      'one. Emit from the host instead (see `SkillGraphHost`, obligation 5).'
    );
  }
  return (
    'it is outside the fence. Either move what you need into `src/lib/injection-engine/` as a ' +
    'pure module, put a structural shape on `hostContract.ts`, or move this file to the HOST ' +
    'zone list in this test and off `src/doors/skill-graph.ts`.'
  );
}

function violations(escapes: readonly Edge[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of escapes) {
    const key = `${e.from}|${e.spec}`;
    if (seen.has(key)) continue; // one file can name the same module many times
    seen.add(key);
    const target = e.to ?? `${e.spec} (a package, not a file in this repo)`;
    out.push(`\n  ${e.from}\n    imports '${e.spec}'  →  ${target}\n    REFUSED: ${teach(e.spec)}`);
  }
  return out;
}

const pureAllowed = new Set<string>([...PURE_CORE, ...PURE_LEAVES.map(([f]) => f), DOOR]);
const providerAllowed = new Set<string>([
  ...pureAllowed,
  ...PROVIDER_LAYER,
  ...PROVIDER_LEAVES.map(([f]) => f),
]);

// ── The tests ────────────────────────────────────────────────────────────

describe('skill-graph fence — the pure core', () => {
  it('every listed pure-core file exists (the list cannot rot silently)', () => {
    const missing = [...PURE_CORE, ...PROVIDER_LAYER, DOOR].filter(
      (f) => !existsSync(resolve(REPO, f)),
    );
    expect(missing).toEqual([]);
  });

  it.each(PURE_CORE)('%s reaches nothing outside the fence', (file) => {
    const { escapes } = closure([file], pureAllowed);
    const bad = violations(escapes);
    expect(
      bad.length === 0,
      `PURE CORE VIOLATION — ${file} left the skill-graph fence:${bad.join('')}\n\n` +
        `The fence exists because this layer is exported as \`agentfootprint/skill-graph\`, ` +
        `a subpath a host on another framework can import. Every edge above would load our ` +
        `agent loop into that host.\n`,
    ).toBe(true);
  });

  it('the whole `agentfootprint/skill-graph` door is pure, transitively', () => {
    const { files, escapes } = closure([DOOR], pureAllowed);
    const bad = violations(escapes);
    expect(
      bad.length === 0,
      `DOOR VIOLATION — \`agentfootprint/skill-graph\` is not framework-neutral:${bad.join('')}\n`,
    ).toBe(true);

    // And the door really does reach the graph (a fence over an empty set proves nothing).
    expect(files.has(`${IE}/skillGraph.ts`)).toBe(true);
    expect(files.has(`${IE}/hostContract.ts`)).toBe(true);
    expect(files.size).toBeGreaterThan(10);
  });

  it('the door does NOT export the provider layer', () => {
    const { files } = closure([DOOR], pureAllowed);
    for (const f of PROVIDER_LAYER) {
      expect(
        files.has(f),
        `${f} is in the door's closure. It needs an LLMProvider, so shipping it through ` +
          `\`agentfootprint/skill-graph\` would drag the adapter layer into a door that ` +
          `promises none. Export it from \`agentfootprint/context\` instead.`,
      ).toBe(false);
    }
  });

  it('the allow-listed leaves reach nothing outside the fence', () => {
    for (const [file, why] of [...PURE_LEAVES, ...PROVIDER_LEAVES]) {
      const specs = specifiersOf(resolve(REPO, file));
      const external = specs.filter((s) => {
        if (!s.startsWith('.')) return true;
        const to = resolveRelative(file, s);
        return to === undefined || !providerAllowed.has(to);
      });
      expect(
        external,
        `${file} is on the fence's allow-list ("${why}") but imports ${external.join(', ')}. ` +
          `An allow-listed file that reaches the loop hands the loop to the graph through the ` +
          `back door — either sever that import, add the target to the allow-list WITH ITS ` +
          `REASON, or drop this file from the allow-list.`,
      ).toEqual([]);
    }
  });
});

describe('skill-graph fence — the provider layer', () => {
  it.each(PROVIDER_LAYER)('%s may see the provider port, and nothing else new', (file) => {
    const { escapes } = closure([file], providerAllowed);
    const bad = violations(escapes);
    expect(
      bad.length === 0,
      `PROVIDER LAYER VIOLATION — ${file} reached past the adapter port:${bad.join('')}\n\n` +
        `This zone exists for exactly one crossing: \`src/adapters/types.ts\`, because a ` +
        `constrained-enum pick IS a model call. Anything else belongs in the HOST zone.\n`,
    ).toBe(true);
  });

  it('the provider layer really does use the port (the exception is not stale)', () => {
    const used = PROVIDER_LAYER.flatMap((f) =>
      specifiersOf(resolve(REPO, f)).filter((s) => s.includes('adapters/types')),
    );
    expect(
      used.length > 0,
      'No file in the PROVIDER LAYER imports the adapter port any more. The exception has ' +
        'outlived its reason — move these files into PURE_CORE and delete the zone.',
    ).toBe(true);
  });
});

describe('skill-graph fence — zone completeness', () => {
  it('every injection-engine file is placed in exactly one zone', () => {
    const walk = (dir: string): string[] =>
      readdirSync(resolve(REPO, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(`${dir}/${e.name}`)
          : e.name.endsWith('.ts')
          ? [`${dir}/${e.name}`]
          : [],
      );
    const onDisk = walk(IE).sort();
    const placed = [...PURE_CORE, ...PROVIDER_LAYER, ...HOST_ZONE];
    const dupes = placed.filter((f, i) => placed.indexOf(f) !== i);
    expect(dupes, 'a file is listed in two zones').toEqual([]);

    const unplaced = onDisk.filter((f) => !placed.includes(f));
    expect(
      unplaced,
      `New file(s) in ${IE} with no zone:\n  ${unplaced.join('\n  ')}\n\n` +
        `Place each one in this test: PURE_CORE (no engine, no loop — and it becomes part ` +
        `of \`agentfootprint/skill-graph\`), PROVIDER_LAYER (it makes a model call), or ` +
        `HOST_ZONE (it wires the graph into our agent). Deciding is the point; the fence ` +
        `will not decide for you.`,
    ).toEqual([]);

    const stale = placed.filter((f) => !onDisk.includes(f));
    expect(stale, 'zone list names a file that no longer exists').toEqual([]);
  });
});

describe('skill-graph fence — the structural mirrors', () => {
  /** Read an interface's members as `name: type` text, order-independent. */
  function membersOf(file: string, name: string): string[] {
    const src = ts.createSourceFile(
      file,
      readFileSync(resolve(REPO, file), 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    let found: string[] | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === name) {
        found = node.members.map((m) => {
          const prop = m as ts.PropertySignature;
          const q = prop.questionToken ? '?' : '';
          return `${(prop.name as ts.Identifier).text}${q}: ${prop.type?.getText() ?? '?'}`;
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    if (!found) throw new Error(`${name} not found in ${file}`);
    return [...found].sort();
  }

  /** Read a type alias's text, whitespace-normalized. */
  function aliasText(file: string, name: string): string {
    const src = ts.createSourceFile(
      file,
      readFileSync(resolve(REPO, file), 'utf8'),
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
    let found: string | undefined;
    const visit = (node: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(node) && node.name.text === name) {
        found = node.type.getText().replace(/\s+/g, ' ');
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    if (found === undefined) throw new Error(`${name} not found in ${file}`);
    return found;
  }

  const HC = `${IE}/hostContract.ts`;

  it('SkillToolSchema mirrors LLMToolSchema', () => {
    expect(
      membersOf(HC, 'SkillToolSchema'),
      'The mirror drifted. `ActiveInjection.inject.tools[].schema` is typed by ' +
        '`SkillToolSchema` and assigned from a real `LLMToolSchema`; if the two stop matching ' +
        'field for field, either the assignment breaks or (worse) a field silently stops ' +
        'crossing the boundary. Update `hostContract.ts` to match `src/adapters/types.ts`.',
    ).toEqual(membersOf('src/adapters/types.ts', 'LLMToolSchema'));
  });

  it('SkillCachePolicyContext mirrors CachePolicyContext', () => {
    expect(membersOf(HC, 'SkillCachePolicyContext')).toEqual(
      membersOf('src/cache/types.ts', 'CachePolicyContext'),
    );
  });

  it('SkillCachePolicy mirrors CachePolicy', () => {
    const mirror = aliasText(HC, 'SkillCachePolicy').replace(/SkillCachePolicyContext/g, 'X');
    const origin = aliasText('src/cache/types.ts', 'CachePolicy').replace(
      /CachePolicyContext/g,
      'X',
    );
    expect(
      mirror,
      'The cache-policy mirror drifted from `src/cache/types.ts`. `ActiveInjection.cache` ' +
        'carries the declared policy across the boundary; a mirror that has lost a variant ' +
        'silently drops it (the 7.21.0 "resolved to never" bug, again).',
    ).toBe(origin);
  });

  it('ToolResultStatus is declared once, in the pure leaf', () => {
    const leaf = `${IE}/toolOutcome.ts`;
    expect(aliasText(leaf, 'ToolResultStatus')).toContain("'denied'");
    // The loop re-exports; it must not re-declare.
    const effects = readFileSync(resolve(REPO, 'src/core/agent/toolEffects.ts'), 'utf8');
    expect(
      /export type ToolResultStatus\s*=/.test(effects),
      '`core/agent/toolEffects.ts` declares ToolResultStatus again. Two declarations of a ' +
        'closed vocabulary drift; the graph reads the one in `toolOutcome.ts`, so the loop ' +
        'must re-export it, not re-state it.',
    ).toBe(false);
  });
});
