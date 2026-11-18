import type { ToolResultRowset } from '../../../tools/resultRowsets.js';
import type { ToolExecutionContext } from '../../../tools/tools.js';
import type { ToolRowsetCheckReason } from '../../../events/payloads/toolRowsets.js';
import type { RowsetReading } from '../../../integrity/column-types/check.js';
import { utf8Length } from '../../../lib/utf8.js';
import { throwIfAborted, untilAborted } from '../../../lib/abort.js';
import { readToolResultEnvelope } from '../../../semantics/toolEffects.js';
import { readAbsence } from '../../../semantics/coverage/index.js';
import { readCoverageResult } from '../../../semantics/coverage/read.js';
import {
  boundedSourceDataset,
  sameArtifactMeta,
  valueAtPath,
} from '../../../artifacts/sourceEvidence/datasets.js';
import type { SourcePublicationReceipt } from '../sourceEvidence/publications.js';
import { inlineSnapshot, inlineRowset, RowsetUnavailable } from './inlineRows.js';

export interface GovernedRowset {
  readonly reason: ToolRowsetCheckReason;
  readonly available: boolean;
  readonly reading?: RowsetReading;
}
const unavailable = (reason: ToolRowsetCheckReason): GovernedRowset => ({
  available: false,
  reason,
});

/** Read only the explicit final binding and this invocation's native receipt. */
export async function readGovernedRowset(
  declaration: ToolResultRowset,
  served: unknown,
  context: ToolExecutionContext | undefined,
  publications: SourcePublicationReceipt | undefined,
  active: () => boolean,
): Promise<GovernedRowset> {
  try {
    if (!active() || context?.signal?.aborted) return unavailable('source-aborted');
    let value = served;
    if (typeof value === 'string') {
      if (value.length > 1048576 || utf8Length(value) > 1048576)
        return unavailable('source-over-bound');
      try {
        value = JSON.parse(value);
      } catch {
        // A root published binding may itself be the actual opaque ref string.
        // Prose still cannot become rows or a guessed nested reference.
      }
    }
    // Existing recognizers may read marker fields directly; only detached own
    // data crosses them here, including the outer wrapper and every path node.
    const source = declaration.source;
    const path = source.kind === 'inline' ? source.path : source.refPath;
    // The selected row data keeps its own 16-level bound below. The outer
    // spine has a separate budget: one native content envelope + the static
    // path (at most 16 segments) + the selected row data, at most 33 total.
    value = inlineSnapshot(value, 1048576, 1 + path.length + 16);
    const envelope = readToolResultEnvelope(value);
    if (envelope !== undefined) value = envelope.content;
    if (readAbsence(value) !== undefined || readCoverageResult(value)?.status === 'absent')
      return { available: true, reason: 'declared-absence' };
    let rows: unknown;
    if (source.kind === 'inline') {
      rows = valueAtPath(value, source.path);
      if (rows === undefined) return unavailable('source-missing');
    } else {
      if (!context?.hasArtifacts) return unavailable('store-unavailable');
      const ref = valueAtPath(value, source.refPath);
      if (typeof ref !== 'string') return unavailable('source-missing');
      const published = publications?.get(ref);
      if (!published) return unavailable('publication-unavailable');
      if (published.kind !== source.artifactKind) return unavailable('wrong-kind');
      if (published.bytes > source.maxBytes) return unavailable('source-over-bound');
      const record = await boundedSourceDataset(
        context.artifacts,
        published,
        source.maxBytes,
        context.signal,
      );
      if (!record) return unavailable('publication-changed');
      throwIfAborted(context.signal);
      if (!active()) return unavailable('source-aborted');
      const current = await untilAborted(context.artifacts.head(ref), context.signal);
      if (!current || !sameArtifactMeta(current, published))
        return unavailable('publication-changed');
      rows = record.data;
      if (Array.isArray(rows) && rows.length > source.maxRows)
        return unavailable('source-over-bound');
    }
    if (readAbsence(rows) !== undefined) return { available: true, reason: 'declared-absence' };
    const reading = inlineRowset(rows);
    if (reading.rows.length === 0) return { available: true, reason: 'empty' };
    return { available: true, reason: 'rows', reading };
  } catch (error) {
    if (!active() || context?.signal?.aborted) return unavailable('source-aborted');
    return unavailable(error instanceof RowsetUnavailable ? error.reason : 'store-unavailable');
  }
}
