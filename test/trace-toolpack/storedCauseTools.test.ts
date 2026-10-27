import type { RuntimeSnapshot } from 'footprintjs';
import type { CauseGraph } from 'foottrace/cause';
import { describe, expect, it } from 'vitest';
import * as causeTools from '../../src/trace-toolpack/causeTools.js';
import { callTraceTool, traceToolpack } from '../../src/trace-toolpack/traceToolpack.js';
import type {
  TraceCauseArtifacts,
  TraceCauseOptions,
} from '../../src/trace-toolpack/causeTypes.js';
import type { Tool } from '../../src/tools/tools.js';
import { readStoredCauseArtifacts } from '../../src/trace-toolpack/storedCause.js';
import { storedCauseFixture } from './storedCauseFixtures.js';

const operations = ['attention_list', 'root_cause', 'impact'] as const;
const PRIVATE = 'PRIVATE-STORED-PROOF-DO-NOT-REPEAT';
const snapshot = {
  runId: 'graph-serving',
  commitLog: [],
  executionTree: undefined,
  sharedState: {},
} as unknown as RuntimeSnapshot;

function serving(cause: TraceCauseArtifacts, options?: TraceCauseOptions): Tool[] {
  return (
    causeTools as unknown as {
      traceCauseTools: (cause: TraceCauseArtifacts, options?: TraceCauseOptions) => Tool[];
    }
  ).traceCauseTools(cause, options);
}

function fixture() {
  let calls = 0;
  const edge = (nodeId: string) => ({
    nodeId,
    kind: 'data' as const,
    attribution: 'per-write' as const,
    evidence: ['proof:edge'],
  });
  const graph: CauseGraph = {
    parents(id) {
      calls++;
      return { edges: id === 'symptom' ? [edge('root')] : [], complete: true };
    },
    children(id) {
      calls++;
      return { edges: id === 'symptom' ? [edge('affected')] : [], complete: true };
    },
    attention(id) {
      calls++;
      return id === 'root'
        ? [{ kind: 'timeout', reason: 'TIMEOUT_RECORDED', evidence: ['proof:attempt'] }]
        : [];
    },
    gaps() {
      calls++;
      return [];
    },
    roots() {
      calls++;
      return ['symptom'];
    },
  };
  return { graph, cause: { graph }, calls: () => calls };
}

