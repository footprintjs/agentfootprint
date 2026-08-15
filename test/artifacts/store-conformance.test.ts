/**
 * Every artifact store in this repository, against the ONE battery.
 *
 * The reason this file exists is worth stating plainly, because it is the
 * finding, not the fixture:
 *
 *   The five-verb laws used to live in `test/artifacts/storeContractSuite.ts` —
 *   one good definition, run against all five stores, and shipped to NOBODY.
 *   `package.json` excludes `dist/test`, so somebody implementing
 *   `ArtifactStore` over Postgres or a bucket of their own had no way to run
 *   the checks the in-tree stores are held to. A port whose proof cannot leave
 *   the repository is a port only its author can implement correctly.
 *
 * So the laws moved into `src/artifacts/conformance`, where they import no test
 * framework (a case throws to fail) and ship from the same door `ArtifactStore`
 * does. This file is the in-tree binding: five harnesses, one battery, one
 * `it()` per case per store.
 *
 * WHAT MOVED, law for law, so nothing was lost in the restyle:
 *   put/head/get round trip + `swept: []` + the ref grammar + `bytes`
 *     → put-mints-a-ticket-head-describes-get-redeems
 *   every payload shape round-trips        → payloads-round-trip-…
 *   a ref alone opens nothing (+ tenants)  → a-ref-alone-opens-nothing
 *   the four CONFUSABLE scope pairs        → confusable-scopes-are-not-one-scope
 *   null for missing AND expired           → missing-expired-and-foreign-scope-…
 *   ttl/expiresAt stated at mint           → expiry-is-stated-at-mint-never-sprung
 *   delete + deleting an absence           → delete-removes-and-deleting-an-absence-…
 *   list pages newest-first with a cursor  → list-pages-newest-first-…
 *   parentRefs validated at mint           → parent-refs-are-proven-at-mint
 *   digest computed at put, verified on get→ digest-is-minted-… + get-refuses-…
 *   malformed puts refused by name         → malformed-puts-are-refused-by-name
 * and the battery adds what the old suite could not state portably: the three
 * absences being ONE answer, awkward scope values, the ceiling refusing before
 * the write, refusal secrecy, and the streaming leg (including the deliberate
 * `getStream` integrity asymmetry).
 *
 * Where a store cannot satisfy a case it DECLARES it by name with the reason,
 * and the declarations are asserted below — a store cannot quietly acquire a
 * new exemption, and a declaration that has become untrue is reported STALE
 * rather than going on suppressing nothing.
 *
 * Nothing here reaches a network: the two cloud columns run against this
 * directory's emulation doubles, exactly as they did before.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  artifactStoreConformance,
  fileArtifacts,
  formatArtifactStoreReport,
  gcsArtifacts,
  inMemoryArtifacts,
  runArtifactStoreCase,
  runArtifactStoreConformance,
  s3Artifacts,
  sqliteArtifacts,
  type ArtifactScope,
  type ArtifactStore,
  type ArtifactStoreHarness,
} from '../../src/index.js';
import { scopeSegments } from '../../src/artifacts/scopePath.js';
import { fakeGcs, fakeS3, type FakeGcs, type FakeS3 } from './fakes/objectServices.js';

// ─── shared harness plumbing ─────────────────────────────────────────

const cleanups: Array<() => void> = [];
const tempDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'af-artifact-conformance-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

/**
 * Each store's clock, remembered BESIDE the instance.
 *
 * The port has no clock — deliberately — so the harness owns one per store and
 * the battery moves it through `advanceTime`. A WeakMap rather than a field so
 * nothing about the store under test is different from the store a consumer
 * constructs.
 */
const clocks = new WeakMap<object, { now(): number; tick(ms: number): void }>();

function newClock(): { now(): number; tick(ms: number): void } {
  let at = 1_000_000;
  return { now: () => at, tick: (ms) => (at += ms) };
}

/** Bind a store to a fresh clock and remember it. */
function withClock<T extends ArtifactStore>(build: (now: () => number) => T): T {
  const clock = newClock();
  const store = build(clock.now);
  clocks.set(store, clock);
  return store;
}

const advanceTime = (store: ArtifactStore, ms: number): void => clocks.get(store)!.tick(ms);

/** The tampered payload every `corrupt` hook writes — well-formed bytes that
 *  are simply not what was put, which is what makes the digest law observable
 *  without also testing the store's ability to survive garbage. */
