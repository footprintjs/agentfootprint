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
});
