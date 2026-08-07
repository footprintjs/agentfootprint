/**
 * The `cost.limit_hit` line tells the truth about what happened next (8.14.0).
 *
 * Through 8.13.0 it read:
 *
 *     '{{appName}} hit a cost limit and stopped.'
 *
 * and the run had not stopped. `costBudget` was warn-only: `emitCostTick`
 * emitted `action: 'warn'` and the loop carried straight on. Every agent with
 * a cost limit narrated a halt that never happened — the library's own prose
 * contradicting the library's own event payload.
 *
 * Now the outcome is read OFF the payload, so the two cannot disagree.
 *
 * ## One key, not two
 *
 * The obvious shape was `cost.limit_hit.warn` / `.halt` — key-suffix branching
 * is the documented pattern in this file. It is not what shipped, because
 * consumers override templates BY KEY: moving the key would have left every
 * existing `'cost.limit_hit'` override silently unconsulted. The branch lives
 * in a pre-rendered `outcome` clause instead (the `descClause` precedent),
 * so an 8.13 override still resolves.
 */

import { describe, expect, it } from 'vitest';

import {
  defaultCommentaryTemplates,
  extractCommentaryVars,
  renderCommentary,
  selectCommentaryKey,
} from '../../../../src/recorders/observability/commentary/commentaryTemplates.js';
import type { AgentfootprintEvent } from '../../../../src/events/registry.js';

function limitHit(payload: {
  kind: 'max_tokens' | 'max_cost' | 'max_iterations' | 'max_wallclock';
  limit: number;
  actual: number;
  action: 'abort' | 'warn' | 'degrade';
}): AgentfootprintEvent {
  return {
    type: 'agentfootprint.cost.limit_hit',
    payload,
    meta: {},
  } as unknown as AgentfootprintEvent;
}

function line(event: AgentfootprintEvent): string {
  const key = selectCommentaryKey(event);
  expect(typeof key).toBe('string');
  const vars = extractCommentaryVars(event, { appName: 'Acme' });
  return renderCommentary(defaultCommentaryTemplates[key as string] ?? '', vars);
}

describe('cost.limit_hit commentary — truthful in both directions', () => {
  it('a WARN-only cost budget does not claim the run stopped', () => {
    const text = line(limitHit({ kind: 'max_cost', limit: 0.5, actual: 0.62, action: 'warn' }));
    expect(text).toContain('Acme');
    expect(text).toContain('cost limit');
    expect(text).toContain('carried on');
    // The 8.13.0 sentence, and the whole finding.
    expect(text).not.toContain('and stopped');
  });

  it('a HALTING cost budget does say the run stopped', () => {
    const text = line(limitHit({ kind: 'max_cost', limit: 0.5, actual: 0.62, action: 'abort' }));
    expect(text).toContain('cost limit');
    expect(text).toContain('the run stopped');
  });

  it('reads correctly for the iteration limit too, which always stops', () => {
    const text = line(limitHit({ kind: 'max_iterations', limit: 10, actual: 10, action: 'abort' }));
    expect(text).toContain('iteration limit');
    expect(text).toContain('the run stopped');
    expect(text).not.toContain('cost limit');
  });

  it('names the other two kinds rather than calling everything a cost limit', () => {
    expect(line(limitHit({ kind: 'max_tokens', limit: 1, actual: 2, action: 'warn' }))).toContain(
      'token limit',
    );
    expect(
      line(limitHit({ kind: 'max_wallclock', limit: 1, actual: 2, action: 'warn' })),
    ).toContain('time limit');
  });

  it('carries the numbers, so the line is checkable against the payload', () => {
    const text = line(limitHit({ kind: 'max_cost', limit: 0.5, actual: 0.62, action: 'warn' }));
    expect(text).toContain('0.62');
    expect(text).toContain('0.5');
  });

  it('the KEY is unchanged — an 8.13 override still resolves', () => {
    // The compatibility guarantee, asserted as a key rather than as prose.
    const key = selectCommentaryKey(
      limitHit({ kind: 'max_cost', limit: 1, actual: 2, action: 'warn' }),
    );
    expect(key).toBe('cost.limit_hit');
    expect(defaultCommentaryTemplates['cost.limit_hit']).toBeDefined();
  });

  it('a consumer override of the base key wins, exactly as before', () => {
    const event = limitHit({ kind: 'max_cost', limit: 1, actual: 2, action: 'abort' });
    const templates = {
      ...defaultCommentaryTemplates,
      'cost.limit_hit': 'BRAND: {{appName}} — {{outcome}}.',
    };
    const vars = extractCommentaryVars(event, { appName: 'Acme' }, templates);
    expect(renderCommentary(templates['cost.limit_hit'], vars)).toBe(
      'BRAND: Acme — the run stopped there.',
    );
  });
});
