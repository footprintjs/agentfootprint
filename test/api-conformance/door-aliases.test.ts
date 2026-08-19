/**
 * DOOR SURFACE — the 9.0.0 law.
 *
 * 8.0.0 consolidated 26 export subpaths into 10 doors and kept every old path
 * working as a deprecated alias through the 8.x line. 9.0.0 executed the
 * ledger: SIXTEEN alias subpaths are gone from the exports map. What remains
 * is pinned here, in both directions:
 *
 *   1. ABSENCE. Each removed alias is asserted ABSENT from `package.json`
 *      exports — so a refactor can never quietly resurrect one, and the
 *      migration table in CHANGELOG 9.0.0 stays the single story.
 *
 *   2. PRESENCE. The canonical doors still resolve, still build, and still
 *      carry every name they absorbed from their constituents in 8.0.0 —
 *      removal of the alias PATH must never become removal of a NAME.
 *
 * ## The one retained alias
 *
 * `./reliability` deliberately survives 9.0.0. It is the only home of the
 * reliability GATE's `CircuitOpenError` — a different class from the provider
 * decorator's `CircuitOpenError` that `/resilience` carries, with a different
 * constructor and a different `instanceof` answer. Removing the path would not
 * rename that class; it would make it unreachable, and a consumer could no
 * longer `instanceof`-check the error their own gate throws. So the full
 * alias discipline (declaration identity, runtime identity, pinned
 * exceptions) still applies to it, scoped to exactly one entry:
 *
 *   ABSENT_FROM_DOOR — `CircuitOpenError` (the design fact above).
 *   STRUCTURAL_TWINS — `CircuitState`, declared in both breaker files as
 *     `'closed' | 'open' | 'half-open'`; two declarations, one type.
 *
 * 7-pattern matrix: unit (doors carry their absorbed names) · integration
 * (identity across the retained alias and its door) · property (the removed
 * list and the exception lists are pinned by exact content, so neither can
 * quietly grow or shrink) · security (everything is asserted against the
 * SHIPPED artifact resolved through `package.json#exports` — what is tested
 * is what publishes).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The sixteen subpaths 9.0.0 removed. Their migration rows live in CHANGELOG 9.0.0. */
const REMOVED_SUBPATHS = [
  './llm-providers',
  './embedders',
  './tool-providers',
  './thinking',
  './memory-providers',
  './observability-providers',
  './strategies',
  './stream',
  './status',
  './locales',
  './debug',
  './debug/finders',
  './observability/contextError/finders',
  './hosting-providers',
  './injection-engine',
  './identity',
] as const;

/** The one deliberately retained alias → its door. See header for why. */
const ALIAS_TO_DOOR: Readonly<Record<string, string>> = {
  './reliability': './resilience',
};

/** The canonical doors. `./cache` and `./events` stand alone by design. */
const DOORS = [
  '.',
  './providers',
  './memory',
  './rag',
  './cache',
  './observe',
  './events',
  './context',
  './resilience',
  './hosting',
  './security',
  // 9.34.0 — the ELEVENTH door, and the first one added since the 8.0.0
  // consolidation. It is not another way to run an agent: it publishes the
  // skill-graph decision layer, which `test/lib/injection-engine/skill-graph-fence.test.ts`
  // PROVES imports no engine and no agent loop, so a host on another framework
  // can route with it. A door that carries no run entry point does not reopen
  // the 26-doors problem the ledger closed.
  './skill-graph',
  // 9.48.0 — the TWELFTH, on the same argument: `./recipes` carries no run
  // entry point either. It publishes the declared unit of agent CONFIGURATION
  // (`defineAgentRecipe`), which is authoring-time vocabulary — an app that
  // CONSUMES a recipe imports the object and calls `.recipe()`.
  './recipes',
] as const;

/** Names an alias exports that its door deliberately does NOT. See header. */
const ABSENT_FROM_DOOR: Readonly<Record<string, readonly string[]>> = {
  './reliability': ['CircuitOpenError'],
};

