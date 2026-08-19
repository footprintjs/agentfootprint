/**
 * SUBPATH EXPORTS — the 9.0.0 manifest.
 *
 * 8.0.0 consolidated 26 subpaths into 10 doors and kept every old path alive
 * as a deprecated alias. 9.0.0 executed that ledger: sixteen alias subpaths
 * left `package.json`. What ships now is exactly
 *
 *   root  +  the twelve doors  +  `./reliability`  +  `./package.json`
 *
 * (The eleventh, `./skill-graph`, arrived in 9.34.0; the twelfth, `./recipes`,
 * in 9.48.0 — see the list below.)
 *
 * This file is the MANIFEST half of the pin. Its sibling
 * `door-aliases.test.ts` reads the built `.d.ts` files and pins the SURFACE
 * — which NAMES each door carries and whether the retained alias still
 * resolves to the same declarations. Here we never open a `.d.ts`: we assert
 * the two tables in `package.json` (`exports` + `typesVersions`) and the
 * SOURCE-level fact that makes the removal safe.
 *
 * That fact is the whole point, and it is easy to lose: **9.0.0 removed
 * import PATHS, not code.** Every one of the sixteen implementation barrels
 * is still in `src/`, still exports what it always did, and is now reachable
 * only through the door that absorbed it — as the SAME object, not a copy.
 * A door that shadowed a name with a re-implementation would pass a
 * name-presence check and fail here.
 *
 * 7-pattern matrix (structure validation, so the matrix is mechanical):
 *
 *   - unit:        every surviving subpath resolves to the dist file its
 *                  convention predicts, and both tables agree entry for entry
 *   - integration: door symbol === implementation-barrel symbol, by identity,
 *                  for every one of the sixteen absorbed barrels
 *   - property:    the removed list and the surviving list are pinned by
 *                  exact content — neither can quietly grow or shrink
 *   - edge:        `./package.json` is a plain string by Node convention and
 *                  is exempt from the per-condition rules
 *   - security:    everything is asserted against what `package.json`
 *                  actually publishes, not against a hand-kept list of files
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ─── The doors (what a consumer may import) ────────────────────────

import * as providersDoor from '../../src/doors/providers.js';
import * as memoryDoor from '../../src/doors/memory.js';
import * as observeDoor from '../../src/doors/observe.js';
import * as hostingDoor from '../../src/doors/hosting.js';
import * as contextDoor from '../../src/doors/context.js';
import * as securityDoor from '../../src/doors/security.js';

// ─── The implementation barrels behind them (no longer subpaths) ───

import * as llmProviders from '../../src/llm-providers.js';
import * as embedders from '../../src/embedders/index.js';
import * as toolProviders from '../../src/tool-providers/index.js';
import * as thinking from '../../src/thinking/index.js';
import * as memoryProviders from '../../src/memory-providers.js';
import * as observabilityProviders from '../../src/observability-providers.js';
import * as strategies from '../../src/strategies/index.js';
import * as stream from '../../src/stream.js';
import * as status from '../../src/status.js';
import * as locales from '../../src/locales/index.js';
import * as debug from '../../src/debug.js';
import * as debugFinders from '../../src/debug/finders.js';
import * as contextErrorFinders from '../../src/observability/contextError/finders/index.js';
import * as hostingProviders from '../../src/hosting-providers.js';
import * as injectionEngine from '../../src/injection-engine.js';
import * as identity from '../../src/identity.js';

// ─── The two lists ─────────────────────────────────────────────────

/**
 * The sixteen subpaths 9.0.0 removed, each with the door that absorbed it
 * and one sample name whose IDENTITY proves the absorption is a re-export
 * rather than a re-implementation. Migration rows live in CHANGELOG 9.0.0.
 */
