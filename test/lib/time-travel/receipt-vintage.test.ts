/**
 * THE VINTAGE LAW — a reader reads the receipt it is handed; a missing
 * container is a fact about the vintage, never a throw (9.94.1).
 *
 * A recording is older than the reader that opens it. `Receipt` is what a
 * MINT writes, and every mint since 9.88.0 has written every container it knew
 * about — but what a mint knew about has grown (`cache.strategy` arrived in
 * 9.93.0), and a receipt a consumer already holds was written by the release
 * that wrote it, not by this one. The narrowing that admits a stored value
 * (`servedView.ts` · `readReceipt`) checks the basis and nothing past it, so
 * every container past the basis is what that vintage wrote, and a reader that
 * dereferences one without looking is a reader that throws on an older
 * recording.
 *
 * That is what 9.93.0 shipped: `viewOf` read `receipt.cache.strategy` straight
 * off the admitted value, so a stored receipt with a `basis` and no `cache`
 * made `servedAt` throw `Cannot read properties of undefined (reading
 * 'strategy')` where 9.92 built a view — found by the lens the day after, on a
 * recording it already held. A Lens may omit, never deny; a reader never throws
 * on a stored recording — it names what it could not read.
 *
 * Every recording here is a REAL run, JSON-detached and then aged: containers
 * are DELETED from the committed receipts, never rewritten, so what is left is
 * exactly what an older mint left. Three vintages:
 *
 *   · no `cache` at all, no `omittedForAttention` — the shape the lens hit;
 *   · `cache` without `strategy` — the 9.88.0–9.92.1 mint, byte for byte;
 *   · `cache.strategy: null` — the 9.93.0 mint on a chart with no strategy.
 *
 * Test types (Convention 3): regression (the throw) / functional (the view,
 * the gap, the hash law on an aged receipt) / edge (the batch reader, the
 * record left untouched) / integration (every run is real).
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  LLMCall,
  messageDigestInput,
  receiptAt,
  receiptHash,
  servedAt,
  servedViews,
  toolDigestInput,
  type Receipt,
  type StoredReceipt,
} from '../../../src/index.js';
import type { LLMRequest, LLMResponse } from '../../../src/adapters/types.js';

// ─── the harness ─────────────────────────────────────────────────────

type Reply = { content: string; toolCalls?: { id: string; name: string; args: object }[] };
type Snapshot = NonNullable<ReturnType<Agent['getSnapshot']>>;

/** A provider that answers from a script. */
function scripted(script: readonly Reply[]) {
  let i = 0;
  return {
    name: 'vintage-mock',
    complete: async (_req: LLMRequest): Promise<LLMResponse> => {
      const reply = script[Math.min(i, script.length - 1)] ?? { content: 'done' };
      i += 1;
      return {
        content: reply.content,
        toolCalls: reply.toolCalls ?? [],
        usage: { input: 0, output: 0 },
      };
    },
  };
}

const tool = (name: string) =>
  defineTool({ name, description: `the ${name} tool`, execute: () => `${name} result` });

async function agentRun(): Promise<Snapshot> {
  const agent = Agent.create({
    provider: scripted([
      { content: '', toolCalls: [{ id: 'c1', name: 'alpha_tool', args: {} }] },
      { content: 'done' },
    ]) as never,
    model: 'mock',
    maxIterations: 4,
  })
    .system('you are a bot')
    .tool(tool('alpha_tool'))
    .build();
  await agent.run({ message: 'go' });
  return agent.getSnapshot()!;
}

async function llmCallRun(): Promise<Snapshot> {
  const call = LLMCall.create({ provider: scripted([{ content: 'done' }]) as never, model: 'mock' })
    .system('you are a probe')
    .build();
  await call.run({ message: 'the one turn that went out' });
  return call.getSnapshot()! as unknown as Snapshot;
}

type Bundle = { overwrite: Record<string, unknown> };
type Log = { commitLog?: Bundle[]; history?: Bundle[] };
type Recording = Snapshot & { subflowResults?: Record<string, { treeContext?: Log }> };

/** Every committed receipt in a recording — the run's own log and every
 *  subflow subtree's (`LLMCall` mints inside its subflow). */
