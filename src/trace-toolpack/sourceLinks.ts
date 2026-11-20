import type { CommitBundle } from 'foottrace';
import {
  bindSourceLinkWrites,
  readServedRow,
  readSourceLinkRow,
  type RecordScope,
  type RecordSourceLinks,
  type SourceLinkRow,
  type SourceLinkRowLocation,
} from 'foottrace/cause';
import { readOwnList } from '../lib/boundedJson.js';
import { keyedFold } from '../time-travel/keyedFold.js';
import { captureOwn as own } from './causeCapture.js';

const servedKey = 'sourceLinkServedRows';
const consumerKey = 'sourceLinkConsumer';
const witnessKey = 'sourceLinkRows';
const boundKey = 'sourceLinkRowsBounded';
const maxLinks = 256;
const maxCommits = 4096;
// The widest native commit the packed binder admits.
const maxTraceRows = 128;

interface SourceLinkWriteFlags {
  readonly runtimeStageId: string;
  readonly served: boolean;
  readonly witness: boolean;
  readonly protectedHistory: boolean;
  readonly bounded: boolean;
}

/** The binder expects a read map for the scope it receives. Keep the reads of
 * retained executions through the same data-only boundary as the log. */
function prefixReads(
  scope: RecordScope,
  writes: readonly SourceLinkWriteFlags[],
): RecordScope['reads'] {
  const captured = own(scope, 'reads');
  if (captured === undefined) return undefined;
  if (captured === null || typeof captured !== 'object' || Array.isArray(captured))
    throw new TypeError('Invalid source-link reads');
  const reads: Record<string, readonly string[]> = Object.create(null);
  for (const runtimeStageId of new Set(writes.map((write) => write.runtimeStageId))) {
    const field = Object.getOwnPropertyDescriptor(captured, runtimeStageId);
    if (!field?.enumerable) continue;
    if (!('value' in field)) throw new TypeError('Invalid source-link reads');
    reads[runtimeStageId] = field.value as readonly string[];
  }
  return reads;
}

/**
 * Project a scope's own committed rows from native or admitted saved data.
 * Foottrace binds the output write. The returned shape grants no disclosure;
 * the record adapter still needs a host policy for every locator.
 */
export function sourceLinksOf(scope: RecordScope): RecordSourceLinks | undefined {
  try {
    return projectSourceLinks(scope);
  } catch {
    // Source links are supplemental. A malformed channel leaves the ordinary graph usable.
    return undefined;
  }
}