const TAMPERED = 'tampered bytes';

// ─── inMemoryArtifacts ───────────────────────────────────────────────

const memoryHarness: ArtifactStoreHarness = {
  name: 'inMemoryArtifacts',
  createStore: () => withClock((now) => inMemoryArtifacts({ _now: now })),
  advanceTime,
  boundedStore: (maxBytesPerScope) =>
    withClock((now) => inMemoryArtifacts({ retention: { maxBytesPerScope }, _now: now })),
  declared: {
    // Not a defect, and not a gap in the battery: the payloads live in a Map
    // CLOSED OVER by the factory, so there is no reachable seam to write
    // through — which is also why this store cannot suffer the corruption the
    // case is about. The law it holds instead (a digest computed at put, on
    // every ticket) is checked by `digest-is-minted-over-the-payload-…`, which
    // this store passes.
    'get-refuses-a-payload-that-no-longer-matches-its-digest':
      'payloads live in a Map closed over by the factory, so nothing outside the store can ' +
      'change them — there is no way to stage the corruption this case detects, and no way ' +
      'for it to happen in the field either',
  },
};

// ─── fileArtifacts ───────────────────────────────────────────────────

const directories = new WeakMap<object, string>();

const fileHarness: ArtifactStoreHarness = {
  name: 'fileArtifacts',
  createStore: () => {
    const directory = tempDir();
    const store = withClock((now) => fileArtifacts({ directory, _now: now }));
    directories.set(store, directory);
    return store;
  },
  advanceTime,
  boundedStore: (maxBytesPerScope) => {
    const directory = tempDir();
    const store = withClock((now) =>
      fileArtifacts({ directory, retention: { maxBytesPerScope }, _now: now }),
    );
    directories.set(store, directory);
    return store;
  },
  corrupt: (store, scope, ref) => {
    // Through the filesystem, behind the store's back — which is exactly how a
    // corrupt payload arrives in the field: something that is not this store
    // wrote to the directory.
    const file = join(directories.get(store)!, ...scopeSegments(scope), `${ref}.json`);
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as {
      payload: { shape: string; value: string };
    };
    envelope.payload.value = TAMPERED;
    writeFileSync(file, JSON.stringify(envelope));
  },
};

// ─── sqliteArtifacts ─────────────────────────────────────────────────

interface RawDb {
  prepare(sql: string): { run(...params: unknown[]): unknown };
  close(): void;
}

const sqliteFiles = new WeakMap<object, string>();

function openRaw(file: string): RawDb {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (f: string) => RawDb };
  return new DatabaseSync(file);
}

const sqliteHarness: ArtifactStoreHarness = {
  name: 'sqliteArtifacts',
  createStore: () => {
    const file = join(tempDir(), 'artifacts.db');
    const store = withClock((now) => sqliteArtifacts({ file, _now: now }));
    sqliteFiles.set(store, file);
    return store;
  },
  disposeStore: (store) => (store as { close(): void }).close(),
  advanceTime,
  boundedStore: (maxBytesPerScope) => {
    const file = join(tempDir(), 'bounded.db');
    const store = withClock((now) =>
      sqliteArtifacts({ file, retention: { maxBytesPerScope }, _now: now }),
    );
    sqliteFiles.set(store, file);
    return store;
  },
  corrupt: (store, _scope, ref) => {
    // A SECOND connection to the same file — the shape a corrupt row really
    // arrives in: something that is not this store wrote to it.
    const raw = openRaw(sqliteFiles.get(store)!);
    raw.prepare('UPDATE af_artifacts SET payload = ? WHERE ref = ?').run(TAMPERED, ref);
    raw.close();
  },
};

// ─── the two object columns, against this directory's doubles ────────

const services = new WeakMap<object, FakeS3 | FakeGcs>();

/** The one object key holding this ref — found by suffix rather than rebuilt,
 *  so the harness does not re-implement the adapter's key law and then agree
 *  with itself. */
function keyFor(keys: Iterable<string>, ref: string): string {
  for (const key of keys) if (key.endsWith(`/${ref}`) || key === ref) return key;
  throw new Error(`[harness] no stored object for ${ref}`);
}