function committedReceipts(recording: Recording): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (log: Log | undefined): void => {
    for (const bundle of [...(log?.commitLog ?? []), ...(log?.history ?? [])]) {
      const receipt = bundle.overwrite.receipt;
      if (receipt !== null && typeof receipt === 'object')
        out.push(receipt as Record<string, unknown>);
    }
  };
  walk(recording as Log);
  for (const entry of Object.values(recording.subflowResults ?? {})) walk(entry?.treeContext);
  return out;
}

/**
 * A detached copy of a recording whose every committed receipt has been AGED:
 * the named paths are deleted (`'cache'`, `'cache.strategy'`, …). Deletion,
 * never rewriting — what remains is what an older mint left.
 */
function aged(snapshot: Snapshot, paths: readonly string[]): Recording {
  const copy = JSON.parse(JSON.stringify(snapshot)) as Recording;
  const receipts = committedReceipts(copy);
  expect(receipts.length).toBeGreaterThan(0);
  for (const receipt of receipts) {
    for (const path of paths) {
      const [head, tail] = path.split('.') as [string, string | undefined];
      if (tail === undefined) delete receipt[head];
      else {
        const container = receipt[head];
        if (container !== null && typeof container === 'object') {
          delete (container as Record<string, unknown>)[tail];
        }
      }
    }
  }
  return copy;
}

const kinds = (snapshot: Snapshot, epoch: number): string[] =>
  servedAt(snapshot, epoch)!.gaps.map((g) => g.gap);

/** The hash law, on a receipt of any vintage: every row the aged receipt
 *  still carries verifies against the rebuilt view. */
function everyRowVerifies(snapshot: Snapshot, epoch: number): void {
  const receipt = receiptAt(snapshot, epoch)!;
  const view = servedAt(snapshot, epoch)!;
  const hash = (content: string): string => receiptHash(receipt.basis.runId, content);
  expect(hash(view.system.text)).toBe(receipt.system.hash);
  expect(receipt.system.chars).toBe(view.system.text.length);
  expect(view.messages.asSent.map((m) => hash(messageDigestInput(m)))).toEqual(
    receipt.messages.entries.map((e) => e.hash),
  );
  for (const schema of view.tools.schemas) {
    expect(hash(toolDigestInput(schema))).toBe(receipt.tools.schemaHashes[schema.name]);
  }
  expect(view.basis).toEqual({
    model: receipt.basis.model,
    provider: receipt.basis.provider,
    runId: receipt.basis.runId,
  });
}

// ─── (a) REGRESSION — the vintage the lens hit ────────────────────────