describe('graph-only cause serving', () => {
  it('mounts exactly the existing three operations without a snapshot', () => {
    expect(serving(fixture().cause).map((tool) => tool.schema.name)).toEqual(operations);
  });

  it('uses exactly the existing schemas and descriptions', () => {
    const { cause } = fixture();
    const full = traceToolpack({ snapshot, cause }).filter((tool) =>
      operations.includes(tool.schema.name as never),
    );
    expect(serving(cause).map((tool) => tool.schema)).toEqual(full.map((tool) => tool.schema));
  });

  it.each(operations)(
    '%s retains byte-identical plain custom graph responses',
    async (operation) => {
      const { cause } = fixture();
      const question =
        operation === 'attention_list' ? { nodeIds: ['root'] } : { nodeId: 'symptom' };
      expect(await callTraceTool(serving(cause), operation, question)).toBe(
        await callTraceTool(traceToolpack({ snapshot, cause }), operation, question),
      );
    },
  );

  it('does not touch unrelated snapshot metadata', async () => {
    const { cause } = fixture();
    Object.defineProperty(cause, 'snapshot', {
      get() {
        throw new Error(PRIVATE);
      },
    });
    const text = await callTraceTool(serving(cause), 'root_cause', { nodeId: 'symptom' });
    expect(JSON.parse(text).finding.rootCause).toBe('root');
    expect(text).not.toContain(PRIVATE);
  });

  it.each(operations)(
    '%s refuses a public admission claim before any graph call',
    async (operation) => {
      const { graph, calls } = fixture();
      const cause = { graph, admission: { native: { status: 'admitted' }, secret: PRIVATE } };
      const text = await callTraceTool(
        serving(cause),
        operation,
        operation === 'attention_list' ? {} : { nodeId: 'symptom' },
      );
      expect(calls()).toBe(0);
      expect(JSON.parse(text).gaps).toEqual([{ code: 'invalid-data', evidence: [] }]);
      expect(text).not.toContain(PRIVATE);
      expect(text).not.toContain('admission');
    },
  );

  it('refuses an admission accessor without invoking it', async () => {
    const { graph, calls } = fixture();
    let accessed = 0;
    const cause = Object.defineProperty({ graph }, 'admission', {
      get() {
        accessed++;
        throw new Error(PRIVATE);
      },
    });
    const text = await callTraceTool(serving(cause), 'root_cause', { nodeId: 'symptom' });
    expect(accessed).toBe(0);
    expect(calls()).toBe(0);
    expect(JSON.parse(text).gaps[0].code).toBe('invalid-data');
    expect(text).not.toContain(PRIVATE);
  });

  it('refuses a stored claim in the full toolpack before snapshot indexing', () => {
    const { graph, calls } = fixture();
    let snapshots = 0;
    const bag = Object.defineProperty({ cause: { graph, admission: {} } }, 'snapshot', {
      get() {
        snapshots++;
        throw new Error(PRIVATE);
      },
    });
    expect(() => traceToolpack(bag as never)).toThrow(
      'Stored capture evidence requires traceCauseTools.',
    );
    expect(snapshots).toBe(0);
    expect(calls()).toBe(0);
  });

  it('refuses a raw saved-claim object before trying to treat it as a snapshot bag', () => {
    const { graph, calls } = fixture();
    let accessed = 0;
    const cause = Object.defineProperty({ graph, admission: {} }, 'snapshot', {
      get() {
        accessed++;
        throw Error(PRIVATE);
      },
    });
    expect(() => traceToolpack(cause as never)).toThrow(
      'Stored capture evidence requires traceCauseTools.',
    );
    expect(accessed).toBe(0);
    expect(calls()).toBe(0);
  });

  it.each(['inherited', 'accessor'])(
    'refuses a %s cause slot without invoking its code or indexing',
    (kind) => {
      const { graph, calls } = fixture();
      let accessed = 0;
      const claim = { graph, admission: {} };
      const bag =
        kind === 'inherited'
          ? Object.create({ cause: claim })
          : Object.defineProperty({}, 'cause', {
              get() {
                accessed++;
                return claim;
              },
            });
      Object.defineProperty(bag, 'snapshot', {
        get() {
          accessed++;
          throw Error(PRIVATE);
        },
      });
      expect(() => traceToolpack(bag)).toThrow('Stored capture evidence requires traceCauseTools.');
      expect(accessed).toBe(0);
      expect(calls()).toBe(0);
    },
  );

  it('keeps host query ceilings in graph-only mode', async () => {
    const { cause, calls } = fixture();
    const result = JSON.parse(
      await callTraceTool(serving(cause, { maxCalls: 1 }), 'root_cause', { nodeId: 'symptom' }),
    );
    expect(calls()).toBeLessThanOrEqual(1);
    expect(result.finding.rootCause).toBeUndefined();
    expect(result.finding.confidence).toBe('incomplete');
  });

  it('cancellation is checked before graph-only reads', async () => {
    const { cause, calls } = fixture();
    const controller = new AbortController();
    controller.abort(PRIVATE);
    const tool = serving(cause).find((candidate) => candidate.schema.name === 'root_cause')!;
    const text = String(
      await tool.execute({ nodeId: 'symptom' }, { signal: controller.signal } as never),
    );
    expect(calls()).toBe(0);
    expect(JSON.parse(text).gaps[0].code).toBe('cancelled');
    expect(text).not.toContain(PRIVATE);
  });

  it('invalid host controls never reach a graph', async () => {
    const { cause, calls } = fixture();
    const text = await callTraceTool(serving(cause, { maxCalls: 0 }), 'root_cause', {
      nodeId: 'symptom',
    });
    expect(calls()).toBe(0);
    expect(JSON.parse(text).gaps[0].code).toBe('invalid-data');
  });

  it('discloses native capture and saved-byte acknowledgement separately', async () => {
    const fixture = await storedCauseFixture();
    const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    if (result.status !== 'ready') throw Error(`Fixture refused: ${result.reason}`);
    const text = await callTraceTool(serving(result.cause), 'attention_list');
    const response = JSON.parse(text);
    expect(response.capture.persistence).toBe('memory-only');
    expect(response.capture.readSources).toBe('not-collected');
    expect(response.storage).toEqual({ status: 'adapter-acknowledged-history', scope: 'root-log' });
    expect(response).not.toHaveProperty('admission');
    expect(response.interpretation).toContain('not producer authentication');
    expect(response.interpretation).toContain('whole-workflow delivery');
  });

  it.each([512, 600, 800])(
    'withholds saved proof and assessment within a %i-character ceiling',
    async (maxChars) => {
      const fixture = await storedCauseFixture();
      const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
      if (result.status !== 'ready') throw Error(`Fixture refused: ${result.reason}`);
      const text = await callTraceTool(serving(result.cause, { maxChars }), 'attention_list');
      expect(text.length).toBeLessThanOrEqual(maxChars);
      const response = JSON.parse(text);
      expect(response.finding).toBeUndefined();
      expect(response.confidence).toBe('incomplete');
      expect(response.gaps).toEqual([{ code: 'truncated', evidence: [] }]);
      expect(response.interpretation).toContain('memory-only');
      expect(response.interpretation).toContain('root-history bytes');
    },
  );
});
