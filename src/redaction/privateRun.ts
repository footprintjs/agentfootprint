import type { RedactionPolicy } from 'footprintjs';
import type { RedactionRule } from 'footprintjs/advanced';
import { unionRedactionPolicies } from './policy.js';
import { carriedRunPolicy } from './conversation.js';
import { PRIVATE_CALLER_NONE } from './privateCaller.js';
import {
  addPrivateRecordFields,
  mergePrivateRecordFields,
  PRIVATE_FIELDS_KEY,
  privateRecordPolicy,
  readPrivateRecordFields,
  type PrivateFieldRoot,
  type PrivateRecordFields,
} from './privateFields.js';

export type PrivateSelection = { readonly root: PrivateFieldRoot; readonly path: string };
interface PrivateFieldScope {
  $setValue(key: string, value: unknown): void;
}

export class PrivateFieldsUnavailableError extends Error {
  readonly code = 'ERR_PRIVATE_FIELDS_UNAVAILABLE';
  constructor() {
    super('Private record fields require an armed native redaction rule.');
    this.name = 'PrivateFieldsUnavailableError';
  }
}

/** Per-leg selector data only. Never retains a scope, raw value or native run bank. */
export interface PrivateRun {
  recordPolicy(rule?: RedactionRule): RedactionPolicy | undefined;
  hasRecordPolicy(rule: RedactionRule): boolean;
  hasRecordMarks(rule: RedactionRule): boolean;
  fields(rule?: RedactionRule): PrivateRecordFields | undefined;
  bind(rule: RedactionRule): void;
  canStore(rule: RedactionRule, nativeBound: boolean): boolean;
  store(
    scope: PrivateFieldScope,
    rule: RedactionRule,
    nativeBound: boolean,
    selections: readonly PrivateSelection[],
  ): void;
}

interface RuleNames {
  readonly caller: RedactionPolicy | undefined;
  readonly recordMarks: RedactionPolicy | undefined;
  readonly fields: PrivateRecordFields | undefined;
}
// Actual native-rule identity only; names and admitted selectors, never values or scopes.
const ruleNames = new WeakMap<RedactionRule, RuleNames>();

export function carryPrivateRuleNames(from: RedactionRule, to: RedactionRule): void {
  const known = ruleNames.get(from);
  if (known !== undefined) ruleNames.set(to, known);
}

function register(rule: RedactionRule, fields: PrivateRecordFields): void {
  rule.mark(PRIVATE_FIELDS_KEY);
  for (const key of fields.keys) rule.mark(key);
  for (const [key, paths] of Object.entries(fields.fields))
    if (paths !== undefined) rule.inheritFields(key, paths);
}

export function createPrivateRun(
  caller: RedactionPolicy | undefined,
  initial: PrivateRecordFields | undefined,
  recordMarks?: RedactionPolicy,
): PrivateRun {
  const admitted = initial === undefined ? undefined : readPrivateRecordFields(initial);
  const fields = (rule?: RedactionRule): PrivateRecordFields | undefined =>
    (rule === undefined ? undefined : ruleNames.get(rule)?.fields) ?? admitted;
  const canStore = (rule: RedactionRule, nativeBound: boolean): boolean =>
    nativeBound &&
    (admitted === undefined || rule.isKeyRedacted(PRIVATE_FIELDS_KEY)) &&
    ((ruleNames.get(rule)?.caller ?? caller) !== undefined ||
      (fields(rule) !== undefined && rule.isKeyRedacted(PRIVATE_FIELDS_KEY)));
  return {
    hasRecordPolicy: (rule) =>
      caller !== undefined ||
      recordMarks !== undefined ||
      fields(rule) !== undefined ||
      ruleNames.get(rule)?.caller !== undefined ||
      ruleNames.get(rule)?.recordMarks !== undefined,
    hasRecordMarks: (rule) =>
      recordMarks !== undefined || ruleNames.get(rule)?.recordMarks !== undefined,
    recordPolicy(rule) {
      const current = fields(rule);
      const callers = unionRedactionPolicies(
        caller,
        rule === undefined ? undefined : ruleNames.get(rule)?.caller,
      );
      const records = unionRedactionPolicies(
        recordMarks,
        rule === undefined ? undefined : ruleNames.get(rule)?.recordMarks,
      );
      return current === undefined
        ? unionRedactionPolicies(callers, records)
        : unionRedactionPolicies(
            callers,
            records,
            { keys: [PRIVATE_FIELDS_KEY] },
            privateRecordPolicy(current),
          );
    },
    fields,
    bind(rule) {
      const known = ruleNames.get(rule);
      const current =
        admitted === undefined || !rule.isKeyRedacted(PRIVATE_FIELDS_KEY)
          ? known?.fields
          : known?.fields === undefined
          ? admitted
          : mergePrivateRecordFields(known.fields, admitted);
      const callers = unionRedactionPolicies(known?.caller, caller);
      const records = unionRedactionPolicies(known?.recordMarks, recordMarks);
      if (current !== undefined || callers !== undefined || records !== undefined)
        ruleNames.set(rule, { caller: callers, recordMarks: records, fields: current });
      if (current !== undefined) register(rule, current);
    },
    canStore,
    store(scope, rule, nativeBound, selections) {
      if (!canStore(rule, nativeBound)) throw new PrivateFieldsUnavailableError();
      const next = addPrivateRecordFields(fields(rule), selections);
      // Native selectors must be registered before either the anchor or secret writes.
      register(rule, next);
      ruleNames.set(rule, {
        caller: unionRedactionPolicies(ruleNames.get(rule)?.caller, caller),
        recordMarks: unionRedactionPolicies(ruleNames.get(rule)?.recordMarks, recordMarks),
        fields: next,
      });
      const actualCaller = ruleNames.get(rule)?.caller;
      scope.$setValue(
        'runRedaction',
        actualCaller === undefined ? PRIVATE_CALLER_NONE : carriedRunPolicy(actualCaller),
      );
      scope.$setValue(PRIVATE_FIELDS_KEY, next);
    },
  };
}

/**
 * Only positively admitted private fields can avoid the existing value-kind
 * restriction. Whole-root keys and every unknown native mark stay conservative.
 */
export function privateMarksNeedDefaultDeny(
  rule: RedactionRule,
  carrier: PrivateRecordFields | undefined,
): boolean {
  const known = ruleNames.get(rule);
  if (known?.caller !== undefined || known?.recordMarks !== undefined) return true;
  carrier = known?.fields ?? carrier;
  if (carrier === undefined) return !rule.isInert();
  if (carrier.keys.length > 0) return true;
  const marks = rule.marksForCheckpoint();
  if (marks?.keys.some((key) => key !== PRIVATE_FIELDS_KEY)) return true;
  for (const [key, paths] of Object.entries(marks?.fields ?? {})) {
    const known = carrier.fields[key as PrivateFieldRoot];
    if (known === undefined || paths.some((path) => !known.includes(path))) return true;
  }
  return false;
}
