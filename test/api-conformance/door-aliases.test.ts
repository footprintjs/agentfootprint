/**
 * DOOR ALIASES — the aliases can never drift from their doors.
 *
 * 8.0.0 consolidated 26 export subpaths into 10 doors and kept every old path
 * working as a deprecated alias. The promise made to consumers is exact:
 *
 *   "Every name here is the same symbol on the new door, not a copy."
 *
 * A promise like that decays the moment someone edits one barrel and forgets
 * the other, and it decays SILENTLY — both paths still compile, both still
 * export something called `mock`, and a consumer following the deprecation
 * notice lands on a different object than the one they had. So it is checked
 * two ways, because neither way can see the whole surface on its own:
 *
 *   1. RUNTIME IDENTITY (values). Import both modules and assert
 *      `alias[name] === door[name]`. Catches a re-implementation instantly.
 *      Blind to types, which are erased before this test can look.
 *
 *   2. DECLARATION IDENTITY (values AND types). Drive the TypeScript checker
 *      over the SHIPPED `dist/types`, resolved through `package.json#exports`
 *      — the consumer's exact view, `export *` chains and all — and assert
 *      every name on an alias resolves to the same declaration on the door.
 *      This is the half that sees type-only exports.
 *
 * ## The two pinned lists
 *
 * Both are literals. Their LENGTHS are asserted, so neither can quietly grow
 * into a place to hide a drift.
 *
 *   ABSENT_FROM_DOOR — a name the door genuinely does not carry.
 *     One entry, and it is a real design fact, not an oversight:
 *     `CircuitOpenError` is TWO classes (the provider decorator's and the
 *     reliability gate's) with different constructors and different
 *     `instanceof` answers. `/resilience` carries the decorator's. The gate's
 *     stays reachable only from the deprecated `/reliability`.
 *
 *   STRUCTURAL_TWINS — a name declared twice but resolving to the SAME TYPE.
 *     One entry: `CircuitState`, declared in both breaker files as
 *     `'closed' | 'open' | 'half-open'`. Two declarations, mutually
 *     assignable, indistinguishable to every consumer. Checked by comparing
 *     the resolved type, so if either declaration ever changes shape this
 *     stops passing.
 *
 * 7-pattern matrix: unit (each door exports its constituents' names) ·
 * integration (identity across alias and door) · property (every alias is
 * covered; the pinned lists stay exactly this size) · security (the doors
 * resolve from the SHIPPED artifact, not from src, so what is tested is what
 * publishes).
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every deprecated alias → the door it folded into. */
const ALIAS_TO_DOOR: Readonly<Record<string, string>> = {
  './llm-providers': './providers',
  './embedders': './providers',
  './tool-providers': './providers',
  './thinking': './providers',
  './memory-providers': './memory',
  './observability-providers': './observe',
  './strategies': './observe',
  './stream': './observe',
  './status': './observe',
  './locales': './observe',
  './debug': './observe',
  './debug/finders': './observe',
  './observability/contextError/finders': './observe',
  './reliability': './resilience',
  './hosting-providers': './hosting',
  './injection-engine': './context',
  './identity': './security',
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

// ─── 1. Declaration identity (values AND types) ────────────────────

describe.skipIf(!built)('every deprecated alias resolves to its door, name for name', () => {
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

  it('covers every alias in the package.json exports table', () => {
    const declaredAliases = codeSubpaths.filter((sp) => !(DOORS as readonly string[]).includes(sp));
    expect(declaredAliases.slice().sort()).toEqual(Object.keys(ALIAS_TO_DOOR).sort());
  });

  it('every door in the map is a real export subpath', () => {
    for (const door of DOORS) expect(codeSubpaths, `${door} is not in exports`).toContain(door);
    for (const door of Object.values(ALIAS_TO_DOOR)) {
      expect(DOORS as readonly string[], `${door} is not a door`).toContain(door);
    }
  });
});

// ─── 2. The pinned exception lists cannot grow ─────────────────────

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

// ─── 3. Runtime identity (values) ──────────────────────────────────

describe.skipIf(!built)('alias values are the SAME objects as the door values', () => {
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

// ─── 4. Doors are supersets, and carry what they claim ─────────────

describe.skipIf(!built)('each door carries every constituent it absorbed', () => {
  const CONSTITUENTS: Readonly<Record<string, readonly [string, string][]>> = {
    './providers': [
      ['./llm-providers', 'mock'],
      ['./embedders', 'openaiEmbedder'],
      ['./tool-providers', 'staticTools'],
      ['./thinking', 'findThinkingHandler'],
    ],
    './memory': [
      ['./memory', 'defineMemory'],
      ['./memory-providers', 'RedisStore'],
    ],
    './observe': [
      ['./observe', 'recordRun'],
      ['./observability-providers', 'otelObservability'],
      ['./strategies', 'composeObservability'],
      ['./stream', 'toSSE'],
      ['./status', 'selectStatus'],
      ['./locales', 'composeMessages'],
      ['./debug', 'localizeContextBug'],
      ['./debug/finders', 'rankSuspects'],
    ],
    './resilience': [
      ['./resilience', 'withRetry'],
      ['./reliability', 'ReliabilityFailFastError'],
    ],
    './hosting': [
      ['./hosting', 'httpHost'],
      ['./hosting-providers', 'agentCoreRuntimeHost'],
    ],
    './context': [['./injection-engine', 'defineInjection']],
    './security': [
      ['./security', 'PermissionPolicy'],
      ['./identity', 'agentCoreIdentity'],
    ],
  };

  for (const [door, entries] of Object.entries(CONSTITUENTS)) {
    for (const [from, sample] of entries) {
      it(`${door} carries ${sample} (from ${from})`, () => {
        expect(names(door).has(sample), `${door} is missing ${sample}`).toBe(true);
        expect(names(from).has(sample), `${from} no longer exports ${sample}`).toBe(true);
      });
    }
  }

  it('./cache and ./events stand alone — neither is folded into a door', () => {
    expect(Object.keys(ALIAS_TO_DOOR)).not.toContain('./cache');
    expect(Object.keys(ALIAS_TO_DOOR)).not.toContain('./events');
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
