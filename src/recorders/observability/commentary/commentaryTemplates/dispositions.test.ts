import { describe, expect, it } from 'vitest';
import { ALL_EVENT_TYPES, type AgentfootprintEvent } from '../../../../events/registry.js';
import { selectCommentaryKey, defaultCommentaryTemplates } from '../commentaryTemplates.js';
import { eventDispositions } from './dispositions.js';

describe('commentary dispositions', () => {
  it('every formerly bare event has a sentence or an explicit internal exclusion', () => {
    expect(ALL_EVENT_TYPES).toContain('agentfootprint.middleware.decision');
    for (const [type, disposition] of Object.entries(eventDispositions)) {
      const key = selectCommentaryKey({ type, payload: {}, meta: {} } as AgentfootprintEvent);
      if (disposition === null) expect(key).toBeNull();
      else {
        expect(key).toBe(`event.${type}`);
        expect(defaultCommentaryTemplates[key!]).toBe(disposition);
        expect(disposition).toMatch(/[.!?]$/);
        expect(disposition).not.toContain('[agentfootprint.');
        expect(disposition).not.toContain('{{');
      }
    }
  });
  it.each(['custom.secret', 'toString', 'constructor', '__proto__'])(
    'never dumps a custom event or its error (%s)',
    (type) => {
      const key = selectCommentaryKey({
        type,
        payload: { error: 'SECRET' },
        meta: {},
      } as unknown as AgentfootprintEvent);
      expect(defaultCommentaryTemplates[key!]).toBe('An additional event was recorded.');
    },
  );

  it.each([
    ['agentfootprint.checkin.decision', { approved: true }, 'A person approved the call.'],
    [
      'agentfootprint.middleware.decision',
      { outcome: 'allow', personApproved: true },
      'A person approved the call.',
    ],
    [
      'agentfootprint.middleware.decision',
      { phase: 'resume', outcome: 'deny' },
      'A middleware rule refused the call after the wait.',
    ],
    [
      'agentfootprint.middleware.decision',
      { phase: 'resume', outcome: 'refused' },
      'The library refused the call after the wait.',
    ],
    [
      'agentfootprint.middleware.decision',
      { phase: 'resume', outcome: 'refused', why: 'second-question' },
      'The policy required a second human answer, so the library refused the call after the wait.',
    ],
    [
      'agentfootprint.middleware.decision',
      { phase: 'resume', outcome: 'refused', why: 'call-changed' },
      'The tool arguments changed after the wait, so the library refused the call.',
    ],
    [
      'agentfootprint.middleware.decision',
      {
        phase: 'resume',
        outcome: 'refused',
        why: 'The original before-tool policy is unavailable.',
      },
      'The library refused the call after the wait.',
    ],
    [
      'agentfootprint.middleware.decision',
      { phase: 'resume', outcome: 'refused', why: 'REDACTED' },
      'The library refused the call after the wait.',
    ],
    [
      'agentfootprint.middleware.decision',
      { phase: 'resume', outcome: 'deny', why: 'second-question' },
      'A middleware rule refused the call after the wait.',
    ],
    [
      'agentfootprint.permission.check',
      { phase: 'resume', result: 'deny' },
      'The permission policy refused the call after the wait.',
    ],
    [
      'agentfootprint.permission.check',
      { phase: 'resume', result: 'halt' },
      'The permission policy refused the call after the wait.',
    ],
  ])('describes the recorded approval or recheck for %s', (type, payload, sentence) => {
    const event = { type, payload, meta: {} } as AgentfootprintEvent;
    expect(defaultCommentaryTemplates[selectCommentaryKey(event)!]).toBe(sentence);
  });
});
