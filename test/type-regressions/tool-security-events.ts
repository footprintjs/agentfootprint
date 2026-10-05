/** Compile-only contracts, enforced by `npm run test:types`. */
import type { Payloads, ToolCallEventIdentity } from '../../src/events.js';
import type { ToolSecurityEmitter } from '../../src/core/agent/toolSecurityEvents.js';

const identity: ToolCallEventIdentity = { toolCallId: 'actual-call', iteration: 1 };
void identity;

// Existing public event producers need not invent a call they cannot identify.
const oldCheck: Payloads.PermissionCheckPayload = {
  capability: 'tool_call',
  actor: 'agent',
  result: 'allow',
};
const oldRequested: Payloads.CredentialRequestedPayload = { service: 'synthetic-service' };
const oldAcquired: Payloads.CredentialAcquiredPayload = {
  service: 'synthetic-service',
  kind: 'bearer',
};
const oldAuthorization: Payloads.CredentialAuthorizationRequiredPayload = {
  service: 'synthetic-service',
  sessionId: 'consent',
};
const oldFailed: Payloads.CredentialFailedPayload = {
  service: 'synthetic-service',
  reason: 'test-failure',
};
const oldHalt: Payloads.PermissionHaltPayload = {
  target: 'read',
  reason: 'test-stop',
  iteration: 1,
  sequenceLength: 1,
};
void [oldCheck, oldRequested, oldAcquired, oldAuthorization, oldFailed, oldHalt];

declare const emit: ToolSecurityEmitter;

// @ts-expect-error Producer facts still require the credential service.
emit('agentfootprint.credential.requested', {});
emit('agentfootprint.credential.requested', {
  service: 'synthetic-service',
  // @ts-expect-error Identity belongs to the binding, not to a producer payload.
  toolCallId: 'forged',
});
// @ts-expect-error A binding cannot turn gate_open into a fabricated gate lifecycle.
emit('agentfootprint.permission.gate_opened', { gateId: 'invented', openedBy: 'agent' });
// @ts-expect-error Public halt payloads still require iteration; only the bound emitter fills it.
const missingIteration: Payloads.PermissionHaltPayload = {
  target: 'read',
  reason: 'test-stop',
  sequenceLength: 1,
};
void missingIteration;
