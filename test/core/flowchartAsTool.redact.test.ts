/**
 * flowchartAsTool({ redact }) — what a tool may SHOW is one rule (9.89.1; §6 re-stated for footprintjs 9.19.x in 9.89.2; §7 flipped for 9.20.0 in 9.89.3).
 *
 * The defect (docs/design/2026-09-recorded-not-built.md · entry 6): the
 * policy scrubbed the inner COMMIT LOG, and every other state-bearing thing
 * the tool handed outward — the string the model reads, the kept record's
 * `sharedState`, a subflow's final state — was the run's raw working memory.
 * Two mechanisms that were each correct, never composed.
 *
 * The rule now: with a policy set, everything the tool serves is footprintjs's
 * REDACTED view (`getSnapshot({ redact: true })`), the very object the
 * substrate serves — since footprintjs 9.20.0 that view already carries every
 * subflow's final state as the subflow's own mirror, so nothing is refolded
 * here. Without a policy the raw snapshot is served exactly as before.
 *
 * The strongest assertion is the byte one: serialize the whole thing and grep
 * for the secret. Every block below does that first and reads fields second.
 *
 * Pins:
 *   - reproduction: the result string AND the kept record carry the placeholder
 *   - nested objects and arrays under key-level / pattern redaction
 *   - a subflow's kept state is the placeholder, served once under both keys
 *   - error and paused exits keep a redacted record too
 *   - no-option path: raw snapshot, plaintext, fold base present — unchanged
 *   - the five 9.18 leaks, each CLOSED by footprintjs 9.19.x (red on 9.18):
 *     dot-path fields, merge-back, seed history[0], seed Input: line, stageReads
 *   - the last limit, CLOSED by footprintjs 9.20.0 (red on 9.19.x): the substrate's
 *     own redacted view mirrors a subflow, and `servableSnapshot` serves that object
 */

import { describe, expect, it, vi } from 'vitest';
import { FlowChartExecutor, flowChart, type PausableHandler } from 'footprintjs';
import { flowchartAsTool, type FlowchartToolSnapshot } from '../../src/index.js';
import { innerRunsOf } from '../../src/observe.js';
import { servableSnapshot } from '../../src/core/servableSnapshot.js';
import { unconfiguredCredentialProvider } from '../../src/identity.js';

const SECRET = 'sk-live-SUPER-SECRET-BYTES';

const ctxFor = (toolCallId: string) =>
  ({
    toolCallId,
    iteration: 1,
    credentials: unconfiguredCredentialProvider(),
    hasCredentials: false,
  } as never);

interface KeptSnapshot {
  sharedState: Record<string, unknown>;
  commitLog: unknown[];
  initialState?: Record<string, unknown>;
  subflowResults?: Record<
    string,
    { treeContext: { globalContext: Record<string, unknown>; history: unknown[] } }
  >;
}

/** The whole kept record — snapshot, narrative, control deps — as bytes. */
function keptBytes(tool: ReturnType<typeof flowchartAsTool>, toolCallId: string): string {
  const record = innerRunsOf(tool)!.get(toolCallId)!;
  expect(record.problem).toBeUndefined();
  return JSON.stringify(record);
}

function keptSnapshot(tool: ReturnType<typeof flowchartAsTool>, toolCallId: string): KeptSnapshot {
  return innerRunsOf(tool)!.get(toolCallId)!.recording!.snapshot as KeptSnapshot;
}

function flatChart() {
  return flowChart<{ apiKey: string; used: string }>(
    'Use the key',
    (scope) => {
      scope.apiKey = SECRET;
      scope.used = 'called';
    },
    'use-key',
  ).build();
}

// ─── 1. THE REPRODUCTION ─────────────────────────────────────────────

