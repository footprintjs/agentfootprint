/**
 * EQUIVALENCE — one real engine run, saved whole and saved in parts, serves
 * the same content through `openSavedRecording`, on every store.
 *
 * Oracles: the whole recording's own parsed JSON (E1, E2), an independent copy
 * of the lazy viewer's walk (E3, `viewerWalk.ts`), the whole-layout reader
 * against the parts-layout reader (E5), the answer account and the size report
 * computed from the whole (E6, E7), a second split of the same recording (E8),
 * and the same checks over packed parts (E9).
 */
import { describe, expect, it } from 'vitest';

import { bindArtifacts } from '../../../../src/artifacts/capability.js';
import { servedUnderPolicy } from '../../../../src/redaction/marker.js';
import {
  accountForAnswer,
  openSavedRecording,
  recordingSizeReport,
  type Recording,
  type SavedRecording,
} from '../../../../src/observe.js';
import {
  recordingIndexText,
  splitRecording,
} from '../../../../src/recorders/observability/recordingParts/split.js';
import {
  SCOPE,
  STORES,
  executionKeys,
  fileParts,
  fileWhole,
  parsedWhole,
  realRecording,
} from './helpers.js';
import { viewerProjection } from './viewerWalk.js';

const recording = await realRecording();
const whole = parsedWhole(recording);
const wholeResults = (whole.snapshot as { subflowResults: Record<string, unknown> }).subflowResults;

async function ready(promise: Promise<unknown>): Promise<SavedRecording> {
  const opened = (await promise) as SavedRecording | { status: 'unavailable'; reason: string };
  if (opened.status !== 'ready') throw new Error(`not opened: ${opened.reason}`);
  return opened;
}

