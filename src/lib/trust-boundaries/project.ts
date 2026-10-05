import { LOOP_MOMENTS } from '../../core/agent/moments.js';
import type { EventSourcePosition } from '../../events/types.js';
import type {
  MiddlewareDecisionPayload,
  PermissionCheckPayload,
  CredentialRequestedPayload,
} from '../../events/payloads.js';
import type { TrustBoundaryFact, TrustBoundaryEventType } from './types.js';

const STRING_LIMIT = 512;
const PATH_LIMIT = 32;
const FACT_BYTES_LIMIT = 8192;
// Exhaustiveness belongs at the producer vocabulary boundary: additions must
// be explicitly admitted here rather than silently disappearing from capture.
const capabilities = Object.keys({
  tool_call: true,
  skill_read: true,
  memory_read: true,
  memory_write: true,
  external_net: true,
  user_data: true,
} satisfies Record<PermissionCheckPayload['capability'], true>);
const permissionResults = Object.keys({
  allow: true,
  deny: true,
  halt: true,
  gate_open: true,
} satisfies Record<PermissionCheckPayload['result'], true>);
const middlewareOutcomes = Object.keys({ allow: true, deny: true, ask: true } satisfies Record<
  MiddlewareDecisionPayload['outcome'],
  true
>);
const credentialModes = Object.keys({ machine: true, user: true } satisfies Record<
  NonNullable<CredentialRequestedPayload['mode']>,
  true
>);
const names = new Set<TrustBoundaryEventType>([
  'agentfootprint.middleware.decision',
  'agentfootprint.permission.check',
  'agentfootprint.permission.halt',
  'agentfootprint.credential.requested',
  'agentfootprint.credential.acquired',
  'agentfootprint.credential.authorization_required',
  'agentfootprint.credential.failed',
]);
const invalid = Symbol('invalid');
const oversized = Symbol('oversized');

function record(value: unknown): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid;
  return value;
}

function field(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor && !('value' in descriptor)) throw invalid;
  return descriptor?.value;
}

function text(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw invalid;
  if (value.length > STRING_LIMIT) throw oversized;
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) throw invalid;
  return value;
}

function choice(value: unknown, choices: readonly string[]): string {
  const result = text(value);
  if (!choices.includes(result)) throw invalid;
  return result;
}

function position(value: unknown): EventSourcePosition {
  const source = record(value);
  const engineRunId = text(field(source, 'engineRunId'));
  const logRunId = text(field(source, 'logRunId'));
  const rawPath = field(source, 'drillPath');
  if (!Array.isArray(rawPath)) throw invalid;
  const length = integer(field(rawPath, 'length'));
  if (length > PATH_LIMIT) throw oversized;
  const drillPath: string[] = [];
  for (let i = 0; i < length; i++) drillPath.push(text(field(rawPath, String(i))));
  return Object.freeze({
    engineRunId,
    logRunId,
    drillPath: Object.freeze(drillPath),
    committedThroughIdx: integer(field(source, 'committedThroughIdx'), -1),
  });
}

export type Projection =
  | { readonly status: 'ignored' }
  | { readonly status: 'invalid' }
  | { readonly status: 'oversized' }
  | { readonly status: 'fact'; readonly fact: TrustBoundaryFact };

/** Single own-data whitelist admission boundary. Never copies/enumerates the source. */
export function projectTrustBoundary(
  event: unknown,
  reserve: () => number | undefined,
): Projection {
  let selected = false;
  try {
    const input = record(event);
    const eventType = field(input, 'type');
    if (typeof eventType !== 'string') throw invalid;
    if (!names.has(eventType as TrustBoundaryEventType)) return { status: 'ignored' };
    selected = true;
    // Reserve after membership, before user-controlled metadata inspection.
    const seq = reserve();
    if (seq === undefined) return { status: 'ignored' };
    const meta = record(field(input, 'meta'));
    const payload = record(field(input, 'payload'));
    const stamp = field(meta, 'wallClockMs');
    if (typeof stamp !== 'number' || !Number.isFinite(stamp)) throw invalid;
    const fact: Record<string, unknown> = {
      seq,
      eventType,
      runId: text(field(meta, 'runId')),
      runtimeStageId: text(field(meta, 'runtimeStageId')),
      wallClockMs: stamp,
    };
    const source = field(meta, 'sourcePosition');
    if (source !== undefined) fact.sourcePosition = position(source);
    const callId = field(payload, 'toolCallId');
    if (callId !== undefined) fact.toolCallId = text(callId);
    const iteration = field(payload, 'iteration');
    if (iteration !== undefined) fact.iteration = integer(iteration);
    const optionalText = (key: string): void => {
      const value = field(payload, key);
      if (value !== undefined) fact[key] = text(value);
    };
    switch (eventType) {
      case 'agentfootprint.middleware.decision': {
        fact.middleware = text(field(payload, 'middleware'));
        fact.moment = choice(field(payload, 'moment'), LOOP_MOMENTS);
        fact.outcome = choice(field(payload, 'outcome'), middlewareOutcomes);
        const changed = field(payload, 'changed');
        if (typeof changed !== 'boolean') throw invalid;
        fact.changed = changed;
        fact.iteration = integer(iteration);
        break;
      }
      case 'agentfootprint.permission.check':
        fact.capability = choice(field(payload, 'capability'), capabilities);
        fact.result = choice(field(payload, 'result'), permissionResults);
        optionalText('target');
        optionalText('policyRuleId');
        break;
      case 'agentfootprint.permission.halt':
        fact.target = text(field(payload, 'target'));
        fact.iteration = integer(iteration);
        optionalText('checkerId');
        break;
      default:
        fact.service = text(field(payload, 'service'));
        if (eventType === 'agentfootprint.credential.requested') {
          const mode = field(payload, 'mode');
          if (mode !== undefined) fact.mode = choice(mode, credentialModes);
        } else if (eventType === 'agentfootprint.credential.acquired') {
          fact.kind = text(field(payload, 'kind'));
        } else if (eventType === 'agentfootprint.credential.failed') optionalText('errorClass');
    }
    if (new TextEncoder().encode(JSON.stringify(fact)).length > FACT_BYTES_LIMIT) throw oversized;
    return { status: 'fact', fact: Object.freeze(fact) as unknown as TrustBoundaryFact };
  } catch (error) {
    if (!selected) return { status: 'ignored' };
    return { status: error === oversized ? 'oversized' : 'invalid' };
  }
}