const s3Harness: ArtifactStoreHarness = {
  name: 's3Artifacts (double)',
  createStore: () => {
    let fake!: FakeS3;
    const store = withClock((now) => {
      fake = fakeS3(now);
      return s3Artifacts({ bucket: 'b', prefix: 'artifacts', _client: fake.client, _now: now });
    });
    services.set(store, fake);
    return store;
  },
  advanceTime,
  boundedStore: (maxBytesPerScope) => {
    let fake!: FakeS3;
    const store = withClock((now) => {
      fake = fakeS3(now);
      return s3Artifacts({
        bucket: 'b',
        retention: { maxBytesPerScope },
        _client: fake.client,
        _now: now,
      });
    });
    services.set(store, fake);
    return store;
  },
  corrupt: (store, _scope, ref) => {
    const fake = services.get(store) as FakeS3;
    const key = keyFor(fake.objects.keys(), ref);
    const held = fake.objects.get(key)!;
    fake.objects.set(key, { ...held, body: new TextEncoder().encode(TAMPERED) });
  },
};

const gcsHarness: ArtifactStoreHarness = {
  name: 'gcsArtifacts (double)',
  createStore: () => {
    let fake!: FakeGcs;
    const store = withClock((now) => {
      fake = fakeGcs(now);
      return gcsArtifacts({ bucket: 'b', prefix: 'artifacts', _storage: fake.storage, _now: now });
    });
    services.set(store, fake);
    return store;
  },
  advanceTime,
  boundedStore: (maxBytesPerScope) => {
    let fake!: FakeGcs;
    const store = withClock((now) => {
      fake = fakeGcs(now);
      return gcsArtifacts({
        bucket: 'b',
        retention: { maxBytesPerScope },
        _storage: fake.storage,
        _now: now,
      });
    });
    services.set(store, fake);
    return store;
  },
  corrupt: (store, _scope, ref) => {
    const fake = services.get(store) as FakeGcs;
    const key = keyFor(fake.blobs.keys(), ref);
    const held = fake.blobs.get(key)!;
    fake.blobs.set(key, { ...held, bytes: new TextEncoder().encode(TAMPERED) });
  },
};

// ─── the run ─────────────────────────────────────────────────────────

const HARNESSES = [memoryHarness, fileHarness, sqliteHarness, s3Harness, gcsHarness];

/**
 * `node:sqlite` ships from Node 22.5; this repository's CI matrix also runs
 * Node 20, where `sqliteArtifacts()` cannot be CONSTRUCTED at all.
 *
 * That is a missing runtime, not a store failing a law, so it is the one thing
 * the battery's `declared` mechanism must NOT be used for: a declaration says
 * "this store cannot satisfy this case" and answers a question about the port.
 * Here there is no store to ask. The battery is skipped WHOLE, and visibly.
 */
const sqliteAvailable = await (async (): Promise<boolean> => {
  try {
    const mod = (await import('node:sqlite')) as { DatabaseSync?: unknown };
    return typeof mod.DatabaseSync === 'function';
  } catch {
    return false;
  }
})();

for (const harness of HARNESSES) {
  const on = harness === sqliteHarness && !sqliteAvailable ? describe.skip : describe;
  on(`ArtifactStore conformance — ${harness.name}`, () => {
    for (const testCase of artifactStoreConformance) {
      it(testCase.name, async () => {
        const outcome = await runArtifactStoreCase(testCase, harness);
        if (outcome.status === 'failed') {
          throw new Error(
            `${harness.name} broke a promise of the port.\n` +
              `  law: ${outcome.law}\n` +
              `  ${outcome.error.message}`,
          );
        }
        // A declaration that has become true-by-accident is reported, not
        // honoured. Otherwise a store carries an exemption it no longer needs
        // and the next real failure inherits it.
        if (outcome.status === 'declared' && !outcome.stillFails) {
          throw new Error(
            `${harness.name} DECLARES '${testCase.name}' and now passes it. Remove the ` +
              `declaration — a suppression nobody revisits is how a fixed defect keeps its ` +
              `exemption.`,
          );
        }
        expect(['passed', 'not-applicable', 'declared']).toContain(outcome.status);
      });
    }
  });
}

