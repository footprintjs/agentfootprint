import type { CommitBundle } from 'foottrace';
import {
  bindSourceLinkWrite,
  readServedRow,
  readSourceLinkRow,
  type RecordScope,
  type RecordSourceLinks,
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
  const initialState = own(scope, 'initialState');
  if (
    initialState === null ||
    typeof initialState !== 'object' ||
    Array.isArray(initialState) ||
    commits === undefined ||
    commits.unread > 0
  )
    return undefined;

  const log = commits.entries as readonly CommitBundle[];
  const writes = log.map((bundle) => {
    const trace = readOwnList(own(bundle, 'trace'), maxTraceRows);
    const runtimeStageId = own(bundle, 'runtimeStageId');
    if (trace === undefined || trace.unread > 0 || typeof runtimeStageId !== 'string')
      throw new TypeError('Invalid source-link commit');
    const paths = trace.entries.map((row) => own(row, 'path'));
    if (paths.some((path) => typeof path !== 'string'))
      throw new TypeError('Invalid source-link trace');
    const overwrite = own(bundle, 'overwrite');
    const consumer = paths.includes(consumerKey) ? own(overwrite, consumerKey) : undefined;
    return {
      runtimeStageId,
      served: paths.includes(servedKey),
      witness: paths.includes(witnessKey),
      protectedHistory:
        own(consumer, 'consumer') === runtimeStageId && own(consumer, 'historyProtected') === true,
      bounded: paths.includes(boundKey) && own(overwrite, boundKey) === true,
    };
  });
  if (
    !writes.some(({ served }) => served) ||
    !writes.some(({ witness, protectedHistory }) => witness || protectedHistory)
  )
    return undefined;

  // Row locations need only these two lists. Foottrace gets the full scope for binding.
  const fold = keyedFold({
    commitLog: log,
    initialState: {
      [servedKey]: own(initialState, servedKey),
      [witnessKey]: own(initialState, witnessKey),
    },
  });
  if (fold.basis !== 'initial+log') return undefined;

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
  const links: RecordSourceLinks['links'][number][] = [];
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
      const where = { runtimeStageId, commitIdx, key: witnessKey, element };
      const write = bindSourceLinkWrite(scope, where);
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
  }
  if (consumers.size === 0 || (links.length === 0 && limitations.size === 0)) return undefined;
  return {
    version: 1,
    status: limitations.size ? 'partial' : 'captured',
    links,
    limitations: [...limitations],
  };
}