describe('a 9.88-shaped receipt: basis, system, messages, tools — no cache, no omittedForAttention', () => {
  it('servedAt returns a view instead of throwing', async () => {
    const older = aged(await agentRun(), ['cache', 'omittedForAttention']);
    // The stored value really is that shape — the aging is not a no-op.
    for (const receipt of committedReceipts(older)) {
      expect('cache' in receipt).toBe(false);
      expect('basis' in receipt).toBe(true);
    }
    expect(() => servedAt(older, 1)).not.toThrow();
    expect(servedAt(older, 1)).toBeDefined();
    expect(servedAt(older, 2)).toBeDefined();
  });

  it('the cache-transform gap IS raised — absence still raises; only a receipt saying null lifts it', async () => {
    const older = aged(await agentRun(), ['cache', 'omittedForAttention']);
    expect(kinds(older, 1)).toContain('cache-transform');
    // The receipt is there, so the receipt-side caveat is there too and the
    // no-receipt gap is not.
    expect(kinds(older, 1)).toContain('provider-defaults');
    expect(kinds(older, 1)).not.toContain('no-receipt-on-chart');
  });

  it('every hash row still verifies', async () => {
    const older = aged(await agentRun(), ['cache', 'omittedForAttention']);
    everyRowVerifies(older, 1);
    everyRowVerifies(older, 2);
  });

  it('receiptAt returns it — as stored, cache absent, nothing fabricated', async () => {
    const older = aged(await agentRun(), ['cache', 'omittedForAttention']);
    const receipt: StoredReceipt | undefined = receiptAt(older, 1);
    expect(receipt).toBeDefined();
    expect('cache' in receipt!).toBe(false);
    expect(receipt!.cache).toBeUndefined();
    expect(receipt!.omittedForAttention).toBeUndefined();
    expect(typeof receipt!.basis.epoch).toBe('number');
    // Byte-equal to what the record holds: the reader hands back the stored
    // value, not a repaired one.
    const stored = committedReceipts(older).find((r) => (r.basis as { epoch: number }).epoch === 1);
    expect(JSON.parse(JSON.stringify(receipt))).toEqual(stored);
  });

  it('the view is the SAME view a 9.94 receipt yields on this chart — the rebuild never read past the basis', async () => {
    const fresh = await agentRun();
    const older = aged(fresh, ['cache', 'omittedForAttention']);
    // An agent runs the built-in pass-through strategy (`'*'`), so the fresh
    // view raises `cache-transform` too; with the strategy unreadable the aged
    // view raises it for the other reason. Same gaps, same everything.
    expect(JSON.parse(JSON.stringify(servedAt(older, 1)))).toEqual(
      JSON.parse(JSON.stringify(servedAt(fresh, 1))),
    );
    expect(JSON.parse(JSON.stringify(servedViews(older)))).toEqual(
      JSON.parse(JSON.stringify(servedViews(fresh))),
    );
  });

  it('the batch reader walks every epoch of the aged recording', async () => {
    const fresh = await agentRun();
    const older = aged(fresh, ['cache', 'omittedForAttention']);
    expect(() => servedViews(older)).not.toThrow();
    expect(servedViews(older).map((v) => v.epoch)).toEqual(servedViews(fresh).map((v) => v.epoch));
  });

  it('reading never touches the record', async () => {
    const older = aged(await agentRun(), ['cache', 'omittedForAttention']);
    const before = JSON.stringify(older);
    servedAt(older, 1);
    servedViews(older);
    receiptAt(older, 1);
    expect(JSON.stringify(older)).toBe(before);
  });
});

// ─── (b) the 9.88.0–9.92.1 mint: cache without strategy ───────────────

describe('a 9.88–9.92 receipt: cache present, no strategy key', () => {
  it('reads as "cannot say" — the gap stays, the view stands, every row verifies', async () => {
    const older = aged(await llmCallRun(), ['cache.strategy']);
    for (const receipt of committedReceipts(older)) {
      const cache = receipt.cache as Record<string, unknown>;
      expect(cache.transform).toBe('unchanged');
      expect('strategy' in cache).toBe(false);
    }
    expect(() => servedAt(older, 1)).not.toThrow();
    expect(kinds(older, 1)).toContain('cache-transform');
    everyRowVerifies(older, 1);
    expect(receiptAt(older, 1)!.cache?.strategy).toBeUndefined();
    expect(receiptAt(older, 1)!.cache?.transform).toBe('unchanged');
  });
});

// ─── (c) the 9.93.0 mint: a receipt that SAYS null ────────────────────

describe('a 9.93-shaped receipt with cache.strategy: null', () => {
  it('lifts the gap — unchanged behaviour', async () => {
    const fresh = await llmCallRun();
    const receipt = receiptAt(fresh, 1) as Receipt;
    expect(receipt.cache.strategy).toBeNull();
    expect(kinds(fresh, 1)).toEqual(['provider-defaults']);
    everyRowVerifies(fresh, 1);
  });

  it('and only that: deleting the container brings the gap back on the same recording', async () => {
    const fresh = await llmCallRun();
    expect(kinds(fresh, 1)).not.toContain('cache-transform');
    expect(kinds(aged(fresh, ['cache.strategy']), 1)).toContain('cache-transform');
    expect(kinds(aged(fresh, ['cache']), 1)).toContain('cache-transform');
  });
});

// ─── (d) the narrowing is still the one refusal ───────────────────────

describe('what the narrowing still refuses', () => {
  it('a value with no basis is not a receipt of any vintage', async () => {
    const damaged = aged(await agentRun(), ['basis']);
    expect(receiptAt(damaged, 1)).toBeUndefined();
    const view = servedAt(damaged, 1)!;
    const gap = view.gaps.find((g) => g.gap === 'no-receipt-on-chart');
    expect(gap?.cause).toBe('receipt-shape-rejected');
  });
});