describe('flowchartAsTool({ redact }) — the tool serves the redacted view', () => {
  it('the result string the model reads carries the placeholder, not the secret', async () => {
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'runs a chart that touches a key',
      flowchart: flatChart(),
      redact: { keys: ['apiKey'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    expect(result).toContain('REDACTED');
    // Scrubbed, not stripped: the key is still there, and the open key is untouched.
    expect(JSON.parse(result)).toEqual({ apiKey: 'REDACTED', used: 'called' });
  });

  it('a custom resultMapper is handed the redacted values — scrubbing is not its job', async () => {
    let seen: FlowchartToolSnapshot | undefined;
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'd',
      flowchart: flatChart(),
      redact: { keys: ['apiKey'] },
      resultMapper: (snapshot) => {
        seen = snapshot;
        return String(snapshot.values.apiKey);
      },
    });
    const result = await tool.execute({}, ctxFor('c1'));
    expect(result).toBe('REDACTED');
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('the kept record — every field of it — carries the placeholder, not the secret', async () => {
    const tool = flowchartAsTool({
      name: 'inner_chart',
      description: 'd',
      flowchart: flatChart(),
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    await tool.execute({}, ctxFor('c1'));
    const bytes = keptBytes(tool, 'c1');
    expect(bytes).not.toContain(SECRET);
    expect(bytes).toContain('REDACTED');

    const snapshot = keptSnapshot(tool, 'c1');
    // The state view is now the MIRROR — the same placeholder the log holds.
    expect(snapshot.sharedState.apiKey).toBe('REDACTED');
    expect(snapshot.sharedState.used).toBe('called');
    expect(JSON.stringify(snapshot.commitLog)).toContain('REDACTED');
    // footprintjs's own law for the redacted view: the fold base is the raw
    // pre-run seed, no policy ever touched it, so it is OMITTED rather than
    // served. A fold of this record reports `basis: 'log-only'` — a partial
    // answer that says it is partial.
    expect(snapshot.initialState).toBeUndefined();
  });
});

// ─── 2. SHAPES — nested objects, patterns, arrays ─────────────────────

describe('flowchartAsTool({ redact }) — nested values and arrays', () => {
  it('a nested object under a redacted key is one placeholder, in the result and the record', async () => {
    const tool = flowchartAsTool({
      name: 'nested',
      description: 'd',
      flowchart: flowChart<{ config: unknown; open: number }>(
        'Configure',
        (scope) => {
          scope.config = { auth: { token: SECRET, user: 'u1' }, region: 'us' };
          scope.open = 1;
        },
        'configure',
      ).build(),
      keepRecord: true,
      redact: { keys: ['config'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    expect(JSON.parse(result)).toEqual({ config: 'REDACTED', open: 1 });
    expect(keptBytes(tool, 'c1')).not.toContain(SECRET);
    expect(keptSnapshot(tool, 'c1').sharedState).toEqual({ config: 'REDACTED', open: 1 });
  });

  it('a pattern matches the key, and the arrays under it are one placeholder each', async () => {
    const tool = flowchartAsTool({
      name: 'arrays',
      description: 'd',
      flowchart: flowChart<{ accessTokens: string[]; tokenRows: unknown[]; count: number }>(
        'Collect',
        (scope) => {
          scope.accessTokens = [SECRET, `${SECRET}-2`];
          scope.tokenRows = [{ token: SECRET }, { token: `${SECRET}-3` }];
          scope.count = 2;
        },
        'collect',
      ).build(),
      keepRecord: true,
      redact: { patterns: [/token/i] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    expect(JSON.parse(result)).toEqual({
      accessTokens: 'REDACTED',
      tokenRows: 'REDACTED',
      count: 2,
    });
    expect(keptBytes(tool, 'c1')).not.toContain(SECRET);
  });
});

// ─── 3. SUBFLOWS — the kept state is the subflow's own mirror, served once ──

/** A parent mounting a subflow that writes the secret and lets only a derived value out (§3, §7). */
function chartWithSubflow() {
  const inner = flowChart<{ innerKey: string; derived: string }>(
    'Use the key inside',
    (scope) => {
      scope.innerKey = SECRET;
      scope.derived = 'ok';
    },
    'inner-use',
  ).build();
  return flowChart<{ start: number; derived?: string }>(
    'Start',
    (scope) => {
      scope.start = 1;
    },
    'start',
  )
    .addSubFlowChartNext('sf', inner, 'Sub', {
      inputMapper: () => ({}),
      // Only the DERIVED value leaves the subflow; the key stays inside.
      outputMapper: (out) => ({ derived: out.derived }),
    })
    .build();
}

describe('flowchartAsTool({ redact }) — subflow results', () => {
  it('a secret written INSIDE a subflow is a placeholder in its kept state, not the raw heap', async () => {
    const tool = flowchartAsTool({
      name: 'with_subflow',
      description: 'd',
      flowchart: chartWithSubflow(),
      keepRecord: true,
      redact: { keys: ['innerKey'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    expect(JSON.parse(result)).toEqual({ start: 1, derived: 'ok' });

    // The byte assertion covers `subflowResults[*].treeContext.globalContext`,
    // which footprintjs serves as the subflow's own redacted mirror since
    // 9.20.0 (through 9.19.x it was the raw heap, refolded here — §7).
    const bytes = keptBytes(tool, 'c1');
    expect(bytes).not.toContain(SECRET);

    const results = keptSnapshot(tool, 'c1').subflowResults!;
    expect(Object.keys(results).length).toBeGreaterThan(0);
    for (const entry of Object.values(results)) {
      expect(entry.treeContext.globalContext).toEqual({ innerKey: 'REDACTED', derived: 'ok' });
      // The log beside it is scrubbed too — the mirror is its fold.
      expect(JSON.stringify(entry.treeContext.history)).not.toContain(SECRET);
    }
  });

  it('the same subflow object under both keys (path and mount id) is served as ONE object', async () => {
    const tool = flowchartAsTool({
      name: 'with_subflow',
      description: 'd',
      flowchart: chartWithSubflow(),
      keepRecord: true,
      redact: { keys: ['innerKey'] },
    });
    await tool.execute({}, ctxFor('c1'));
    const entries = Object.values(keptSnapshot(tool, 'c1').subflowResults!);
    expect(entries.length).toBe(2);
    expect(entries[0]).toBe(entries[1]);
  });
});

// ─── 4. EVERY EXIT — error and paused records are redacted too ────────

describe('flowchartAsTool({ redact }) — error and paused exits', () => {
  it('a run that threw still files a redacted record', async () => {
    const tool = flowchartAsTool({
      name: 'throws',
      description: 'd',
      flowchart: flowChart<{ apiKey: string }>(
        'Write then fail',
        (scope) => {
          scope.apiKey = SECRET;
          throw new Error('downstream is down');
        },
        'write-fail',
      ).build(),
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    await expect(tool.execute({}, ctxFor('c1'))).rejects.toThrow('downstream is down');
    const record = innerRunsOf(tool)!.get('c1')!;
    expect(record.outcome).toBe('error');
    expect(JSON.stringify(record)).not.toContain(SECRET);
    expect((record.recording!.snapshot as KeptSnapshot).sharedState.apiKey).toBe('REDACTED');
  });

  it('a run that paused files a redacted record; the resume checkpoint is NOT a served view', async () => {
    const pausable: PausableHandler<{ apiKey: string }> = {
      execute: (scope) => {
        scope.apiKey = SECRET;
        return { question: 'approve?' };
      },
      resume: () => {},
    };
    const tool = flowchartAsTool({
      name: 'pauses',
      description: 'd',
      flowchart: flowChart<{ apiKey: string }>('Wait', pausable, 'wait').build(),
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    let thrown: (Error & { checkpoint?: unknown }) | undefined;
    try {
      await tool.execute({}, ctxFor('c1'));
    } catch (e) {
      thrown = e as Error & { checkpoint?: unknown };
    }
    expect(thrown?.message).toContain('paused');
    const record = innerRunsOf(tool)!.get('c1')!;
    expect(record.outcome).toBe('paused');
    expect(JSON.stringify(record)).not.toContain(SECRET);
    // The checkpoint is the RESUME mechanism, not a view: resumption must
    // replay against real values. It rides `err.checkpoint` for the agent
    // loop and is never handed to a model — documented, and pinned here so a
    // change to that is a decision rather than a drift.
    expect(thrown?.checkpoint).toBeDefined();
    // …and it holds the REAL value — the other half of footprintjs's one law
    // (9.19.0): resumption replays real values; the served record above does not.
    expect(JSON.stringify(thrown!.checkpoint)).toContain(SECRET);
  });
});

// ─── 5. NO OPTION — the raw path, unchanged ───────────────────────────

describe('flowchartAsTool without `redact` — byte-identical to before', () => {
  it('serves the raw snapshot: plaintext values, fold base present, same keys as getSnapshot()', async () => {
    const tool = flowchartAsTool({
      name: 'plain',
      description: 'd',
      flowchart: flatChart(),
      keepRecord: true,
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(JSON.parse(result)).toEqual({ apiKey: SECRET, used: 'called' });

    const snapshot = keptSnapshot(tool, 'c1');
    expect(snapshot.sharedState.apiKey).toBe(SECRET);
    // No policy ⇒ no omission: the fold base travels, exactly as it did.
    expect(snapshot.initialState).toEqual({});

    // The same chart run directly has the same snapshot shape — the tool adds
    // and removes nothing on the raw path.
    const direct = new FlowChartExecutor(flatChart());
    await direct.run({ input: {} });
    const reference = direct.getSnapshot() as unknown as Record<string, unknown>;
    expect(Object.keys(snapshot as unknown as Record<string, unknown>).sort()).toEqual(
      Object.keys(reference).sort(),
    );
    expect(snapshot.sharedState).toEqual(reference.sharedState);
    // The actual claim: without a policy the servable view IS getSnapshot(), byte for byte.
    expect(JSON.stringify(servableSnapshot(direct, undefined))).toBe(
      JSON.stringify(direct.getSnapshot()),
    );
  });
});

// ─── 6. CLOSED BY footprintjs 9.19.x — one policy covers the record ───
//
// On footprintjs 9.18 each of these five was a place where the COMMIT LOG
// itself carried the plaintext — a write or a read that went PAST the scope
// facade, which held the verdict alone — so no served view built on the log
// could scrub it, and 9.89.1 pinned each one as a "substrate limit".
// footprintjs 9.19.0 gave the verdict ONE owner (`RedactionRule`, asked by
// `StageContext` on every staged write and every tracked read), so a subflow
// seed, a merge-back, a tracked read and a dot-path field are retained under
// the same verdict as `scope.apiKey = …`. Same five charts, assertions
// inverted: the secret is ABSENT from every served surface each case named
// (result, kept record bytes, log, mirror, stageReads, narrative, history[0],
// parent log) and PRESENT where the law keeps it — the live heap the stage
// computes on (each stage proves it by computing on the real value; §4 pins
// the resume checkpoint). Every `it` below is RED on footprintjs 9.18.x and
// green on ^9.19.1, the version this package now requires.

describe('flowchartAsTool({ redact }) — closed by footprintjs 9.19.x: the record is as clean as the law says', () => {
  it('`fields` dot-path redaction reaches the log and the served view; the sibling field survives', async () => {
    const tool = flowchartAsTool({
      name: 'fields_only',
      description: 'd',
      flowchart: flowChart<{ profile: unknown }>(
        'Profile',
        (scope) => {
          scope.profile = { auth: { token: SECRET }, name: 'n' };
        },
        'profile',
      ).build(),
      keepRecord: true,
      redact: { fields: { profile: ['auth.token'] } },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    // 9.18: the field-level scrub reached recorder views only and the commit
    // took the key-level verdict, so the result and the log kept the value.
    expect(result).not.toContain(SECRET);
    expect(JSON.parse(result)).toEqual({ profile: { auth: { token: 'REDACTED' }, name: 'n' } });
    const snapshot = keptSnapshot(tool, 'c1');
    expect(JSON.stringify(snapshot.commitLog)).not.toContain(SECRET);
    expect(snapshot.sharedState).toEqual({ profile: { auth: { token: 'REDACTED' }, name: 'n' } });
    expect(keptBytes(tool, 'c1')).not.toContain(SECRET);
  });

  it('a value an outputMapper writes BACK into the parent is scrubbed in the parent log and the mirror (footprintjs SubflowInputMapper · applyOutputMapping)', async () => {
    const inner = flowChart<{ innerKey: string }>(
      'Inside',
      (scope) => {
        scope.innerKey = SECRET;
      },
      'inside',
    ).build();
    const chart = flowChart<{ start: number; innerKey?: string }>(
      'Start',
      (scope) => {
        scope.start = 1;
      },
      'start',
    )
      .addSubFlowChartNext('sf', inner, 'Sub', {
        inputMapper: () => ({}),
        outputMapper: (out) => ({ innerKey: out.innerKey }),
      })
      .build();
    const tool = flowchartAsTool({
      name: 'merge_back',
      description: 'd',
      flowchart: chart,
      keepRecord: true,
      redact: { keys: ['innerKey'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    expect(JSON.parse(result)).toEqual({ start: 1, innerKey: 'REDACTED' });
    const snapshot = keptSnapshot(tool, 'c1');
    // Inside the subflow the write went through the facade: scrubbed, as before.
    for (const entry of Object.values(snapshot.subflowResults!)) {
      expect(JSON.stringify(entry.treeContext.history)).not.toContain(SECRET);
    }
    // 9.18: the merge-back wrote through `StageContext` directly and the
    // PARENT log took the key verbatim. Now the same funnel decides.
    expect(JSON.stringify(snapshot.commitLog)).not.toContain(SECRET);
    expect(JSON.stringify(snapshot.commitLog)).toContain('REDACTED');
    expect(snapshot.sharedState.innerKey).toBe('REDACTED');
    expect(keptBytes(tool, 'c1')).not.toContain(SECRET);
  });

  function seededChart() {
    const inner = flowChart<{ apiKey: string; seen: number }>(
      'Inside',
      (scope) => {
        scope.seen = scope.apiKey.length; // computed on the REAL seed — the live heap is never scrubbed
      },
      'inside',
    ).build();
    return flowChart<{ apiKey: string; seen?: number }>(
      'Start',
      (scope) => {
        scope.apiKey = SECRET;
      },
      'start',
    )
      .addSubFlowChartNext('sf', inner, 'Sub', {
        inputMapper: (parent) => ({ apiKey: parent.apiKey }),
        outputMapper: (out) => ({ seen: out.seen }),
      })
      .build();
  }

  it('a value an inputMapper carries INTO a subflow is a scrubbed seed commit — history[0] holds the placeholder (footprintjs SubflowInputMapper · seedSubflowGlobalStore)', async () => {
    const tool = flowchartAsTool({
      name: 'seeded',
      description: 'd',
      flowchart: seededChart(),
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    // The subflow computed on the real seed: the live heap is the law's other half.
    expect(JSON.parse(result)).toEqual({ apiKey: 'REDACTED', seen: SECRET.length });
    const snapshot = keptSnapshot(tool, 'c1');
    expect(JSON.stringify(snapshot.commitLog)).not.toContain(SECRET);
    // 9.18: the seed was committed by the subflow's runtime, not a facade, so
    // `history[0]` carried it raw. Now the seed passes the same rule.
    const entries = Object.values(snapshot.subflowResults!);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const seed = entry.treeContext.history[0] as { overwrite: Record<string, unknown> };
      expect(seed.overwrite.apiKey).toBe('REDACTED');
      expect(JSON.stringify(entry.treeContext.history)).not.toContain(SECRET);
    }
    expect(keptBytes(tool, 'c1')).not.toContain(SECRET);
  });

  it('the same seed, narrated as the subflow’s "Input:" line, carries the placeholder (footprintjs SubflowExecutor · narrativeInput)', async () => {
    const tool = flowchartAsTool({
      name: 'seeded',
      description: 'd',
      flowchart: seededChart(),
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    await tool.execute({}, ctxFor('c1'));
    // 9.18: the "Input:" line was generated from the mapped input before any
    // policy saw it and kept in the record's narrative with its rawValue.
    const bytes = keptBytes(tool, 'c1');
    expect(bytes).toMatch(/Input: apiKey.{0,12}\[REDACTED\]/);
    expect(bytes).not.toContain(SECRET);
  });

  it('a stage that READS a redacted key retains the placeholder in its tracked reads while it read the real value (footprintjs StageContext · getValue → stageReads)', async () => {
    const chart = flowChart<{ apiKey: string; used: number }>(
      'Write',
      (scope) => {
        scope.apiKey = SECRET;
      },
      'write',
    )
      .addFunction(
        'Read',
        (scope) => {
          scope.used = scope.apiKey.length; // a tracked READ of the live value
        },
        'read',
      )
      .build();
    const tool = flowchartAsTool({
      name: 'read_after_write',
      description: 'd',
      flowchart: chart,
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    expect(result).not.toContain(SECRET);
    // The stage read the real value (the live heap); the record kept the placeholder.
    expect(JSON.parse(result)).toEqual({ apiKey: 'REDACTED', used: SECRET.length });
    const snapshot = keptSnapshot(tool, 'c1') as unknown as {
      sharedState: unknown;
      commitLog: unknown;
      executionTree: { next?: { stageReads?: Record<string, unknown> } };
    };
    expect(JSON.stringify(snapshot.sharedState)).not.toContain(SECRET);
    expect(JSON.stringify(snapshot.commitLog)).not.toContain(SECRET);
    // 9.18: read-tracking retention was not one of the redaction points, so
    // `executionTree.*.stageReads` carried the value the stage read.
    expect(snapshot.executionTree.next?.stageReads?.apiKey).toBe('[REDACTED]');
    expect(JSON.stringify(snapshot.executionTree)).not.toContain(SECRET);
    expect(keptBytes(tool, 'c1')).not.toContain(SECRET);
  });
});

// ─── 7. THE LAST LIMIT, CLOSED — a subflow's served state is its own mirror ─
//
// Through footprintjs 9.19.x the redacted mirror existed for the RUN-level
// runtime only: a subflow's final state (`subflowResults[*].treeContext
// .globalContext`, and its per-iteration `#n` twin) was that subflow's own
// isolated heap even under `getSnapshot({ redact: true })`, and this section
// pinned that limit beside the refold `servableSnapshot` did to answer it.
// footprintjs 9.20.0 closed it at the root — a subflow keeps its own mirror
// whenever the run does, served as ONE substituted object per mount — so the
// refold is gone (9.89.3): one owner of the rule. This section now pins both
// halves: the substrate's own redacted view holds the placeholder (red on
// 9.19.x), and `servableSnapshot` serves that very object, by identity.

describe('flowchartAsTool({ redact }) — closed by footprintjs 9.20.0: a subflow is served as its own mirror, and the tool serves that object', () => {
  const policy = { keys: ['innerKey'] };

  async function ranExecutor(): Promise<FlowChartExecutor> {
    const executor = new FlowChartExecutor(chartWithSubflow());
    executor.setRedactionPolicy(policy);
    await executor.run({ input: {} });
    return executor;
  }

  it('`getSnapshot({ redact: true }).subflowResults[*].treeContext.globalContext` holds the placeholder — one object under both keys (red on 9.19.x)', async () => {
    const executor = await ranExecutor();

    const served = executor.getSnapshot({ redact: true })
      .subflowResults as KeptSnapshot['subflowResults'];
    const entries = Object.values(served!);
    expect(entries.length).toBe(2); // the path key and its `#n` twin
    for (const entry of entries) {
      // The substrate's own view: the subflow's mirror, not its heap…
      expect(entry.treeContext.globalContext).toEqual({ innerKey: 'REDACTED', derived: 'ok' });
      // …and the log beside it, scrubbed at write time, folds to the same state.
      expect(JSON.stringify(entry.treeContext.history)).not.toContain(SECRET);
    }
    expect(entries[0]).toBe(entries[1]);
    expect(JSON.stringify(served)).not.toContain(SECRET);

    // The other half of the law, unchanged: the plain snapshot is the live heap.
    const plain = executor.getSnapshot().subflowResults as KeptSnapshot['subflowResults'];
    for (const entry of Object.values(plain!)) {
      expect(entry.treeContext.globalContext.innerKey).toBe(SECRET);
    }
  });

  it('`servableSnapshot` under a policy IS `getSnapshot({ redact: true })` — the same object, not a refold', async () => {
    const executor = await ranExecutor();

    const getSnapshot = vi.spyOn(executor, 'getSnapshot');
    const served = servableSnapshot(executor, policy);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(getSnapshot).toHaveBeenCalledWith({ redact: true });
    expect(served).toBe(getSnapshot.mock.results[0]!.value);
    getSnapshot.mockRestore();

    // Clean through the substrate alone — nothing here rewrote it.
    expect(JSON.stringify(served)).not.toContain(SECRET);
    const entries = Object.values(
      served.subflowResults as NonNullable<KeptSnapshot['subflowResults']>,
    );
    expect(entries.length).toBe(2);
    expect(entries[0]!.treeContext.globalContext).toEqual({ innerKey: 'REDACTED', derived: 'ok' });
  });
});
