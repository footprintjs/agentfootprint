import type { FlowchartCheckpoint, RedactionMarks, RedactionPolicy } from 'footprintjs';
import { policyOfMarks, unionRedactionPolicies } from './policy.js';
import {
  PRIVATE_FIELDS_KEY,
  readPrivateRecordFields,
  type PrivateRecordFields,
} from './privateFields.js';

/** Admit only the fixed own-data carrier; accessors never run at the resume door. */
export function privateFieldsOfCheckpoint(
  checkpoint: FlowchartCheckpoint,
): PrivateRecordFields | undefined {
  const state = checkpoint.sharedState;
  if (state === undefined || state === null || typeof state !== 'object') return undefined;
  const own = Object.getOwnPropertyDescriptor(state, PRIVATE_FIELDS_KEY);
  if (own === undefined) return undefined;
  if (!('value' in own)) throw new TypeError('Unreadable private record field carrier.');
  return readPrivateRecordFields(own.value);
}

/** Raw execution checkpoints retain their values; only finite names are appended. */
export function checkpointWithPrivateFields(
  checkpoint: FlowchartCheckpoint,
  fields: PrivateRecordFields | undefined,
): FlowchartCheckpoint {
  if (fields === undefined) return checkpoint;
  return {
    ...checkpoint,
    sharedState: {
      ...checkpoint.sharedState,
      [PRIVATE_FIELDS_KEY]: readPrivateRecordFields(fields),
    },
  };
}

/** Subtract positively admitted library names only; unknown marks remain conservatively protected. */
export function nonPrivateMarksOf(checkpoint: FlowchartCheckpoint): RedactionMarks | undefined {
  const privateFields = privateFieldsOfCheckpoint(checkpoint);
  const marks = checkpoint.redactionMarks;
  if (marks === undefined || privateFields === undefined) return marks;
  const privateKeys: ReadonlySet<string> = new Set([PRIVATE_FIELDS_KEY, ...privateFields.keys]);
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

/** Per-invocation record selectors; no unknown mark becomes a caller declaration. */
export function privateResumeOf(checkpoint: FlowchartCheckpoint): {
  readonly privateFields?: PrivateRecordFields;
  readonly recordMarks?: RedactionPolicy;
} {
  const privateFields = privateFieldsOfCheckpoint(checkpoint);
  return privateFields === undefined
    ? {}
    : {
        privateFields,
        recordMarks: policyOfMarks(nonPrivateMarksOf(checkpoint)),
      };
}

/** Preserve legacy caller unions; private checkpoints keep unknown marks record-only. */
export function resumePoliciesOf(
  checkpoint: FlowchartCheckpoint,
  handedDown: RedactionPolicy | undefined,
  declared: RedactionPolicy | undefined,
): { readonly caller: RedactionPolicy | undefined; readonly serving: RedactionPolicy | undefined } {
  const marks = policyOfMarks(nonPrivateMarksOf(checkpoint));
  if (privateFieldsOfCheckpoint(checkpoint) === undefined) {
    const caller = unionRedactionPolicies(handedDown, marks);
    return { caller, serving: unionRedactionPolicies(declared, caller) };
  }
  return { caller: handedDown, serving: unionRedactionPolicies(declared, handedDown, marks) };
}