describe.each(STORES)('a real run saved both ways — $name', (storeCase) => {
  for (const packed of [false, true]) {
    describe(packed ? 'packed parts' : 'plain parts', () => {
      async function both(): Promise<{
        parts: SavedRecording;
        plain: SavedRecording;
        close(): void;
      }> {
        const { store, close } = storeCase.create();
        const filed = await fileParts(store, recording, { packed, targetBytes: 16 * 1024 });
        const wholeRef = await fileWhole(store, recording);
        const artifacts = bindArtifacts(store, SCOPE);
        return {
          parts: await ready(openSavedRecording(artifacts, filed.index)),
          plain: await ready(openSavedRecording(artifacts, wholeRef)),
          close,
        };
      }

      it('E1 · the whole read back from parts equals the whole recording', async () => {
        const { parts, close } = await both();
        try {
          expect(parts.layout).toBe('parts');
          expect(parts.sizes.parts.length).toBeGreaterThan(3);
          const read = await parts.readWhole();
          expect(read.status).toBe('ready');
          if (read.status === 'ready') expect(read.recording).toEqual(whole);
        } finally {
          close();
        }
      });

      it('E2 · every execution key reads its own result, from one part', async () => {
        const { parts, close } = await both();
        try {
          const keys = executionKeys(whole);
          expect(keys.length).toBeGreaterThan(10);
          for (const key of keys) {
            const read = await parts.readInvocation(key);
            expect(read.status, key).toBe('ready');
            if (read.status === 'ready') expect(read.result).toEqual(wholeResults[key]);
          }
        } finally {
          close();
        }
      });

      it('E3 · addresses and the root match the viewer walk over the whole recording', async () => {
        const { parts, close } = await both();
        try {
          const view = viewerProjection(whole);
          const dto = {
            schema: 'agentfootprint-lens.recording-source/v1',
            recording: ((await parts.readRoot()) as { recording: Recording }).recording,
            invocations: parts.invocations.map((invocation) => ({
              invocationPath: [...invocation.path],
              mountRuntimeStageId: invocation.key,
              subflowId: invocation.subflowId,
              ...(parts.snapshotRunId !== undefined && { runId: parts.snapshotRunId }),
            })),
          };
          expect(dto).toEqual(view.root);
          expect(parts.invocations.some((invocation) => invocation.path.length > 1)).toBe(true);
          expect(parts.complete).toBe(true);
          for (const [key, unit] of view.units) {
            const read = await parts.readInvocation(key);
            expect(read.status === 'ready' && read.result).toEqual(unit);
          }
        } finally {
          close();
        }
      });

      it('E5 · the whole layout and the parts layout serve the same values', async () => {
        const { parts, plain, close } = await both();
        try {
          expect(plain.layout).toBe('whole');
          expect(plain.invocations).toEqual(parts.invocations);
          expect([...plain.aliases]).toEqual([...parts.aliases]);
          expect(plain.complete).toBe(parts.complete);
          expect(await plain.readRoot()).toEqual(await parts.readRoot());
          for (const invocation of parts.invocations) {
            expect(await plain.readInvocation(invocation.key)).toEqual(
              await parts.readInvocation(invocation.key),
            );
          }
          expect(await plain.readWhole()).toEqual(await parts.readWhole());
        } finally {
          close();
        }
      });

      it('E6 · the answer account from the base part equals the one from the whole', async () => {
        const { parts, close } = await both();
        try {
          const root = await parts.readRoot();
          if (root.status !== 'ready') throw new Error(root.reason);
          expect(accountForAnswer(root.recording)).toEqual(
            accountForAnswer(whole as unknown as Recording),
          );
        } finally {
          close();
        }
      });

      it('E7 · the base part measures like the whole without its subflow results; sizes add up', async () => {
        const { store, close } = storeCase.create();
        try {
          const filed = await fileParts(store, recording, { packed, targetBytes: 16 * 1024 });
          const artifacts = bindArtifacts(store, SCOPE);
          const parts = await ready(openSavedRecording(artifacts, filed.index));
          const root = await parts.readRoot();
          if (root.status !== 'ready') throw new Error(root.reason);
          const fromBase = recordingSizeReport(root.recording);
          const fromWhole = recordingSizeReport(whole as unknown as Recording);
          expect(fromBase.events).toEqual(fromWhole.events);
          expect(fromBase.structure).toEqual(fromWhole.structure);
          expect(fromBase.snapshot?.subflows).toBeUndefined();
          expect(fromBase.snapshot?.fields).toEqual(
            fromWhole.snapshot?.fields.filter((row) => row.name !== 'subflowResults'),
          );
          let stored = 0;
          for (const ref of [filed.index, filed.base, ...filed.parts]) {
            stored += (await artifacts.head(ref))?.bytes ?? Number.NaN;
          }
          expect(parts.sizes.storedBytes).toBe(stored);
          expect(parts.sizes.artifacts).toBe(filed.parts.length + 2);
          expect(parts.sizes.parts.map((part) => part.results).reduce((a, b) => a + b, 0)).toBe(
            executionKeys(whole).length,
          );
        } finally {
          close();
        }
      });
    });
  }
});

describe('E8 · the cut is deterministic', () => {
  it('two splits of one recording give byte-equal parts, digests and (refs fixed) indexes', async () => {
    for (const packed of [false, true]) {
      const first = await splitRecording(recording, { runId: 'r', packed, targetBytes: 8192 });
      const second = await splitRecording(recording, { runId: 'r', packed, targetBytes: 8192 });
      expect(second.base).toEqual(first.base);
      expect(second.parts).toEqual(first.parts);
      const refs = {
        base: `art_${'A'.repeat(22)}`,
        parts: first.parts.map((_, at) => `art_${String(at).padStart(22, 'B')}`),
      };
      expect(recordingIndexText(second.draft, refs)).toBe(recordingIndexText(first.draft, refs));
    }
  });

  it('two equal runs differ only where the runs themselves differ: the part bytes are a function of the recording', async () => {
    const again = await splitRecording(JSON.parse(JSON.stringify(recording)) as Recording, {
      runId: 'r',
    });
    const once = await splitRecording(recording, { runId: 'r' });
    expect(again.parts.map((part) => part.digest)).toEqual(once.parts.map((part) => part.digest));
  });
});

