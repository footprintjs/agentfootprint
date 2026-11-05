import type { FlowchartCheckpoint, RedactionMarks, RedactionPolicy } from 'footprintjs';
import { copyJson, ownData } from '../lib/boundedJson.js';
import type { RedactionCoverage } from './coverage.js';
import type { RunRedaction } from './runRedaction.js';
import { policyOfMarks, unionRedactionPolicies } from './policy.js';
import {
  checkpointOwnValue,
  checkpointStateSlot,
  checkpointStateValue,
  privateCallerFor,
  readPrivateCaller,
  withCheckpointData,
  type PrivateCallerDeclaration,
} from './privateCaller.js';
import {
  PRIVATE_FIELDS_KEY,
  readPrivateRecordFields,
  type PrivateRecordFields,
} from './privateFields.js';

export function privateFieldsOfCheckpoint(
  checkpoint: FlowchartCheckpoint,
): PrivateRecordFields | undefined {
  const slot = checkpointStateSlot(checkpoint, PRIVATE_FIELDS_KEY);
  return slot.present ? readPrivateRecordFields(slot.value) : undefined;
}

export function callerOfCheckpoint(checkpoint: FlowchartCheckpoint): PrivateCallerDeclaration {
  return readPrivateCaller(
    checkpointStateValue(checkpoint, 'runRedaction'),
    privateFieldsOfCheckpoint(checkpoint),
  );
}

/** Root returned-checkpoint projection; raw native writers must write the same union. */
export function checkpointWithPrivateFields(
  checkpoint: FlowchartCheckpoint,
  fields: PrivateRecordFields | undefined,
  coverage?: RedactionCoverage,
): FlowchartCheckpoint {
  if (fields === undefined) return checkpoint;
  if (coverage === undefined) throw new TypeError('Unknown checkpoint caller coverage.');
  const admitted = readPrivateRecordFields(fields);
  const prior = readPrivateCaller(checkpointStateValue(checkpoint, 'runRedaction'), admitted);
  if (coverage.state === 'declared-none' && prior.state === 'policy')
    throw new TypeError('Conflicting checkpoint caller coverage.');
  const state = checkpointOwnValue(checkpoint, 'sharedState') ?? {};
  // Admit the container even when it had no prior runRedaction property.
  checkpointOwnValue(state, 'runRedaction');
  return withCheckpointData(checkpoint, {
    sharedState: withCheckpointData(state as object, {
      [PRIVATE_FIELDS_KEY]: admitted,
      runRedaction: privateCallerFor(coverage),
    }),
  });
}

/** The actual opened run supplies both its private names and positive caller coverage. */
export function checkpointWithPrivateRun(
  checkpoint: FlowchartCheckpoint,
  run: Pick<RunRedaction, 'privateFields' | 'coverage'> | undefined,
): FlowchartCheckpoint {
  return checkpointWithPrivateFields(checkpoint, run?.privateFields(), run?.coverage);
}

/** Admit native mark data before examining it; no getter or iterator is invoked. */
function checkpointMarks(checkpoint: FlowchartCheckpoint): RedactionMarks | undefined {
  const raw = checkpointOwnValue(checkpoint, 'redactionMarks');
  if (raw === undefined) return undefined;
  const data = ownData(copyJson(raw, Number.MAX_SAFE_INTEGER, false, 5), ['keys', 'fields']);
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((key) => typeof key === 'string' && key.length > 0);
  if (!strings(data.keys)) throw new TypeError('Unreadable checkpoint redaction marks.');
  if (data.fields !== undefined) {
    const fields = ownData(data.fields);
    if (Object.values(fields).some((paths) => !strings(paths)))
      throw new TypeError('Unreadable checkpoint redaction marks.');
  }
  // The original ordinary own-data object is kept for the old no-private identity path.
  return raw as RedactionMarks;
}

/** Keep every unknown mark; subtract only the admitted finite private selectors. */
export function nonPrivateMarksOf(checkpoint: FlowchartCheckpoint): RedactionMarks | undefined {
  const privateFields = privateFieldsOfCheckpoint(checkpoint);
  const marks = checkpointMarks(checkpoint);
  if (marks === undefined || privateFields === undefined) return marks;
  const privateKeys = new Set<string>([PRIVATE_FIELDS_KEY, ...privateFields.keys]);
  const keys = marks.keys.filter((key) => !privateKeys.has(key));
  const fields = Object.fromEntries(
    Object.entries(marks.fields ?? {}).flatMap(([root, paths]) => {
      if (privateKeys.has(root)) return [];
      const admitted = privateFields.fields[root as keyof typeof privateFields.fields] ?? [];
      const remaining = paths.filter((path) => !admitted.includes(path));
      return remaining.length === 0 ? [] : [[root, remaining]];
    }),
  );
  return { keys, ...(Object.keys(fields).length > 0 && { fields }) };
}

/** Unknown native marks remain record-only on a positively private continuation. */
export function privateResumeOf(checkpoint: FlowchartCheckpoint): {
  privateFields?: PrivateRecordFields;
  recordMarks?: RedactionPolicy;
} {
  const privateFields = privateFieldsOfCheckpoint(checkpoint);
  callerOfCheckpoint(checkpoint); // Validate any explicit declaration; admission is at the resume door.
  return privateFields === undefined
    ? {}
    : {
        privateFields,
        recordMarks: policyOfMarks(nonPrivateMarksOf(checkpoint)),
      };
}

export function resumePoliciesOf(
  checkpoint: FlowchartCheckpoint,
  handedDown: RedactionPolicy | undefined,
  declared: RedactionPolicy | undefined,
): { caller: RedactionPolicy | undefined; serving: RedactionPolicy | undefined } {
  const marks = policyOfMarks(nonPrivateMarksOf(checkpoint));
  if (privateFieldsOfCheckpoint(checkpoint) === undefined) {
    const caller = unionRedactionPolicies(handedDown, marks);
    return { caller, serving: unionRedactionPolicies(declared, caller) };
  }
  return { caller: handedDown, serving: unionRedactionPolicies(declared, handedDown, marks) };
}