describe('the one-call entry point an out-of-tree store uses', () => {
  it('runs the whole battery and reports what happened, per store', async () => {
    // The shape a consumer actually reaches for — `if (!report.ok) throw` — so
    // the counts and the formatter are exercised rather than merely exported.
    const report = await runArtifactStoreConformance(fileHarness);

    expect(report.store).toBe('fileArtifacts');
    expect(report.ok).toBe(true);
    expect(report.failed).toBe(0);
    expect(report.outcomes).toHaveLength(artifactStoreConformance.length);
    // Every case is accounted for exactly once — a report that lost a row
    // would understate a store the same way a silent skip does.
    expect(report.passed + report.declared + report.notApplicable + report.failed).toBe(
      artifactStoreConformance.length,
    );

    const text = formatArtifactStoreReport(report);
    expect(text).toContain('fileArtifacts');
    expect(text).toContain('a-ref-alone-opens-nothing');
  });

  it('a store with a stated limitation is conformant WITH LIMITS, and the report says which', async () => {
    const report = await runArtifactStoreConformance(memoryHarness);
    expect(report.ok).toBe(true);
    expect(report.declared).toBe(1);
    // The two streaming members are absent by design on this store, so their
    // cases are n/a — feature detection, not a shortfall.
    expect(report.notApplicable).toBe(2);
    const text = formatArtifactStoreReport(report);
    expect(text).toContain('declared  get-refuses-a-payload-that-no-longer-matches-its-digest');
    expect(text).toContain('closed over by the factory');
    expect(text).toContain('n/a       get-stream-does-not-verify-the-digest — no getStream()');
    expect(text).not.toContain('STALE');
  });

  it('a store that breaks a law is reported FAILED, with the law it broke', async () => {
    // The formatter's own load-bearing branch, against a store built to fail:
    // one that ignores the scope argument — the leak this battery exists to
    // catch in a store nobody here wrote.
    const report = await runArtifactStoreConformance(scopeBlindHarness);
    expect(report.ok).toBe(false);
    const failed = report.outcomes.filter((o) => o.status === 'failed').map((o) => o.case);
    expect(failed).toContain('a-ref-alone-opens-nothing');
    const text = formatArtifactStoreReport(report);
    expect(text).toContain('FAILED');
    expect(text).toContain('law:');
  });
});

/**
 * A store that holds everything in ONE shelf, ignoring the scope it was given.
 *
 * Not a strawman: it is what an adapter becomes the moment somebody "optimises"
 * the scope out of a key, and it is the single defect the whole battery is
 * pointed at. It exists here so the FAILED branch is exercised on every run,
 * not only when somebody remembers to break a real store by hand.
 */
const scopeBlindHarness: ArtifactStoreHarness = {
  name: 'scope-blind (deliberately broken)',
  createStore: () => {
    const inner = inMemoryArtifacts();
    const ONE: ArtifactScope = { conversationId: 'everybody' };
    return {
      put: (_scope, input) => inner.put(ONE, input),
      head: (_scope, ref) => inner.head(ONE, ref),
      get: (_scope, ref) => inner.get(ONE, ref),
      delete: (_scope, ref) => inner.delete(ONE, ref),
      list: (_scope, options) => inner.list(ONE, options),
    };
  },
};

describe('the declarations are the whole list, and each one is argued', () => {
  it('no store has a declaration this file does not name', () => {
    // A new declaration has to be added HERE, deliberately, beside the reason.
    // That is the difference between a limitation somebody accepted and a
    // failing case somebody silenced on a Friday.
    const declarations = HARNESSES.flatMap((harness) =>
      Object.keys(harness.declared ?? {}).map((name) => `${harness.name}: ${name}`),
    );
    expect(declarations).toEqual([
      'inMemoryArtifacts: get-refuses-a-payload-that-no-longer-matches-its-digest',
    ]);
  });

  it('every declaration says WHY, in a sentence', () => {
    for (const harness of HARNESSES) {
      for (const [name, reason] of Object.entries(harness.declared ?? {})) {
        expect(reason.length, `${harness.name}/${name} declared with no reason`).toBeGreaterThan(
          30,
        );
      }
    }
  });
});

