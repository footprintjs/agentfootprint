import { createHash } from 'node:crypto';
import type { captureControl } from './scenarios.js';

type Control = Awaited<ReturnType<typeof captureControl>>;
type ByteEvidence = { readonly bytes: number; readonly sha256: string };

/**
 * Compare serialized bytes in their original key and array order. Mask only clocks,
 * generated run identities, and the receipt digests that use the run ID as salt.
 */
const volatileFields: Readonly<Record<keyof Control, readonly RegExp[]>> = {
  chart: [],
  commitLog: [
    /^\.\d+\.overwrite\.(?:turnStartMs|runIdentity\.conversationId)$/,
    /^\.\d+\.overwrite\.toolResourceOwner\.birth\.runId$/,
    /^\.\d+\.overwrite\.receipt\.(?:basis\.runId|system\.hash|messages\.entries\.\d+\.hash|tools\.schemaHashes\.lookup)$/,
  ],
  events: [
    /^\.\d+\.meta\.(?:wallClockMs|runOffsetMs|runId|sourcePosition\.(?:engineRunId|logRunId))$/,
    /^\.\d+\.payload\.durationMs$/,
  ],
  answer: [],
};

function withoutVolatileFields(value: unknown, paths: readonly RegExp[], path = ''): unknown {
  if (paths.some((field) => field.test(path))) return '<per-run>';
  if (Array.isArray(value)) {
    return value.map((entry, index) => withoutVolatileFields(entry, paths, `${path}.${index}`));
  }
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      withoutVolatileFields(entry, paths, `${path}.${key}`),
    ]),
  );
}

export function captureDigests(control: Control): Record<keyof Control, ByteEvidence> {
  const digest = (key: keyof Control): ByteEvidence => {
    const value = control[key];
    const bytes = Buffer.from(
      key === 'answer' && typeof value === 'string'
        ? value
        : JSON.stringify(withoutVolatileFields(value, volatileFields[key])),
      'utf8',
    );
    return { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  };
  return {
    chart: digest('chart'),
    commitLog: digest('commitLog'),
    events: digest('events'),
    answer: digest('answer'),
  };
}
