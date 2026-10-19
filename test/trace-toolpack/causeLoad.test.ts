import { afterEach, describe, expect, it, vi } from 'vitest';

const delayed = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
afterEach(() => {
  vi.doUnmock('../../src/trace-toolpack/causeReader.js');
  vi.resetModules();
});

describe('independent lazy cause reader deadline/cancellation boundary', () => {
  it('settles a stalled lazy-reader import within the same query timeout', async () => {
    vi.resetModules();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.doMock('../../src/trace-toolpack/causeReader.js', async () => {
      entered();
      await gate;
      return { readCause: async () => '{"lateReaderInvoked":true}' };
    });
    const { buildCauseTools } = await import('../../src/trace-toolpack/causeTools.js');
    const tool = buildCauseTools({ snapshot: {} } as never, new Map(), { timeoutMs: 10 }).find(
      (t) => t.schema.name === 'root_cause',
    )!;
    const pending = tool.execute({ nodeId: 'opaque' }, {} as never);
    try {
      await started;
      const result = await Promise.race([
        pending,
        delayed(80).then(() => 'NOT_SETTLED_AFTER_80MS'),
      ]);
      expect(result).not.toBe('NOT_SETTLED_AFTER_80MS');
      expect(String(result)).toContain('"code":"timeout"');
    } finally {
      release();
      await pending;
    }
  });

  it('settles caller cancellation while the lazy-reader import is stalled', async () => {
    vi.resetModules();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.doMock('../../src/trace-toolpack/causeReader.js', async () => {
      entered();
      await gate;
      return { readCause: async () => '{"lateReaderInvoked":true}' };
    });
    const { buildCauseTools } = await import('../../src/trace-toolpack/causeTools.js');
    const controller = new AbortController();
    const tool = buildCauseTools({ snapshot: {} } as never, new Map()).find(
      (t) => t.schema.name === 'root_cause',
    )!;
    const pending = tool.execute({ nodeId: 'opaque' }, {
      signal: controller.signal,
    } as never);
    try {
      await started;
      controller.abort('SYNTHETIC_PRIVATE_REASON');
      const result = await Promise.race([
        pending,
        delayed(80).then(() => 'NOT_SETTLED_AFTER_80MS'),
      ]);
      expect(result).not.toBe('NOT_SETTLED_AFTER_80MS');
      expect(String(result)).toContain('"code":"cancelled"');
      expect(String(result)).not.toContain('SYNTHETIC_PRIVATE_REASON');
    } finally {
      release();
      await pending;
    }
  });
});