/** Names declared twice but resolving to the same type. See header. */
const STRUCTURAL_TWINS: Readonly<Record<string, readonly string[]>> = {
  './reliability': ['CircuitState'],
};

interface PkgExportEntry {
  readonly import: { readonly types: string; readonly default: string };
  readonly require: { readonly types: string; readonly default: string };
}

function pkgExports(): Record<string, PkgExportEntry | string> {
  return (
    JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      exports: Record<string, PkgExportEntry | string>;
    }
  ).exports;
}

const EXPORTS = pkgExports();
const codeSubpaths = Object.keys(EXPORTS).filter((k) => k !== './package.json');

function typesPathFor(subpath: string): string {
  const entry = EXPORTS[subpath];
  if (entry === undefined || typeof entry === 'string') {
    throw new Error(`package.json exports has no code entry for "${subpath}"`);
  }
  return resolve(ROOT, entry.require.types);
}

function esmPathFor(subpath: string): string {
  const entry = EXPORTS[subpath];
  if (entry === undefined || typeof entry === 'string') {
    throw new Error(`package.json exports has no code entry for "${subpath}"`);
  }
  return resolve(ROOT, entry.import.default);
}

const built = codeSubpaths.every(
  (sp) => existsSync(typesPathFor(sp)) && existsSync(esmPathFor(sp)),
);

// ─── The shipped-declaration view ──────────────────────────────────

interface ResolvedExport {
  /** `file:pos` of the declaration the name ultimately resolves to. */
  readonly declaration: string;
  /** The resolved type, printed. Lets two declarations prove they are one type. */
  readonly typeText: string;
}

function buildSurface(): Map<string, Map<string, ResolvedExport>> {
  const files = codeSubpaths.map(typesPathFor);
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    skipLibCheck: true,
    noEmit: true,
  });
  const checker = program.getTypeChecker();

  const surface = new Map<string, Map<string, ResolvedExport>>();
  for (const subpath of codeSubpaths) {
    const sourceFile = program.getSourceFile(typesPathFor(subpath));
    if (sourceFile === undefined) {
      throw new Error(`TypeScript could not load ${typesPathFor(subpath)} for "${subpath}"`);
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile);
    if (moduleSymbol === undefined) {
      throw new Error(`"${subpath}" resolved to a file with no module symbol`);
    }
    const names = new Map<string, ResolvedExport>();
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      let target = exported;
      if ((exported.flags & ts.SymbolFlags.Alias) !== 0) {
        try {
          target = checker.getAliasedSymbol(exported);
        } catch {
          /* unresolvable alias — fall back to the local symbol */
        }
      }
      const decl = target.declarations?.[0] ?? exported.declarations?.[0];
      names.set(exported.getName(), {
        declaration: decl
          ? `${relative(ROOT, decl.getSourceFile().fileName)}:${decl.pos}`
          : '<none>',
        typeText: (() => {
          try {
            const type =
              (target.flags & ts.SymbolFlags.Type) !== 0
                ? checker.getDeclaredTypeOfSymbol(target)
                : checker.getTypeOfSymbolAtLocation(target, decl ?? sourceFile);
            // `InTypeAlias` is load-bearing: without it a type alias prints as
            // its own NAME ("CircuitState"), so two unrelated aliases that
            // happen to share a name would compare equal and a real drift
            // would sail through as a "structural twin". With it, the type is
            // expanded and the comparison is on the actual shape.
            return checker.typeToString(
              type,
              undefined,
              ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.InTypeAlias,
            );
          } catch {
            return '<unprintable>';
          }
        })(),
      });
    }
    surface.set(subpath, names);
  }
  return surface;
}

// Building the program is the expensive part — do it once for the whole file.
const surface = built ? buildSurface() : undefined;

function names(subpath: string): Map<string, ResolvedExport> {
  const found = surface?.get(subpath);
  if (found === undefined) throw new Error(`no surface for "${subpath}"`);
  return found;
}

