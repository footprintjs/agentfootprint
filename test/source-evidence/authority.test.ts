import { describe, expect, it, vi } from 'vitest';
import { inspect } from 'node:util';
import type { TypedScope } from 'footprintjs';
import { inMemoryArtifacts } from '../../src/artifacts/inMemoryArtifacts.js';
import { bindArtifacts } from '../../src/artifacts/capability.js';
import { defineTool, type ToolExecutionContext } from '../../src/tools/tools.js';
import {
  resolveSourceEvidenceOptions,
  withSourceEvidence,
} from '../../src/tools/sourceEvidence.js';
import { createSourceEvidenceAccess } from '../../src/core/agent/sourceEvidence/access.js';
import {
  permitSourceEvidence,
  SourceEvidencePolicyHalt,
} from '../../src/core/agent/sourceEvidence/permissions.js';
import type { AgentState } from '../../src/core/agent/types.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceProjection,
  SourceEvidenceLimits,
} from '../../src/artifacts/sourceEvidence/types.js';
import type { PermissionChecker, PermissionDecision } from '../../src/provider-contract/types.js';

const identity = { principal: 'source-reader', conversationId: 'source-authority' };
const subject = { kind: 'array', value: 'array-01' };
const query = { subject, operation: 'inventory', scope: { groupBy: 'application' } };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const without = (value: SourceEvidenceCandidate, key: 'period' | 'coverage') => {
  const result = clone(value);
  delete (result as { period?: unknown; coverage?: unknown })[key];
  return result;
};