function projectSourceLinks(scope: RecordScope): RecordSourceLinks | undefined {
  const commits = readOwnList(own(scope, 'commitLog'), maxCommits);
  const initialState = own(scope, 'initialState') as RecordScope['initialState'];
  if (
    initialState === null ||
    typeof initialState !== 'object' ||
    Array.isArray(initialState) ||
    commits === undefined
  )
    return undefined;

  const log: CommitBundle[] = [];
  const writes: SourceLinkWriteFlags[] = [];
  let limited = commits.unread > 0;
  let collected = false;
  for (const bundle of commits.entries) {
    const trace = readOwnList(own(bundle, 'trace'), maxTraceRows);
    const runtimeStageId = own(bundle, 'runtimeStageId');
    if (trace === undefined || typeof runtimeStageId !== 'string')
      throw new TypeError('Invalid source-link commit');
    const paths = new Set<string>();
    for (const row of trace.entries) {
      const path = own(row, 'path');
      const verb = own(row, 'verb');
      if (typeof path !== 'string' || typeof verb !== 'string')
        throw new TypeError('Invalid source-link trace');
      paths.add(path);
      if (path === servedKey && (verb === 'set' || verb === 'append' || verb === 'merge'))
        collected = true;
    }
    if (trace.unread > 0) {
      // A partial commit cannot safely supply any binding. Earlier commits can.
      limited = true;
      break;
    }
    const overwrite = own(bundle, 'overwrite');
    const consumer = paths.has(consumerKey) ? own(overwrite, consumerKey) : undefined;
    log.push(bundle as CommitBundle);
    writes.push({
      runtimeStageId,
      served: paths.has(servedKey),
      witness: paths.has(witnessKey),
      protectedHistory:
        own(consumer, 'consumer') === runtimeStageId && own(consumer, 'historyProtected') === true,
      bounded: paths.has(boundKey) && own(overwrite, boundKey) === true,
    });
  }
  if (
    !collected ||
    (!limited && !writes.some(({ witness, protectedHistory }) => witness || protectedHistory))
  )
    return undefined;

  // Row locations need only these two lists. Foottrace binds against the whole
  // scope when it fits, or the same retained prefix when the reader stops.
  const fold = keyedFold({
    commitLog: log,
    initialState: {
      [servedKey]: own(initialState, servedKey),
      [witnessKey]: own(initialState, witnessKey),
    },
  });
  if (fold.basis !== 'initial+log') return undefined;
  const reads = limited ? prefixReads(scope, writes) : undefined;
  const bindingScope = limited
    ? { commitLog: log, initialState, ...(reads !== undefined && { reads }) }
    : scope;

  // A row carried in the seed belongs to an earlier leg. Only a native commit can add one.
  function appended(key: string, index: number): [number, readonly unknown[]] | undefined {
    const before = fold.valueAt(key, index - 1);
    const after = fold.valueAt(key, index);
    if ((before !== undefined && !Array.isArray(before)) || !Array.isArray(after)) return undefined;
    const start = before?.length ?? 0;
    return after.length > start ? [start, after] : undefined;
  }

  const consumers = new Set<string>();
  const executions = new Set<string>();
  const candidates: { row: SourceLinkRow; where: SourceLinkRowLocation }[] = [];
  const limitations = new Set<RecordSourceLinks['limitations'][number]>();
  let examined = 0;
  for (const [
    commitIdx,
    { runtimeStageId, served: wroteServed, witness: wroteWitness, protectedHistory, bounded },
  ] of writes.entries()) {
    if (!executions.has(runtimeStageId)) {
      executions.add(runtimeStageId);
      if (wroteServed) {
        const served = appended(servedKey, commitIdx);
        if (
          served !== undefined &&
          readServedRow(served[1][served[0]])?.consumer === runtimeStageId
        ) {
          consumers.add(runtimeStageId);
          if (protectedHistory) limitations.add('privacy-active');
        }
      }
    }
    if (consumers.size === 0) continue;
    const exhausted = limitations.has('budget-exhausted');
    if (bounded) limitations.add('budget-exhausted');
    // The witness budget does not stop us from reading a later policy fact.
    if (!wroteWitness || exhausted) continue;
    const witness = appended(witnessKey, commitIdx);
    if (witness === undefined) continue;
    const [start, rows] = witness;
    for (let element = start; element < rows.length; element++) {
      if (examined++ === maxLinks) {
        limitations.add('budget-exhausted');
        break;
      }
      const row = readSourceLinkRow(rows[element]);
      if (row === undefined || !consumers.has(row.consumer)) continue;
      candidates.push({ row, where: { runtimeStageId, commitIdx, key: witnessKey, element } });
    }
  }
  const batch = bindSourceLinkWrites(
    bindingScope,
    candidates.map(({ where }) => where),
  );
  if (!batch.complete) limitations.add('budget-exhausted');
  const links: RecordSourceLinks['links'][number][] = [];
  for (const [index, { row, where }] of candidates.entries()) {
    const write = batch.writes[index];
    if (write === undefined) continue;
    links.push({
      linkBasis: row.linkBasis,
      ...(row.namedBy !== undefined && { namedBy: row.namedBy }),
      check: row.check,
      ...(row.bounded && { bounded: true }),
      ...(row.leafWithheld && { leafWithheld: true }),
      consumer: { runtimeStageId: row.consumer },
      output: { ...row.output, ...write },
      ...(row.input !== undefined && { input: row.input }),
      served: { key: servedKey },
      witness: where,
    });
  }
  if (limited) limitations.add('budget-exhausted');
  else if (consumers.size === 0 || (links.length === 0 && limitations.size === 0)) return undefined;
  return {
    version: 1,
    status: limitations.size ? 'partial' : 'captured',
    links,
    limitations: [...limitations],
  };
}