// ─── 1. The removed subpaths are GONE, and stay gone ───────────────

describe('the sixteen 9.0.0-removed subpaths are absent from the exports map', () => {
  for (const removed of REMOVED_SUBPATHS) {
    it(`${removed} is not an export subpath`, () => {
      expect(
        codeSubpaths,
        `${removed} was removed in 9.0.0 — resurrecting it needs a migration-table conversation, not a refactor`,
      ).not.toContain(removed);
    });
  }

  it('the removed list is pinned at exactly sixteen', () => {
    expect(REMOVED_SUBPATHS).toHaveLength(16);
  });

  it('the exports map is exactly: root + the twelve doors + the one retained alias', () => {
    const expected = [...DOORS, ...Object.keys(ALIAS_TO_DOOR)].slice().sort();
    expect(codeSubpaths.slice().sort()).toEqual(expected);
  });
});

// ─── 2. Declaration identity for the retained alias ────────────────

describe.skipIf(!built)('the retained alias resolves to its door, name for name', () => {
  for (const [alias, door] of Object.entries(ALIAS_TO_DOOR)) {
    it(`${alias} → ${door}`, () => {
      const aliasNames = names(alias);
      const doorNames = names(door);
      const absent = new Set(ABSENT_FROM_DOOR[alias] ?? []);
      const twins = new Set(STRUCTURAL_TWINS[alias] ?? []);

      expect(aliasNames.size, `${alias} exports nothing — did the barrel move?`).toBeGreaterThan(0);

      const missing: string[] = [];
      const drifted: string[] = [];
      for (const [name, resolved] of aliasNames) {
        if (absent.has(name)) continue;
        const onDoor = doorNames.get(name);
        if (onDoor === undefined) {
          missing.push(name);
          continue;
        }
        if (onDoor.declaration === resolved.declaration) continue;
        // A second declaration is allowed ONLY where it is pinned as a twin
        // AND the two really do resolve to the same type.
        if (twins.has(name) && onDoor.typeText === resolved.typeText) continue;
        drifted.push(
          `${name}: ${alias} has ${resolved.declaration} (${resolved.typeText}), ` +
            `${door} has ${onDoor.declaration} (${onDoor.typeText})`,
        );
      }

      expect(missing, `${door} is missing names that ${alias} still exports`).toEqual([]);
      expect(drifted, `${door} and ${alias} disagree about what these names mean`).toEqual([]);
    });
  }

  it('every door in the map is a real export subpath', () => {
    for (const door of DOORS) expect(codeSubpaths, `${door} is not in exports`).toContain(door);
    for (const door of Object.values(ALIAS_TO_DOOR)) {
      expect(DOORS as readonly string[], `${door} is not a door`).toContain(door);
    }
  });
});

// ─── 3. The pinned exception lists cannot grow ─────────────────────

describe('the exception lists are pinned', () => {
  it('exactly ONE name is absent from its door, and it is CircuitOpenError', () => {
    const flat = Object.entries(ABSENT_FROM_DOOR).flatMap(([sp, ns]) =>
      ns.map((n) => `${sp}#${n}`),
    );
    // Growing this list means a door quietly stopped carrying something an
    // alias promises. If you are adding to it, that is the conversation.
    expect(flat).toEqual(['./reliability#CircuitOpenError']);
  });

  it('exactly ONE name is a structural twin, and it is CircuitState', () => {
    const flat = Object.entries(STRUCTURAL_TWINS).flatMap(([sp, ns]) =>
      ns.map((n) => `${sp}#${n}`),
    );
    expect(flat).toEqual(['./reliability#CircuitState']);
  });

  it.skipIf(!built)('CircuitState really is the same type on both paths', () => {
    const fromAlias = names('./reliability').get('CircuitState');
    const fromDoor = names('./resilience').get('CircuitState');
    expect(fromAlias?.typeText).toBe(fromDoor?.typeText);
    expect(fromAlias?.typeText).toContain('closed');
    expect(fromAlias?.typeText).toContain('half-open');
  });

  it.skipIf(!built)('CircuitOpenError really is a DIFFERENT class on each path', () => {
    const fromAlias = names('./reliability').get('CircuitOpenError');
    const fromDoor = names('./resilience').get('CircuitOpenError');
    expect(fromAlias, './reliability must still export it').toBeDefined();
    expect(fromDoor, './resilience must export the decorator flavour').toBeDefined();
    // Two declarations — this is the fact that forced the exception.
    expect(fromAlias?.declaration).not.toBe(fromDoor?.declaration);
  });
});