async function fixture(
  settings: {
    limits?: SourceEvidenceLimits;
    subjects?: readonly string[];
    note?: string;
    admit?: (
      candidate: SourceEvidenceCandidate,
    ) => SourceEvidenceProjection | undefined | Promise<SourceEvidenceProjection | undefined>;
    checker?: PermissionChecker;
  } = {},
) {
  const artifacts = bindArtifacts(inMemoryArtifacts(), identity);
  const originalGet = artifacts.get;
  const get = vi.spyOn(artifacts, 'get');
  const dataset = await artifacts.put({
    kind: 'dataset/rows',
    mediaType: 'application/json',
    digest: 'sha-256',
    data: [
      { application: 'app-01', secret: 'PRIVATE-CELL' },
      { application: 'app-02', secret: 'PRIVATE-CELL' },
    ],
  });
  const refs: string[] = [];
  for (const value of settings.subjects ?? [subject.value]) {
    const receipt = await artifacts.put({
      kind: 'evidence/source',
      mediaType: 'application/json',
      digest: 'sha-256',
      data: {
        subject: { ...subject, value },
        operation: query.operation,
        scope: query.scope,
        producer: { name: 'inventory' },
        status: 'partial',
        coverage: {
          checked: [{ what: 'Retained rows' }],
          notChecked: [{ what: 'Uncollected hosts' }],
          cannotCover: [],
        },
        period: {
          queried: { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' },
          held: 'unknown',
        },
        scalars: { count: 2, note: settings.note ?? 'source-note' },
        datasets: [
          {
            key: 'applications',
            ref: dataset.ref,
            kind: dataset.kind,
            digest: dataset.digest,
            fields: { application: ['application'], secret: ['secret'] },
          },
        ],
      },
    });
    refs.push(receipt.ref);
  }
  const index = { version: 1 as const, refs, omitted: 0 };
  let current = withSourceEvidence(
    defineTool({
      name: 'inventory',
      description: 'Authored source',
      capabilities: ['user_data'],
      inputSchema: { type: 'object' },
      execute: async () => ({}),
    }),
    { describe: () => [] },
  );
  const scope = { $emit: vi.fn() } as unknown as TypedScope<AgentState>;
  const context = {
    artifacts,
    hasArtifacts: true,
    identity,
    iteration: 1,
    toolCallId: 'reader-call',
  } as ToolExecutionContext;
  const admit = vi.fn(settings.admit ?? ((candidate: SourceEvidenceCandidate) => candidate));
  const access = createSourceEvidenceAccess({
    artifacts,
    options: resolveSourceEvidenceOptions({ admit, limits: settings.limits }),
    index: () => index,
    currentProducer: () => current,
    active: () => true,
    permit: (candidate, ctx) =>
      current === undefined
        ? Promise.resolve(false)
        : permitSourceEvidence(
            scope,
            settings.checker,
            current,
            candidate,
            ctx,
            'read_source_evidence',
          ),
  });
  return {
    artifacts,
    originalGet,
    dataset,
    refs,
    index,
    context,
    access,
    admit,
    get,
    scope,
    withdrawProducer() {
      current = undefined as never;
    },
  };
}

describe('retained source authority', () => {
  it('withholds dataset data if the receipt disappears during that dataset read', async () => {
    const f = await fixture();
    const get = f.originalGet;
    f.get.mockImplementation(async (ref) => {
      const loaded = await get(ref);
      if (ref === f.dataset.ref) await f.artifacts.delete(f.refs[0]);
      return loaded;
    });
    expect(await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)).toEqual({
      historical: true,
      unavailable: true,
    });
  });
  it('re-admits and serves only tightened fields while preserving native limitations', async () => {
    const f = await fixture({
      admit(candidate) {
        return {
          ...candidate,
          scalars: { count: candidate.scalars!.count },
          datasets: candidate.datasets!.map((dataset) => ({
            ...dataset,
            fields: { application: ['application'] },
          })),
        };
      },
    });
    const found = (await f.access.find(query, f.context)) as {
      candidates: SourceEvidenceCandidate[];
    };
    expect(found.candidates).toHaveLength(1);
    expect(found.candidates[0].scalars).toEqual({ count: 2 });
    const read = (await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)) as {
      receipt: SourceEvidenceCandidate;
      detail: { value: unknown[]; complete: boolean };
    };
    expect(read.detail.value).toEqual([{ application: 'app-01' }, { application: 'app-02' }]);
    expect(read.detail.complete).toBe(true);
    expect(read.receipt.status).toBe('partial');
    expect(read.receipt.period?.held).toBe('unknown');
    expect(read.receipt.coverage?.notChecked).toEqual([{ what: 'Uncollected hosts' }]);
    expect(JSON.stringify(read)).not.toContain('PRIVATE-CELL');
    expect(f.admit).toHaveBeenCalledTimes(2);
  });

  it.each([
    [
      'changed subject',
      (c: SourceEvidenceCandidate) => ({ ...c, subject: { ...c.subject, value: 'array-99' } }),
    ],
    ['changed scope', (c: SourceEvidenceCandidate) => ({ ...c, scope: { groupBy: 'host' } })],
    ['promoted status', (c: SourceEvidenceCandidate) => ({ ...c, status: 'success' as const })],
    ['erased coverage', (c: SourceEvidenceCandidate) => without(c, 'coverage')],
    ['erased period', (c: SourceEvidenceCandidate) => without(c, 'period')],
    [
      'invented scalar',
      (c: SourceEvidenceCandidate) => ({ ...c, scalars: { invented: 'not-from-source' } }),
    ],
    ['changed scalar', (c: SourceEvidenceCandidate) => ({ ...c, scalars: { count: 99 } })],
    [
      'expanded fields',
      (c: SourceEvidenceCandidate) => ({
        ...c,
        datasets: c.datasets!.map((d) => ({ ...d, fields: { injected: ['new-private-field'] } })),
      }),
    ],
    [
      'invented dataset metadata',
      (c: SourceEvidenceCandidate) => ({
        ...c,
        datasets: c.datasets!.map((d) => ({ ...d, extra: 'PRIVATE-INVENTED-DATA' })),
      }),
    ],
    [
      'duplicated dataset authority',
      (c: SourceEvidenceCandidate) => ({ ...c, datasets: [c.datasets![0], c.datasets![0]] }),
    ],
    [
      'removed field restrictions',
      (c: SourceEvidenceCandidate) => ({
        ...c,
        datasets: c.datasets!.map((d) => {
          const dataset = clone(d);
          delete (dataset as { fields?: unknown }).fields;
          return dataset;
        }),
      }),
    ],
  ])('refuses %s without hydrating source values', async (_name, change) => {
    const f = await fixture({ admit: change });
    expect(await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)).toEqual({
      historical: true,
      unavailable: true,
    });
    expect(f.get.mock.calls.some(([ref]) => ref === f.dataset.ref)).toBe(false);
  });

  it('accepts native gate_open on current tool and governed capability checks', async () => {
    const check = vi.fn<PermissionChecker['check']>(() => ({ result: 'gate_open' as const }));
    const f = await fixture({
      checker: { name: 'current-permissions', governs: ['user_data'], check },
    });
    const read = (await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)) as {
      detail?: unknown;
    };
    expect(read.detail).toBeDefined();
    expect(check.mock.calls.map(([request]) => request.capability)).toEqual([
      'tool_call',
      'user_data',
    ]);
    expect(
      check.mock.calls.every(
        ([request]) => request.target === 'inventory' && request.identity === identity,
      ),
    ).toBe(true);
  });

  it('rechecks revocation after discovery before reading a source dataset', async () => {
    let permitted: PermissionDecision['result'] = 'allow';
    const check = vi.fn(() => ({ result: permitted }));
    const f = await fixture({ checker: { name: 'revocable', check } });
    const first = (await f.access.find(query, f.context)) as { candidates: unknown[] };
    expect(first.candidates).toHaveLength(1);
    permitted = 'deny';
    expect(await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)).toEqual({
      historical: true,
      unavailable: true,
    });
    expect(f.get.mock.calls.some(([ref]) => ref === f.dataset.ref)).toBe(false);
    expect(f.admit).toHaveBeenCalledTimes(1);
  });

  it('propagates a native halt and records the normal halt owner fields', async () => {
    const f = await fixture({
      checker: {
        name: 'halt-current-source',
        check: () => ({ result: 'halt', reason: 'revoked', tellLLM: 'Source access stopped.' }),
      },
    });
    await expect(
      f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context),
    ).rejects.toBeInstanceOf(SourceEvidencePolicyHalt);
    expect(f.scope.policyHaltReason).toBe('revoked');
    expect(f.scope.policyHaltTarget).toBe('read_source_evidence');
    expect(f.get.mock.calls.some(([ref]) => ref === f.dataset.ref)).toBe(false);
  });

  it('rechecks producer visibility and host admission after discovery', async () => {
    let admitted = true;
    const f = await fixture({ admit: (candidate) => (admitted ? candidate : undefined) });
    expect(
      ((await f.access.find(query, f.context)) as { candidates: unknown[] }).candidates,
    ).toHaveLength(1);
    admitted = false;
    expect(await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)).toEqual({
      historical: true,
      unavailable: true,
    });
    admitted = true;
    f.withdrawProducer();
    expect(await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context)).toEqual({
      historical: true,
      unavailable: true,
    });
    expect(f.get.mock.calls.some(([ref]) => ref === f.dataset.ref)).toBe(false);
  });

  it('cannot discover an ordinary same-kind artifact outside the native admitted index', async () => {
    const f = await fixture();
    const ordinary = await f.artifacts.put({
      kind: 'evidence/source',
      mediaType: 'application/json',
      data: {},
    });
    expect(await f.access.read({ ref: ordinary.ref }, f.context)).toEqual({
      historical: true,
      unavailable: true,
    });
    expect(f.get.mock.calls.some(([ref]) => ref === ordinary.ref)).toBe(false);
  });

  it('does not skip a retained candidate when a byte-limited discovery page fills', async () => {
    const f = await fixture({
      subjects: [subject.value, subject.value, subject.value, subject.value],
      note: 'n'.repeat(800),
      limits: { maxResponseBytes: 2200 },
    });
    const found: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (; pages < 8; pages++) {
      const page = (await f.access.find({ ...query, ...(cursor && { cursor }) }, f.context)) as {
        candidates: SourceEvidenceCandidate[];
        complete: boolean;
        nextCursor?: string;
      };
      expect(page.candidates).toBeDefined();
      found.push(...page.candidates.map((candidate) => candidate.ref));
      if (page.complete) break;
      expect(page.nextCursor).toBeDefined();
      expect(page.nextCursor).not.toBe(cursor);
      cursor = page.nextCursor;
    }
    expect(pages).toBeGreaterThan(0);
    expect(found).toEqual(f.refs);
    expect(new Set(found).size).toBe(f.refs.length);
  });

  it('provides a progressing cursor when a bounded scan finds no matching subject yet', async () => {
    const f = await fixture({
      subjects: ['unrelated-array', subject.value],
      limits: { maxScanned: 1 },
    });
    const first = (await f.access.find(query, f.context)) as {
      candidates: unknown[];
      complete: boolean;
      nextCursor?: string;
    };
    expect(first.candidates).toEqual([]);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).toBeDefined();
    const next = (await f.access.find({ ...query, cursor: first.nextCursor }, f.context)) as {
      candidates: SourceEvidenceCandidate[];
    };
    expect(next.candidates.map((candidate) => candidate.ref)).toEqual([f.refs[1]]);
  });

  it('continues the original page without skipping or repeating older receipts after a new insertion', async () => {
    const f = await fixture({
      subjects: [subject.value, subject.value, subject.value],
      note: 'n'.repeat(800),
      limits: { maxResponseBytes: 2200 },
    });
    const original = [...f.refs];
    const first = (await f.access.find(query, f.context)) as {
      candidates: SourceEvidenceCandidate[];
      nextCursor: string;
    };
    expect(first.nextCursor).toBeDefined();
    const recorded = await f.artifacts.get(original[0]);
    const newer = await f.artifacts.put({
      kind: 'evidence/source',
      mediaType: 'application/json',
      digest: 'sha-256',
      data: recorded!.data,
    });
    f.index.refs.unshift(newer.ref);
    const found = first.candidates.map((candidate) => candidate.ref);
    let cursor = first.nextCursor;
    for (let pages = 0; pages < 8; pages++) {
      const page = (await f.access.find({ ...query, cursor }, f.context)) as {
        candidates: SourceEvidenceCandidate[];
        complete: boolean;
        nextCursor: string;
      };
      expect(page.candidates).toBeDefined();
      found.push(...page.candidates.map((candidate) => candidate.ref));
      if (page.complete) break;
      expect(page.nextCursor).not.toBe(cursor);
      cursor = page.nextCursor;
    }
    expect(found).toEqual(original);
    expect(found).not.toContain(newer.ref);
  });

  it('keeps a host admission failure out of served data and native error logging', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const f = await fixture({
        admit() {
          throw new Error('PRIVATE-CALLBACK-DETAIL');
        },
      });
      const result = await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context);
      expect(result).toEqual({ historical: true, unavailable: true });
      expect(inspect(error.mock.calls, { depth: 8 })).not.toContain('PRIVATE-CALLBACK-DETAIL');
      expect(f.get.mock.calls.some(([ref]) => ref === f.dataset.ref)).toBe(false);
    } finally {
      error.mockRestore();
    }
  });

  it('does not serve a receipt or dataset that disappeared while asynchronous admission was pending', async () => {
    const f = await fixture({
      async admit(candidate) {
        await remove(candidate.ref);
        return candidate;
      },
    });
    const remove = (ref: string) => f.artifacts.delete(ref);
    const result = await f.access.read({ ref: f.refs[0], dataset: 'applications' }, f.context);
    expect(result).toEqual({ historical: true, unavailable: true });
    expect(f.get.mock.calls.some(([ref]) => ref === f.dataset.ref)).toBe(false);
  });
});
