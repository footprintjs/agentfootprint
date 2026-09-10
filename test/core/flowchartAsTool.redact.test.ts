/**
 * flowchartAsTool({ redact }) — what a tool may SHOW is one rule (9.89.1).
 *
 * The defect (docs/design/2026-09-recorded-not-built.md · entry 6): the
 * policy scrubbed the inner COMMIT LOG, and every other state-bearing thing
 * the tool handed outward — the string the model reads, the kept record's
 * `sharedState`, a subflow's final state — was the run's raw working memory.
 * Two mechanisms that were each correct, never composed.
 *
 * The rule now: with a policy set, everything the tool serves is footprintjs's
 * REDACTED view (`getSnapshot({ redact: true })`), and every subflow's final
 * state is the fold of that subflow's own scrubbed log. Without a policy the
 * raw snapshot is served exactly as before.
 *
 * The strongest assertion is the byte one: serialize the whole thing and grep
 * for the secret. Every block below does that first and reads fields second.
 *
 * Pins:
 *   - reproduction: the result string AND the kept record carry the placeholder
 *   - nested objects and arrays under key-level / pattern redaction
 *   - a subflow's kept state is refolded from its scrubbed history
 *   - error and paused exits keep a redacted record too
 *   - no-option path: raw snapshot, plaintext, fold base present — unchanged
 *   - three substrate limits (footprintjs 9.18.0) pinned so they are on record
 */

import { describe, expect, it } from 'vitest';
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

// ─── 3. SUBFLOWS — the kept state is refolded from the scrubbed log ──

describe('flowchartAsTool({ redact }) — subflow results', () => {
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
    // which footprintjs's redacted view serves RAW (it is the subflow's own
    // isolated heap) — the served view refolds it from the subflow's log.
    const bytes = keptBytes(tool, 'c1');
    expect(bytes).not.toContain(SECRET);

    const results = keptSnapshot(tool, 'c1').subflowResults!;
    expect(Object.keys(results).length).toBeGreaterThan(0);
    for (const entry of Object.values(results)) {
      expect(entry.treeContext.globalContext).toEqual({ innerKey: 'REDACTED', derived: 'ok' });
      // The log it was folded from is the scrubbed one.
      expect(JSON.stringify(entry.treeContext.history)).not.toContain(SECRET);
    }
  });

  it('the same subflow object under both keys (path and mount id) is folded once, identically', async () => {
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

// ─── 6. SUBSTRATE LIMITS — pinned, not hidden (footprintjs 9.18.0) ────
//
// Each of these is a place where the COMMIT LOG itself carries the plaintext,
// so no served view built on the log can scrub it. They are asserted as they
// are so that the day footprintjs closes one, this file says so instead of
// the JSDoc quietly going stale.

describe('flowchartAsTool({ redact }) — what the substrate does not scrub (pinned)', () => {
  it('`fields` dot-path redaction scrubs recorder views only; the log and the served view keep the value', async () => {
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
    // footprintjs `ScopeFacade.setValue`: the field-level scrub is applied to
    // the value handed to RECORDERS; the commit takes the key-level verdict.
    expect(result).toContain(SECRET);
    expect(keptBytes(tool, 'c1')).toContain(SECRET);
  });

  it('a value an outputMapper writes BACK into the parent bypasses the policy (footprintjs SubflowInputMapper · applyOutputMapping)', async () => {
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
    await tool.execute({}, ctxFor('c1'));
    const snapshot = keptSnapshot(tool, 'c1');
    // Inside the subflow the write went through the facade: scrubbed.
    for (const entry of Object.values(snapshot.subflowResults!)) {
      expect(JSON.stringify(entry.treeContext.history)).not.toContain(SECRET);
    }
    // The merge-back wrote through `StageContext` directly: the PARENT log
    // holds the plaintext, and so does the mirror built from it.
    expect(JSON.stringify(snapshot.commitLog)).toContain(SECRET);
  });

  it('a value an inputMapper carries INTO a subflow is its seed commit, unscrubbed (footprintjs SubflowInputMapper · seedSubflowGlobalStore)', async () => {
    const inner = flowChart<{ apiKey: string; seen: string }>(
      'Inside',
      (scope) => {
        scope.seen = typeof scope.apiKey;
      },
      'inside',
    ).build();
    const chart = flowChart<{ apiKey: string; seen?: string }>(
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
    const tool = flowchartAsTool({
      name: 'seeded',
      description: 'd',
      flowchart: chart,
      keepRecord: true,
      redact: { keys: ['apiKey'] },
    });
    const result = (await tool.execute({}, ctxFor('c1'))) as string;
    // The run-level view is clean — the parent's write went through the facade.
    expect(result).not.toContain(SECRET);
    const snapshot = keptSnapshot(tool, 'c1');
    expect(JSON.stringify(snapshot.commitLog)).not.toContain(SECRET);
    // The subflow's `history[0]` is the seed, committed by the runtime, not
    // the facade — and the served view can only be as clean as the log.
    for (const entry of Object.values(snapshot.subflowResults!)) {
      expect(JSON.stringify(entry.treeContext.history[0])).toContain(SECRET);
    }
    // …and the seed has a SECOND surface: the subflow's narrative "Input:" line
    // is generated from the mapped input before any policy sees it
    // (footprintjs SubflowExecutor · narrativeInput = mappedInput), and it is
    // kept in the record's narrative with its rawValue.
    expect(keptBytes(tool, 'c1')).toMatch(/Input: apiKey.{0,12}sk-live-SUPER-SECRET-BYTES/);
  });

  it('a stage that READS a redacted key keeps the plaintext in its tracked reads (footprintjs StageContext · getValue → stageReads)', async () => {
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
          scope.used = scope.apiKey.length; // a tracked READ — the facade clones the value into `_stageReads`
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
    // The served state and the log are clean — the write went through the facade.
    expect(result).not.toContain(SECRET);
    const snapshot = keptSnapshot(tool, 'c1') as unknown as Record<string, unknown>;
    expect(JSON.stringify(snapshot['sharedState'])).not.toContain(SECRET);
    expect(JSON.stringify(snapshot['commitLog'])).not.toContain(SECRET);
    // Read-tracking retention is not one of the substrate's redaction points:
    // the execution tree's `stageReads` carries the value the stage read.
    expect(JSON.stringify(snapshot['executionTree'])).toContain(SECRET);
  });
});