// ─── 4. Runtime identity for the retained alias ────────────────────

describe.skipIf(!built)('retained-alias values are the SAME objects as the door values', () => {
  for (const [alias, door] of Object.entries(ALIAS_TO_DOOR)) {
    // Cold-imports two whole built barrels from dist. That is disk + module
    // graph work whose cost belongs to the machine, not to the library, so
    // the assertion carries its own budget rather than inheriting the 5s
    // default and going red on a busy box.
    it(`${alias} values === ${door} values`, async () => {
      const aliasMod = (await import(esmPathFor(alias))) as Record<string, unknown>;
      const doorMod = (await import(esmPathFor(door))) as Record<string, unknown>;
      const absent = new Set(ABSENT_FROM_DOOR[alias] ?? []);

      const mismatched: string[] = [];
      let compared = 0;
      for (const key of Object.keys(aliasMod)) {
        if (key === 'default' || absent.has(key)) continue;
        compared += 1;
        if (!(key in doorMod)) {
          mismatched.push(`${key}: missing from ${door}`);
        } else if (aliasMod[key] !== doorMod[key]) {
          mismatched.push(`${key}: not the same object`);
        }
      }
      expect(mismatched).toEqual([]);
      expect(compared, `${alias} exported no runtime values to compare`).toBeGreaterThan(0);
    }, 30_000);
  }
});

// ─── 5. Doors still carry every name they absorbed in 8.0.0 ────────

describe.skipIf(!built)('each door carries every constituent name it absorbed', () => {
  // Removal of the alias PATH must never become removal of a NAME. One sample
  // name per absorbed constituent, checked on the door that absorbed it.
  const ABSORBED: Readonly<Record<string, readonly string[]>> = {
    './providers': ['mock', 'openaiEmbedder', 'staticTools', 'findThinkingHandler'],
    './memory': ['defineMemory', 'RedisStore'],
    './observe': [
      'recordRun',
      'otelObservability',
      'composeObservability',
      'toSSE',
      'selectStatus',
      'composeMessages',
      'localizeContextBug',
      'rankSuspects',
    ],
    './resilience': ['withRetry', 'ReliabilityFailFastError'],
    './hosting': ['httpHost', 'agentCoreRuntimeHost'],
    './context': ['defineInjection'],
    './security': ['PermissionPolicy', 'agentCoreIdentity'],
  };

  for (const [door, sampleNames] of Object.entries(ABSORBED)) {
    for (const sample of sampleNames) {
      it(`${door} carries ${sample}`, () => {
        expect(names(door).has(sample), `${door} is missing ${sample}`).toBe(true);
      });
    }
  }

  it('./cache and ./events stand alone — neither was ever an alias', () => {
    // ./cache stays its own door because importing it RUNS the vendor
    // cache-strategy registrations; side-effectful code stays opt-in.
    expect(names('./cache').has('registerCacheStrategy')).toBe(true);
    // ./events is the wire vocabulary, and its `ContextSource` is a different
    // type from the one /observe carries — the collision that kept it apart.
    expect(names('./events').has('ContextSource')).toBe(true);
    expect(names('./observe').get('ContextSource')?.declaration).not.toBe(
      names('./events').get('ContextSource')?.declaration,
    );
  });
});