describe('the battery covers what it claims to', () => {
  it('holds every case the port names, each with a law, each name unique', () => {
    // A battery that quietly lost a case would pass every store trivially.
    expect(artifactStoreConformance.length).toBe(19);
    const names = artifactStoreConformance.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const testCase of artifactStoreConformance) {
      expect(testCase.law.length, `${testCase.name} has no law`).toBeGreaterThan(20);
    }
    expect(names).toContain('a-ref-alone-opens-nothing');
    expect(names).toContain('get-stream-does-not-verify-the-digest');
  });

  it('imports NO test framework anywhere under src/ — that is what makes it shippable', () => {
    // The whole point of the restyle: an out-of-tree consumer runs these cases
    // under jest, node:test, or no runner at all. One `import { it } from
    // 'vitest'` in src/ would make the published package depend on a dev tool.
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(path);
        } else if (entry.name.endsWith('.ts')) {
          const text = readFileSync(path, 'utf8');
          if (/\bfrom\s+['"](vitest|@jest\/globals|node:test|mocha|chai)['"]/.test(text)) {
            offenders.push(path);
          }
        }
      }
    };
    walk(join(import.meta.dirname, '../../src'));
    expect(offenders).toEqual([]);
  });

  it('a case that cannot run and was not declared FAILS rather than skipping', async () => {
    // The battery's own load-bearing rule, executable. A harness with no
    // `corrupt` hook and no declaration must not quietly report a pass.
    const silent: ArtifactStoreHarness = {
      name: 'no-corrupt-hook',
      createStore: () => inMemoryArtifacts(),
    };
    const integrity = artifactStoreConformance.find(
      (c) => c.name === 'get-refuses-a-payload-that-no-longer-matches-its-digest',
    )!;
    const outcome = await runArtifactStoreCase(integrity, silent);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.error.message).toContain('DECLARE this case by name');
      expect(outcome.error.message).toContain('corrupt');
    }
  });

  it('a case about an optional member the store lacks is n/a, not a pass and not a failure', async () => {
    const noStreaming: ArtifactStoreHarness = {
      name: 'no-streaming',
      createStore: () => inMemoryArtifacts(),
    };
    const streamed = artifactStoreConformance.find(
      (c) => c.name === 'streamed-put-round-trips-and-declares-its-bytes',
    )!;
    const outcome = await runArtifactStoreCase(streamed, noStreaming);
    expect(outcome.status).toBe('not-applicable');
    if (outcome.status === 'not-applicable') expect(outcome.missing).toBe('putStream');
  });

  it('a DECLARED case is still RUN, so a declaration that starts passing is reported STALE', async () => {
    // This is the rule that keeps `declared` from becoming a skip list. Break
    // it — return `declared` without running the case — and this test is the
    // one that catches you.
    const overDeclared: ArtifactStoreHarness = {
      name: 'declares-a-case-it-passes',
      createStore: () => withClock((now) => inMemoryArtifacts({ _now: now })),
      advanceTime,
      declared: {
        'delete-removes-and-deleting-an-absence-is-agreement':
          'a deliberately stale declaration, for the test below — this store deletes perfectly ' +
          'well and always did',
      },
    };
    const deletion = artifactStoreConformance.find(
      (c) => c.name === 'delete-removes-and-deleting-an-absence-is-agreement',
    )!;
    const outcome = await runArtifactStoreCase(deletion, overDeclared);
    expect(outcome.status).toBe('declared');
    if (outcome.status === 'declared') expect(outcome.stillFails).toBe(false);

    const report = await runArtifactStoreConformance(overDeclared);
    expect(formatArtifactStoreReport(report)).toContain('[STALE: it passes now]');
  });

  it('a declared case that STILL fails is reported as declared, not as passing', async () => {
    const honest: ArtifactStoreHarness = {
      name: 'declares-a-case-it-really-cannot-pass',
      createStore: () => inMemoryArtifacts(),
      declared: {
        'get-refuses-a-payload-that-no-longer-matches-its-digest':
          'nothing outside this store can reach its payloads, so the corruption cannot be staged',
      },
    };
    const integrity = artifactStoreConformance.find(
      (c) => c.name === 'get-refuses-a-payload-that-no-longer-matches-its-digest',
    )!;
    const outcome = await runArtifactStoreCase(integrity, honest);
    expect(outcome.status).toBe('declared');
    if (outcome.status === 'declared') {
      expect(outcome.stillFails).toBe(true);
      expect(outcome.reason).toContain('cannot be staged');
    }
  });
});

// The temp directories outlive every case, so they are removed once, at the
// end. A file left behind is not a failure worth failing the suite over.
process.on('exit', () => {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      /* best effort */
    }
  }
});