const REMOVED_SUBPATHS = [
  {
    subpath: './llm-providers',
    door: './providers',
    doorModule: providersDoor,
    implModule: llmProviders,
    sample: 'mock',
  },
  {
    subpath: './embedders',
    door: './providers',
    doorModule: providersDoor,
    implModule: embedders,
    sample: 'openaiEmbedder',
  },
  {
    subpath: './tool-providers',
    door: './providers',
    doorModule: providersDoor,
    implModule: toolProviders,
    sample: 'staticTools',
  },
  {
    subpath: './thinking',
    door: './providers',
    doorModule: providersDoor,
    implModule: thinking,
    sample: 'findThinkingHandler',
  },
  {
    subpath: './memory-providers',
    door: './memory',
    doorModule: memoryDoor,
    implModule: memoryProviders,
    sample: 'RedisStore',
  },
  {
    subpath: './observability-providers',
    door: './observe',
    doorModule: observeDoor,
    implModule: observabilityProviders,
    sample: 'otelObservability',
  },
  {
    subpath: './strategies',
    door: './observe',
    doorModule: observeDoor,
    implModule: strategies,
    sample: 'composeObservability',
  },
  {
    subpath: './stream',
    door: './observe',
    doorModule: observeDoor,
    implModule: stream,
    sample: 'toSSE',
  },
  {
    subpath: './status',
    door: './observe',
    doorModule: observeDoor,
    implModule: status,
    sample: 'selectStatus',
  },
  {
    subpath: './locales',
    door: './observe',
    doorModule: observeDoor,
    implModule: locales,
    sample: 'composeMessages',
  },
  {
    subpath: './debug',
    door: './observe',
    doorModule: observeDoor,
    implModule: debug,
    sample: 'localizeContextBug',
  },
  {
    subpath: './debug/finders',
    door: './observe',
    doorModule: observeDoor,
    implModule: debugFinders,
    sample: 'rankSuspects',
  },
  {
    subpath: './observability/contextError/finders',
    door: './observe',
    doorModule: observeDoor,
    implModule: contextErrorFinders,
    sample: 'rankSuspects',
  },
  {
    subpath: './hosting-providers',
    door: './hosting',
    doorModule: hostingDoor,
    implModule: hostingProviders,
    sample: 'agentCoreRuntimeHost',
  },
  {
    subpath: './injection-engine',
    door: './context',
    doorModule: contextDoor,
    implModule: injectionEngine,
    sample: 'defineInjection',
  },
  {
    subpath: './identity',
    door: './security',
    doorModule: securityDoor,
    implModule: identity,
    sample: 'agentCoreIdentity',
  },
] as const;

const REMOVED_SUBPATH_NAMES = REMOVED_SUBPATHS.map((r) => r.subpath);

/** Everything `package.json` still publishes, `./package.json` aside. */
const SURVIVING_SUBPATHS = [
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
  './reliability',
  // 9.34.0 — added, not resurrected: `./skill-graph` was never one of the
  // sixteen. It publishes the skill-graph decision layer whose framework
  // neutrality `test/lib/injection-engine/skill-graph-fence.test.ts` proves.
  './skill-graph',
  // 9.48.0 — also added, also never one of the sixteen. `./recipes` publishes
  // the declared unit of agent configuration (`defineAgentRecipe`), which is
  // authoring-time vocabulary: an app that CONSUMES a recipe imports the object
  // and calls `.recipe()`, so the main barrel stays as it was.
  './recipes',
] as const;

// ─── Manifest helpers ──────────────────────────────────────────────

interface PkgExportEntry {
  readonly import: { readonly types: string; readonly default: string };
  readonly require: { readonly types: string; readonly default: string };
}

interface Pkg {
  readonly type: string;
  readonly repository: { readonly url: string };
  readonly exports: Record<string, PkgExportEntry | string>;
  readonly typesVersions: Record<string, Record<string, string[]>>;
}

function loadPkg(): Pkg {
  return JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf-8')) as Pkg;
}

function codeEntry(subpath: string): PkgExportEntry {
  const entry = loadPkg().exports[subpath];
  if (entry === undefined || typeof entry === 'string') {
    throw new Error(`package.json exports has no code entry for "${subpath}"`);
  }
  return entry;
}

// ─── 1. The removed subpaths are GONE ──────────────────────────────