describe('E9 · packed parts each read alone', () => {
  it('every part of a packed recording opens without any other part', async () => {
    const { store, close } = STORES[0]!.create();
    try {
      const filed = await fileParts(store, recording, { packed: true, targetBytes: 8192 });
      for (const part of filed.split.parts) {
        expect((JSON.parse(part.text) as { format: string }).format).toBe(
          'agentfootprint.recording.packed.v1',
        );
      }
      const parts = await ready(openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
      // Delete every part but one: the remaining one still reads.
      const keep = parts.invocations.find((invocation) => invocation.recorded)!;
      const partOf = JSON.parse(filed.indexText) as {
        invocations: { key: string; part: number }[];
      };
      const keptPart = partOf.invocations.find((row) => row.key === keep.key)!.part;
      for (const [at, ref] of filed.parts.entries())
        if (at !== keptPart) await store.delete(SCOPE, ref);
      await store.delete(SCOPE, filed.base);
      const read = await parts.readInvocation(keep.key);
      expect(read.status === 'ready' && read.result).toEqual(wholeResults[keep.key]);
    } finally {
      close();
    }
  });
});

describe('R1 · redaction: a part holds exactly what the whole held', () => {
  it('a value the policy keeps out of the whole is in no part, and the base keeps the policy marker', async () => {
    const marker = 'PLANTED-REDACT-91c4';
    const redacted = await realRecording({ redact: true, marker });
    const parsed = JSON.parse(JSON.stringify(redacted)) as {
      snapshot: { subflowResults: unknown } & Record<string, unknown>;
    };
    const results = JSON.stringify(parsed.snapshot.subflowResults);
    const { subflowResults: _dropped, ...rest } = parsed.snapshot;
    void _dropped;
    const outsideResults = JSON.stringify({ ...parsed, snapshot: rest });
    // The policy kept the marker out of every subflow result and left placeholders.
    expect(results).not.toContain(marker);
    expect(results).toContain('REDACTED');

    const split = await splitRecording(redacted, { runId: 'r', targetBytes: 8192 });
    const parts = split.parts.map((part) => part.text);
    expect(parts.some((part) => part.includes(marker))).toBe(false);
    expect(parts.some((part) => part.includes('REDACTED'))).toBe(true);
    expect(split.base.text.includes(marker)).toBe(outsideResults.includes(marker));
    const base = JSON.parse(split.base.text) as { recording: { snapshot: unknown } };
    expect(servedUnderPolicy(base.recording.snapshot)).toBe(servedUnderPolicy(parsed.snapshot));
    expect(servedUnderPolicy(base.recording.snapshot)).toBe(true);

    // The same run without the policy holds the marker in its results, so the checks above can fail.
    const open = await realRecording({ marker });
    const openSplit = await splitRecording(open, { runId: 'r', targetBytes: 8192 });
    expect(openSplit.parts.some((part) => part.text.includes(marker))).toBe(true);
  });
});

describe('R2 · nothing the reader reports carries a recorded value', () => {
  it('the index, the sizes and every refusal hold no recorded value', async () => {
    const marker = 'PLANTED-SECRET-7f3a';
    const { store, close } = STORES[0]!.create();
    try {
      const filed = await fileParts(store, recording, { targetBytes: 8192 });
      expect(JSON.stringify(recording)).toContain(marker);
      expect(filed.indexText).not.toContain(marker);
      const parts = await ready(openSavedRecording(bindArtifacts(store, SCOPE), filed.index));
      expect(JSON.stringify(parts.sizes)).not.toContain(marker);
      expect(JSON.stringify(parts.invocations)).not.toContain(marker);
      await store.delete(SCOPE, filed.parts[0]!);
      const refusals = await Promise.all([
        parts.readInvocation(parts.invocations[0]!.key),
        parts.readInvocation(marker),
        parts.readWhole(),
      ]);
      for (const refusal of refusals) {
        expect(Object.keys(refusal).sort()).toEqual(['reason', 'status']);
        expect(JSON.stringify(refusal)).not.toContain(marker);
      }
    } finally {
      close();
    }
  });
});
