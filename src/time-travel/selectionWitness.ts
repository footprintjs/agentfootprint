import { MAX_SELECTION_ROWS } from '../core/slots/providerOmissions.js';
import {
  omissionReference,
  type OmissionCheck,
  type OmissionReference,
} from '../core/agent/honesty/sourceOmission.js';
import { readOwnList } from '../lib/boundedJson.js';
import { isPlaceholder, servedUnderPolicy } from '../redaction/marker.js';
import { epochLocations, readAfterCall, type EpochLocation } from './epochs.js';
import { readReceipt } from './servedView/recordReads.js';

const own = (value: unknown, key: string): unknown =>
  value !== null && typeof value === 'object'
    ? Object.getOwnPropertyDescriptor(value, key)?.value
    : undefined;

function rows(value: unknown): readonly unknown[] | undefined {
  const read = readOwnList(value, MAX_SELECTION_ROWS);
  return read?.unread === 0 ? read.entries : undefined;
}

const routeKey = (callable: number, label: string | undefined, ref: OmissionReference): string =>
  JSON.stringify([callable, label ?? null, ref.series, ref.attempt, ref.wireName, ref.reason]);

/** Join the accepted receipt and the source bindings recorded at that same call. */
function routesAt(at: EpochLocation): ReadonlySet<string> {
  const routes = new Set<string>();
  const receipt = readReceipt(at).receipt;
  const selection = own(receipt, 'toolSelection');
  const consumer = own(selection, 'consumer');
  if (
    own(own(receipt, 'basis'), 'epoch') !== at.epoch ||
    own(consumer, 'series') !== at.callRuntimeStageId ||
    own(selection, 'bounded') !== undefined
  )
    return routes;
  const absent = rows(own(selection, 'absent'));
  const bank = readAfterCall(at, 'sourceConsultation');
  const omissions = rows(own(bank, 'omissions'));
  if (!absent || !omissions || own(bank, 'complete') !== true) return routes;
  const excluded = new Set<string>();
  for (const row of absent) {
    const name = own(row, 'name');
    const reason = own(row, 'reason');
    if (typeof name === 'string' && !isPlaceholder(name) && typeof reason === 'string')
      excluded.add(JSON.stringify([name, reason]));
  }
  for (const row of omissions) {
    if (!row || typeof row !== 'object') continue;
    const ref = omissionReference(row);
    const callable = own(row, 'callable');
    const label = own(row, 'name');
    if (
      ref &&
      ref.iteration === at.epoch &&
      ref.series === at.callRuntimeStageId &&
      ref.attempt === own(consumer, 'attempt') &&
      typeof callable === 'number' &&
      (label === undefined || typeof label === 'string') &&
      excluded.has(JSON.stringify([ref.wireName, ref.reason]))
    )
      routes.add(routeKey(callable, label, ref));
  }
  return routes;
}

/** Resolve only referenced epochs, through the same recorded view used by receiptAt. */
export function recordedOmissions(snapshot: unknown): OmissionCheck {
  let epochs: Map<number, EpochLocation | undefined> | undefined;
  const checked = new Map<number, ReadonlySet<string>>();
  return (ref, callable, label) => {
    try {
      if (!snapshot || servedUnderPolicy(snapshot)) return false;
      if (!epochs) {
        const found = new Map<number, EpochLocation | undefined>();
        // Accept snapshot data only. Never dispatch to an accessor supplied by a saved object.
        const source = {
          commitLog: own(snapshot, 'commitLog'),
          initialState: own(snapshot, 'initialState'),
          subflowResults: own(snapshot, 'subflowResults'),
        };
        for (const at of epochLocations(source))
          found.set(at.epoch, found.has(at.epoch) ? undefined : at);
        epochs = found;
      }
      const at = epochs.get(ref.iteration);
      if (!at || ref.series !== at.callRuntimeStageId) return false;
      let routes = checked.get(at.epoch);
      if (!routes) {
        routes = routesAt(at);
        checked.set(at.epoch, routes);
      }
      return routes.has(routeKey(callable, label, ref));
    } catch {
      // A damaged or unreadable log cannot witness a selection.
      return false;
    }
  };
}
