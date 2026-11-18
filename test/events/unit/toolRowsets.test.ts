import { RedactionRule } from 'footprintjs/advanced';
import { describe, expect, it } from 'vitest';
import { ALL_EVENT_TYPES, EVENT_NAMES } from '../../../src/events/registry.js';
import type { ToolRowsetCheckedPayload } from '../../../src/events/payloads.js';
import { eventServing } from '../../../src/redaction/served.js';
import type { AgentfootprintEvent } from '../../../src/events.js';
import {
  defaultCommentaryTemplates,
  selectCommentaryKey,
  renderCommentary,
} from '../../../src/recorders/observability/commentary/commentaryTemplates.js';

const payload: ToolRowsetCheckedPayload = {
  toolName: 'PRIVATE-TOOL',
  toolCallId: 'PRIVATE-CALL',
  iteration: 4,
  rowset: 'PRIVATE-ROWSET',
  source: 'published-dataset',
  disposition: 'unavailable',
  reason: 'source-over-bound',
  delivery: 'refused',
};

describe('native rowset availability event contract', () => {
  it('registers once in the existing tools domain with only static accounting fields', () => {
    expect(EVENT_NAMES.tools.rowsetChecked).toBe('agentfootprint.tools.rowset_checked');
    expect(ALL_EVENT_TYPES.filter((type) => type === EVENT_NAMES.tools.rowsetChecked)).toHaveLength(
      1,
    );
    expect(Object.keys(payload).sort()).toEqual(
      [
        'toolName',
        'toolCallId',
        'iteration',
        'rowset',
        'source',
        'disposition',
        'reason',
        'delivery',
      ].sort(),
    );
  });

  it('renders the existing commentary route as fixed prose without interpolating private values', () => {
    const type = EVENT_NAMES.tools.rowsetChecked;
    const key = selectCommentaryKey({ type, payload, meta: {} } as AgentfootprintEvent);
    expect(key).toBe(`event.${type}`);
    const prose = renderCommentary(defaultCommentaryTemplates[key!]!, {
      toolName: payload.toolName,
      rowset: payload.rowset,
      error: 'PRIVATE-ERROR',
    });
    expect(prose).toBe("The run recorded a declared rowset's availability and check status.");
    expect(prose).not.toContain('PRIVATE-');
  });

  it('native serving retains finite verdicts while keeping private names out of records', () => {
    const rule = new RedactionRule({ keys: ['capacity_gb'] });
    const served = eventServing(() => rule, true).payload(EVENT_NAMES.tools.rowsetChecked, payload);
    expect(served).toMatchObject({
      iteration: 4,
      source: 'published-dataset',
      disposition: 'unavailable',
      reason: 'source-over-bound',
      delivery: 'refused',
    });
    expect(JSON.stringify(served)).not.toContain('PRIVATE-');
    expect(payload.rowset).toBe('PRIVATE-ROWSET');
  });
});