describe('9.0.0 — the sixteen removed subpaths are absent from the manifest', () => {
  for (const subpath of REMOVED_SUBPATH_NAMES) {
    it(`${subpath} is not an export subpath, and not a typesVersions key`, () => {
      const pkg = loadPkg();
      expect(
        pkg.exports[subpath],
        `${subpath} was removed in 9.0.0 — bringing it back is a migration-table conversation`,
      ).toBeUndefined();
      // A stale `typesVersions` row is the quiet failure mode: `exports`
      // refuses the path at runtime while TypeScript still types it, so the
      // editor says yes and Node says no.
      expect(
        pkg.typesVersions['*'][subpath.slice(2)],
        `${subpath} is gone from exports but still typed by typesVersions`,
      ).toBeUndefined();
    });
  }

  it('the removed list is pinned at exactly sixteen', () => {
    expect(REMOVED_SUBPATH_NAMES).toHaveLength(16);
    expect(new Set(REMOVED_SUBPATH_NAMES).size, 'the removed list has a duplicate').toBe(16);
  });

  it('the exports map is exactly the survivors plus ./package.json', () => {
    const actual = Object.keys(loadPkg().exports).slice().sort();
    expect(actual).toEqual([...SURVIVING_SUBPATHS, './package.json'].slice().sort());
  });
});

// ─── 2. Removal of a PATH was never removal of a NAME ──────────────

describe('9.0.0 removed import paths, not code — every absorbed barrel is still reachable', () => {
  for (const { subpath, door, doorModule, implModule, sample } of REMOVED_SUBPATHS) {
    it(`${subpath} still exports ${sample}, and ${door} serves the SAME object`, () => {
      const impl = implModule as unknown as Record<string, unknown>;
      const onDoor = doorModule as unknown as Record<string, unknown>;

      expect(impl[sample], `the ${subpath} barrel lost ${sample}`).toBeDefined();
      expect(onDoor[sample], `${door} does not carry ${sample}`).toBeDefined();
      // Identity, not presence. A door that re-implemented the name would
      // satisfy a `toBeDefined()` check and still be a different function
      // with different bugs.
      expect(onDoor[sample], `${door}'s ${sample} is a different object`).toBe(impl[sample]);
    });
  }
});

// ─── 3. The two tables agree, entry for entry ──────────────────────

