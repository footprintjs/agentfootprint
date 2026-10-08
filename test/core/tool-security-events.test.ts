import { describe, expect, it } from 'vitest';
import { bindToolSecurityEvents } from '../../src/core/agent/toolSecurityEvents.js';
import { noPolicyScope } from '../helpers/noPolicy.js';

describe('call-bound security event emitter', () => {
  for (const toolCallId of ['', 'provider/#call:雪']) {
    it(`captures the exact scalar identity at binding (${JSON.stringify(toolCallId)})`, () => {
      const emitted: { name: string; payload: unknown }[] = [];
      // A run with no policy: its events are served as made.
      const scope = noPolicyScope({
        $emit: (name: string, payload?: unknown) => {
          emitted.push({ name, payload });
        },
      });
      const call = { toolCallId, iteration: 0 };
      const emit = bindToolSecurityEvents(scope, call);
      call.toolCallId = 'later-call';
      call.iteration = 7;
      emit('agentfootprint.credential.requested', { service: 'synthetic-service' });
      expect(emitted).toEqual([
        {
          name: 'agentfootprint.credential.requested',
          payload: { service: 'synthetic-service', toolCallId, iteration: 0 },
        },
      ]);
    });
  }

  it('stamps captured identity after any runtime payload fields without mutating the payload', () => {
    const emitted: unknown[] = [];
    const emit = bindToolSecurityEvents(
      noPolicyScope({
        $emit: (_name: string, payload?: unknown) => {
          emitted.push(payload);
        },
      }),
      { toolCallId: 'actual-call', iteration: 3 },
    );
    // A structurally wider variable models a JavaScript caller supplying these fields.
    const supplied = Object.freeze({
      service: 'synthetic-service',
      toolCallId: 'forged',
      iteration: 99,
    });
    emit('agentfootprint.credential.requested', supplied);
    expect(emitted).toEqual([
      { service: 'synthetic-service', toolCallId: 'actual-call', iteration: 3 },
    ]);
    expect(supplied).toEqual({ service: 'synthetic-service', toolCallId: 'forged', iteration: 99 });
  });

  it('emits each of the six existing producer event shapes', () => {
    const emitted: string[] = [];
    const emit = bindToolSecurityEvents(
      {
        $emit: (name) => {
          emitted.push(name);
        },
      },
      { toolCallId: 'actual-call', iteration: 2 },
    );
    emit('agentfootprint.permission.check', {
      capability: 'tool_call',
      actor: 'agent',
      result: 'allow',
    });
    emit('agentfootprint.permission.halt', {
      target: 'read',
      reason: 'test-stop',
      sequenceLength: 1,
    });
    emit('agentfootprint.credential.requested', { service: 'synthetic-service' });
    emit('agentfootprint.credential.acquired', { service: 'synthetic-service', kind: 'bearer' });
    emit('agentfootprint.credential.authorization_required', {
      service: 'synthetic-service',
      sessionId: 'consent',
    });
    emit('agentfootprint.credential.failed', {
      service: 'synthetic-service',
      reason: 'test-failure',
    });
    expect(emitted).toEqual([
      'agentfootprint.permission.check',
      'agentfootprint.permission.halt',
      'agentfootprint.credential.requested',
      'agentfootprint.credential.acquired',
      'agentfootprint.credential.authorization_required',
      'agentfootprint.credential.failed',
    ]);
  });
});
