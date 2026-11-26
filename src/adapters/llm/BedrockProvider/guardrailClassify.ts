/** Pure private trace classification. A proved block dominates incomplete/masking-only evidence. */
import type { ProviderIntervention } from '../../../provider-contract/intervention.js';
import type { GuardrailConfiguration } from './guardrailConfig.js';
import { GuardrailInspection } from './guardrailRead.js';
import {
  ASSESSMENT_METADATA,
  CARRIERS,
  POLICIES,
  RESPONSE_TRACE_FIELDS,
  TRACE_FIELDS,
  type ActionCarrier,
} from './guardrailSchemas.js';

const INTERVENTION_CODES = new Set(['guardrail_intervened', 'content_filtered']);
const UNKNOWN_CODE = 'bedrock_guardrail_unknown';

/** Bound the original stop code without materializing all of an untrusted string's scalars. */
export function guardrailCode(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) return UNKNOWN_CODE;
  if (value.length > 256) return UNKNOWN_CODE;
  return Array.from(value).length > 128 ? UNKNOWN_CODE : value;
}

export function unknownGuardrail(code: unknown): ProviderIntervention {
  return { outcome: 'unknown', code: guardrailCode(code), filters: [] };
}

/** Process only the recognized carrier fields; private trace text is never read or copied. */
class Classification {
  constructor(readonly reads: GuardrailInspection) {}
  private blocked = false;
  private masked = false;
  private readonly descriptors: { family: string; type?: string }[] = [];
  private readonly emitted = new Set<string>();

  private describe(carrier: ActionCarrier, type: string | undefined): void {
    const key = `${carrier.family}:${type ?? ''}`;
    if (this.emitted.has(key) || this.descriptors.length >= 32) return;
    this.emitted.add(key);
    this.descriptors.push({ family: carrier.family, ...(type === undefined ? {} : { type }) });
  }

  private action(value: unknown, carrier: ActionCarrier): void {
    const keys = this.reads.keys(value);
    if (keys === undefined) return;
    let validCarrier = !keys.some((key) => !carrier.fields.has(key));
    const action = this.reads.field(value, 'action');
    if (!action.present || !action.valid) {
      this.reads.complete = false;
      return;
    }
    const knownAction =
      action.value === 'BLOCKED' ||
      action.value === 'NONE' ||
      (carrier.masks && action.value === 'ANONYMIZED');
    if (!knownAction) {
      this.reads.complete = false;
      return;
    }
    let type: string | undefined;
    if (carrier.labels !== undefined) {
      const label = this.reads.field(value, 'type');
      if (label.valid && typeof label.value === 'string' && carrier.labels.has(label.value))
        type = label.value;
      else validCarrier = false;
    }
    const detected = this.reads.field(value, 'detected');
    if (
      !detected.valid ||
      (detected.present &&
        (typeof detected.value !== 'boolean' ||
          (detected.value === false && action.value !== 'NONE')))
    )
      validCarrier = false;
    // A malformed carrier cannot prove a block of its own. Mark it incomplete
    // and keep walking: another valid sibling can still establish BLOCKED.
    if (!validCarrier) {
      this.reads.complete = false;
      return;
    }
    if (action.value === 'BLOCKED') this.blocked = true;
    if (action.value === 'ANONYMIZED') this.masked = true;
    if (action.value !== 'NONE') this.describe(carrier, type);
  }

  private assessment(value: unknown): void {
    const keys = this.reads.keys(value);
    if (keys === undefined) return;
    for (const key of keys) {
      if (ASSESSMENT_METADATA.has(key)) continue;
      // Automated reasoning findings are not documented action carriers.
      // Their presence, or a new policy family, cannot certify masking-only.
      const policy = Object.hasOwn(POLICIES, key) ? POLICIES[key] : undefined;
      if (policy === undefined) {
        this.reads.complete = false;
        continue;
      }
      const field = this.reads.field(value, key);
      const members = this.reads.keys(field.value);
      if (!field.valid || members === undefined) {
        this.reads.complete = false;
        continue;
      }
      for (const member of members) {
        const name = Object.hasOwn(policy, member) ? policy[member] : undefined;
        if (name === undefined) {
          this.reads.complete = false;
          continue;
        }
        const list = this.reads.field(field.value, member);
        if (!list.valid) continue;
        this.reads.list(list.value, (entry) => this.action(entry, CARRIERS[name] as ActionCarrier));
      }
    }
  }

  trace(value: unknown): void {
    const traceKeys = this.reads.keys(value);
    if (traceKeys === undefined) return;
    if (traceKeys.some((key) => !RESPONSE_TRACE_FIELDS.has(key))) this.reads.complete = false;
    // Both documented root members are optional. Only the guardrail member is
    // assessment evidence; a router's presence never authorizes reading its value.
    if (!traceKeys.includes('guardrail')) return;
    const field = this.reads.field(value, 'guardrail');
    if (!field.valid || !field.present) {
      this.reads.complete = false;
      return;
    }
    const keys = this.reads.keys(field.value);
    if (keys === undefined) return;
    if (keys.some((key) => !TRACE_FIELDS.has(key))) this.reads.complete = false;
    for (const key of ['inputAssessment', 'outputAssessments'] as const) {
      if (!keys.includes(key)) continue;
      const map = this.reads.field(field.value, key);
      const identities = this.reads.keys(map.value);
      if (!map.valid || identities === undefined) {
        this.reads.complete = false;
        continue;
      }
      for (const identity of identities) {
        const assessment = this.reads.field(map.value, identity);
        if (!assessment.valid) continue;
        if (key === 'inputAssessment') this.assessment(assessment.value);
        else this.reads.list(assessment.value, (entry) => this.assessment(entry));
      }
    }
  }

  outcome(code: string, observed: boolean): ProviderIntervention | undefined {
    if (this.blocked) return { outcome: 'blocked', code, filters: this.descriptors };
    if (this.masked && this.reads.complete && code !== 'content_filtered')
      return { outcome: 'masked', code, filters: this.descriptors };
    return observed || this.masked || !this.reads.complete
      ? { outcome: 'unknown', code, filters: this.descriptors }
      : undefined;
  }
}

/** The trace is fetched only when configuration explicitly permits its private processing. */
export function classifyGuardrail(
  response: unknown,
  config: GuardrailConfiguration | undefined,
): ProviderIntervention | undefined {
  const reads = new GuardrailInspection();
  const stop = reads.field(response, 'stopReason');
  const code = guardrailCode(stop.value);
  const observed = INTERVENTION_CODES.has(code);
  // With no configured guardrail, the ordinary optional-stop projection is
  // unchanged. Only an actually observed intervention code adds uncertainty.
  if (config === undefined) return observed ? unknownGuardrail(code) : undefined;
  if (!stop.valid || typeof stop.value !== 'string') return unknownGuardrail(code);
  if (config.trace === 'disabled') return observed ? unknownGuardrail(code) : undefined;
  const trace = reads.field(response, 'trace');
  if (!trace.valid) return unknownGuardrail(code);
  if (!trace.present) return observed ? unknownGuardrail(code) : undefined;
  const classification = new Classification(reads);
  classification.trace(trace.value);
  return classification.outcome(code, observed);
}