describe('the exports and typesVersions tables agree', () => {
  it('every surviving subpath is present in exports', () => {
    const pkg = loadPkg();
    for (const subpath of SURVIVING_SUBPATHS) {
      expect(pkg.exports[subpath], `${subpath} must be published`).toBeDefined();
    }
  });

  it('every code entry serves per-condition types (import→ESM, require→CJS)', () => {
    for (const [key, entry] of Object.entries(loadPkg().exports)) {
      // The package.json self-reference is a plain string by Node convention
      // — it lets the library read its own version at runtime (auditExport
      // genesis records) and lets tooling deep-import the manifest.
      if (key === './package.json') {
        expect(entry).toBe('./package.json');
        continue;
      }
      const code = entry as PkgExportEntry;
      // Each condition carries its OWN context-correct types: the `import`
      // (ESM) condition points at ESM-context declarations, the `require`
      // (CJS) condition at CJS-context ones. A single flat `types` field
      // masquerades one module system's types as the other's (attw 🎭/👺).
      expect(code.import?.types, `missing import.types for ${key}`).toBeDefined();
      expect(code.import?.default, `missing import.default for ${key}`).toBeDefined();
      expect(code.require?.types, `missing require.types for ${key}`).toBeDefined();
      expect(code.require?.default, `missing require.default for ${key}`).toBeDefined();
    }
  });

  it('import points into dist/esm, require into dist — never crossed', () => {
    for (const [key, entry] of Object.entries(loadPkg().exports)) {
      if (key === './package.json') continue;
      const code = entry as PkgExportEntry;
      expect(code.import.types, `${key} import.types`).toMatch(/^\.\/dist\/esm\//);
      expect(code.import.default, `${key} import.default`).toMatch(/^\.\/dist\/esm\//);
      expect(code.require.types, `${key} require.types`).toMatch(/^\.\/dist\/types\//);
      expect(code.require.default, `${key} require.default`).not.toMatch(
        /^\.\/dist\/(esm|types)\//,
      );
      expect(code.require.default, `${key} require.default`).toMatch(/^\.\/dist\//);
    }
  });

  it('typesVersions covers every non-root export path (TS < 4.7 fallback)', () => {
    const pkg = loadPkg();
    const tv = pkg.typesVersions['*'];
    for (const key of Object.keys(pkg.exports)) {
      if (key === '.' || key === './package.json') continue;
      expect(tv[key.slice(2)], `typesVersions missing ${key}`).toBeDefined();
    }
  });

  it('typesVersions agrees with the require condition, entry for entry', () => {
    const pkg = loadPkg();
    const tv = pkg.typesVersions['*'];
    for (const [key, entry] of Object.entries(pkg.exports)) {
      if (key === '.' || key === './package.json' || typeof entry === 'string') continue;
      expect(tv[key.slice(2)], `typesVersions drifted for ${key}`).toEqual([entry.require.types]);
    }
  });

  it('typesVersions carries no key that exports does not publish', () => {
    const pkg = loadPkg();
    const published = new Set(
      Object.keys(pkg.exports)
        .filter((k) => k !== '.' && k !== './package.json')
        .map((k) => k.slice(2)),
    );
    for (const key of Object.keys(pkg.typesVersions['*'])) {
      expect(published.has(key), `typesVersions types "${key}", which exports refuses`).toBe(true);
    }
  });
});

// ─── 4. Door targets follow the door convention ────────────────────

describe('surviving subpaths resolve where their convention says', () => {
  // The eight consolidating doors are their own barrel under `dist/doors/`.
  // `./cache` and `./events` were never aliases and keep their original
  // homes; `./reliability` is the one retained alias and keeps its own file
  // because it is the only home of the reliability GATE's `CircuitOpenError`
  // (see door-aliases.test.ts for that design fact).
  const DOOR_BARRELS = [
    'providers',
    'memory',
    'rag',
    'observe',
    'context',
    'resilience',
    'hosting',
    'security',
  ];

  for (const door of DOOR_BARRELS) {
    it(`./${door} resolves to the dist/doors barrel`, () => {
      const entry = codeEntry(`./${door}`);
      expect(entry.require.default).toBe(`./dist/doors/${door}.js`);
      expect(entry.require.types).toBe(`./dist/types/doors/${door}.d.ts`);
      expect(entry.import.default).toBe(`./dist/esm/doors/${door}.js`);
      expect(entry.import.types).toBe(`./dist/esm/doors/${door}.d.ts`);
    });
  }

  it('./providers is a DOOR, not the 4.0.0 per-vendor alias it shares a name with', () => {
    // 4.0.0 removed `./providers` as a one-file alias of `./llm-providers`.
    // 8.0.0 reintroduced the name for a different, bigger job: every "plug in
    // a backend" surface behind one door. It resolves to its own barrel, NOT
    // to the llm-providers file the 4.0.0 alias pointed at — and that file no
    // longer has a subpath of its own at all.
    expect(codeEntry('./providers').require.default).toBe('./dist/doors/providers.js');
    expect(codeEntry('./providers').require.default).not.toBe('./dist/llm-providers.js');
  });

  it('./cache and ./events keep their pre-door homes — neither was ever an alias', () => {
    // ./cache stays its own door because importing it RUNS the vendor
    // cache-strategy registrations; side-effectful code stays opt-in.
    expect(codeEntry('./cache').require.default).toBe('./dist/cache/index.js');
    // ./events is the wire vocabulary, kept apart by a `ContextSource` that
    // is a different type from the one /observe carries.
    expect(codeEntry('./events').require.default).toBe('./dist/events.js');
  });

  it('./reliability is the one retained alias and keeps its own barrel', () => {
    expect(codeEntry('./reliability').require.default).toBe('./dist/reliability/index.js');
  });

  it('per-adapter memory aliases stayed removed (collapsed in 4.0.0)', () => {
    const exp = loadPkg().exports;
    // ./memory-redis + ./memory-agentcore collapsed into ./memory-providers,
    // which 8.0.0 folded into ./memory and 9.0.0 removed outright. Three
    // rounds of consolidation, none of them reversible.
    expect(exp['./memory-redis']).toBeUndefined();
    expect(exp['./memory-agentcore']).toBeUndefined();
  });
});

// ─── 5. Manifest hygiene (publint) ─────────────────────────────────

describe('the manifest itself', () => {
  it('declares its module type and a full git URL (publint)', () => {
    const pkg = loadPkg();
    // The root build is CJS; dist/esm carries its own {"type":"module"}.
    expect(pkg.type).toBe('commonjs');
    expect(pkg.repository.url).toMatch(/^git\+https:\/\//);
  });
});
