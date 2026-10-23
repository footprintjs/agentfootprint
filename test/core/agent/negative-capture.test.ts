import { describe, expect, it, vi } from 'vitest';
import type { TypedScope } from 'footprintjs';
import { absent } from '../../../src/semantics/coverage/absent.js';
import { defineTool, type Tool, type ToolExecutionContext } from '../../../src/tools/tools.js';
import { fromIdentity, hostFilled } from '../../../src/tools/hostFilled.js';
import type { AgentState } from '../../../src/core/agent/types.js';
import {
  captureNegativeResult,
  createNegativeRuntimeState,
  negativeRecordOf,
  serveNegativeHandle,
  settleNegativeCall,
  startNegativeCall,
  pauseNegativeCall,
  pausedNegativeResultId,
  captureNegativeRefusal,
} from '../../../src/core/agent/negativeClaims/capture.js';

const privacy = vi.hoisted(() => ({ kept: false, key: '' }));
vi.mock('../../../src/redaction/runRedaction.js', () => ({
  runKeepsOut: (_scope: unknown, key: string) => privacy.kept || key === privacy.key,
}));

const identity = {
  tenant: 'synthetic-tenant',
  principal: 'synthetic-person',
  conversationId: 'synthetic-conversation',
};
const schema = {
  type: 'object',
  properties: { item: { type: 'string' }, tenant: { type: 'string' } },
};
const toolOf = (options: { search?: boolean; read?: boolean } = {}): Tool =>
  defineTool({
    name: 'lookup',
    description: 'Synthetic lookup.',
    inputSchema: schema,
    ...(options.read && { effects: 'read' as const }),
    ...(options.search && {
      search: {
        source: { what: 'the synthetic inventory', said: ['inventory'] },
        subject: { what: 'items', said: ['items'] },
        arguments: [
          { name: 'item', role: 'population' as const },
          { name: 'tenant', role: 'filter' as const },
        ],
        complete: 'within-arguments' as const,
      },
    }),
    execute: () => [],
  });
const scopedTool = (search = false) =>
  hostFilled(toolOf({ search }), { tenant: fromIdentity('tenant') });
function scopeOf() {
  privacy.kept = false;
  privacy.key = '';
  const values: Record<string, unknown> = {
    turnNumber: 1,
    turnStartMs: Date.parse('2026-01-01T00:00:00Z'),
    runIdentity: structuredClone(identity),
    negativeClaimState: createNegativeRuntimeState(1, identity),
  };
  values.$getValue = (key: string) => values[key];
  return values as unknown as TypedScope<AgentState>;
}
function dispatch(
  scope: TypedScope<AgentState>,
  tool: Tool = scopedTool(),
  over: Record<string, unknown> = {},
) {
  return startNegativeCall(scope, {
    tool,
    args: { item: 'ITEM-A' },
    toolCallId: 'call-1',
    iteration: 1,
    runId: 'run-1',
    context: { identity, time: { dispatchedAt: '2026-01-01T00:00:00Z' } } as ToolExecutionContext,
    ...over,
  });
}

describe('negative runtime evidence capture', () => {
  it('publishes a reserved, pending dispatched attempt before its result exists', () => {
    const scope = scopeOf();
    const started = dispatch(scope);
    expect(scope.negativeClaimState?.pending).toEqual([started.resultId]);
    expect(scope.negativeClaimState?.calls[0]).toMatchObject({
      dispatched: true,
      outcome: 'error',
      batch: 1,
      turn: 1,
    });
    expect(negativeRecordOf(scope).ledgerComplete).toBe(false);
    settleNegativeCall(scope, scope.negativeClaimState?.calls[0].resultId, 'error');
    expect(negativeRecordOf(scope).ledgerComplete).toBe(true);
    expect(negativeRecordOf(scope).calls[0]?.outcome).toBe('error');
  });

  it('keeps sent arguments and native rows detached from later mutation', () => {
    const scope = scopeOf();
    const args = { item: 'ITEM-A' };
    const tool = scopedTool(true);
    const started = dispatch(scope, tool, { args });
    args.item = 'ITEM-B';
    const rows = [{ entity: 'ITEM-A', status: 'open' }];
    captureNegativeResult(scope, started, rows, tool);
    rows[0].entity = 'ITEM-B';
    settleNegativeCall(scope, scope.negativeClaimState?.calls[0].resultId, 'ok');
    const call = negativeRecordOf(scope).calls[0];
    expect(call.arguments.item).toBe('ITEM-A');
    expect(call.rowsRead).toEqual([{ entity: 'ITEM-A', status: 'open' }]);
    expect(call.rows).toBe(1);
    expect(call.emptiness).toBe('non-empty');
  });

  it('records the executed search scope even when the read throws', () => {
    const scope = scopeOf();
    dispatch(scope, scopedTool(true), { args: { item: 'rewritten-item' } });
    settleNegativeCall(scope, scope.negativeClaimState?.calls[0].resultId, 'error');
    expect(negativeRecordOf(scope).calls[0].scope).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ facet: 'population', value: 'rewritten-item' }),
        expect.objectContaining({ facet: 'filter', from: 'host', value: { identity: 'tenant' } }),
      ]),
    );
    expect(JSON.stringify(negativeRecordOf(scope).calls)).not.toContain(identity.tenant);
  });

  it('trusts only identity fills with a nonempty value equal to this run identity', () => {
    const scope = scopeOf();
    dispatch(scope);
    expect(scope.negativeClaimState?.calls[0].trustedContext).toBe(true);
    dispatch(scope, scopedTool(), {
      toolCallId: 'different',
      context: { identity: { ...identity, tenant: 'other' } },
    });
    expect(scope.negativeClaimState?.calls[1].trustedContext).toBe(false);
    dispatch(scope, toolOf(), { toolCallId: 'not-host-filled' });
    expect(scope.negativeClaimState?.calls[2].trustedContext).toBe(false);
  });

  it('never exempts hand-set effects or remote read declarations from writes', () => {
    const scope = scopeOf();
    dispatch(scope, { ...toolOf(), effects: 'read' });
    dispatch(scope, toolOf({ read: true }), { toolCallId: 'declared' });
    dispatch(scope, toolOf({ read: true }), {
      toolCallId: 'remote',
      party: { channel: 'provider', id: 'synthetic' },
    });
    dispatch(scope, hostFilled(toolOf({ read: true }), { tenant: fromIdentity('tenant') }), {
      toolCallId: 'wrapped',
    });
    dispatch(
      scope,
      hostFilled({ ...toolOf(), effects: 'read' }, { tenant: fromIdentity('tenant') }),
      { toolCallId: 'forged-wrap' },
    );
    expect(scope.negativeClaimState?.calls.map((c) => c.effect)).toEqual([
      'not-read',
      'read',
      'not-read',
      'read',
      'not-read',
    ]);
  });

  it('binds standalone among to the executed argument and keeps every partial gap', () => {
    const scope = scopeOf();
    const tool = scopedTool();
    const started = dispatch(scope, tool);
    const value = absent({
      what: 'ITEM-A',
      among: {
        argument: 'item',
        source: 'synthetic inventory',
        measuredAt: '2026-01-01T00:00:00Z',
        count: 1,
        names: ['SYNTHETIC-SECRET-NAME'],
        partial: true,
      },
    });
    captureNegativeResult(scope, started, value, tool);
    settleNegativeCall(scope, scope.negativeClaimState?.calls[0].resultId, 'ok');
    const row = scope.negativeClaimState?.calls[0].row;
    expect(row?.checked).toEqual(
      expect.arrayContaining([expect.objectContaining({ facet: 'population', value: 'ITEM-A' })]),
    );
    expect(row?.gaps).toHaveLength(2);
    expect(serveNegativeHandle(scope, started.resultId, 'summary')).toContain(started.handle);
    expect(serveNegativeHandle(scope, started.resultId, 'summary')).toContain('not every name');
    expect(JSON.stringify(scope.negativeClaimState)).not.toContain('SYNTHETIC-SECRET-NAME');
  });

  it('does not bind an among result to a different looked-for value', () => {
    const scope = scopeOf();
    const tool = scopedTool();
    const started = dispatch(scope, tool);
    captureNegativeResult(
      scope,
      started,
      absent({
        what: 'ITEM-B',
        among: {
          argument: 'item',
          source: 'synthetic inventory',
          measuredAt: '2026-01-01T00:00:00Z',
          count: 0,
        },
      }),
      tool,
    );
    expect(scope.negativeClaimState?.calls[0].row).toBeUndefined();
    expect(serveNegativeHandle(scope, started.resultId, 'summary')).toBe('summary');
  });

  it('does not turn a human answer or an unresolved attempt into successful evidence', () => {
    const scope = scopeOf();
    dispatch(scope);
    settleNegativeCall(scope, scope.negativeClaimState?.calls[0].resultId, 'ok');
    expect(scope.negativeClaimState?.calls[0].outcome).toBe('error');
    expect(scope.negativeClaimState?.calls[0].row).toBeUndefined();
  });

  it('fails closed when privacy keeps out the capture and never stores the payload', () => {
    const scope = scopeOf();
    privacy.kept = true;
    const tool = scopedTool(true);
    const started = dispatch(scope, tool);
    captureNegativeResult(scope, started, [{ entity: 'PRIVATE-PAYLOAD' }], tool);
    expect(scope.negativeClaimState?.tools.lookup.search).toBeUndefined();
    expect(scope.negativeClaimState?.calls[0].keptOut).toBe(true);
    expect(JSON.stringify(scope.negativeClaimState)).not.toContain('PRIVATE-PAYLOAD');
  });

  it('does not retain native rows whose keys are redacted', () => {
    const scope = scopeOf();
    const tool = scopedTool();
    const started = dispatch(scope, tool);
    privacy.key = 'entity';
    captureNegativeResult(scope, started, [{ entity: 'private-row' }], tool);
    expect(scope.negativeClaimState?.calls[0].keptOut).toBe(true);
    expect(JSON.stringify(scope.negativeClaimState)).not.toContain('private-row');
  });

  it('binds duplicate provider ids to native occurrences across a resumed leg', () => {
    const scope = scopeOf();
    const tool = scopedTool();
    const first = dispatch(scope, tool, { toolCallId: '' });
    const second = dispatch(scope, tool, { toolCallId: '' });
    pauseNegativeCall(scope, second.resultId);
    const saved = JSON.parse(JSON.stringify(scope.negativeClaimState));
    scope.negativeClaimState = saved;
    expect(pausedNegativeResultId(scope)).toBe(second.resultId);
    settleNegativeCall(scope, second.resultId, 'error');
    expect(scope.negativeClaimState?.pending).toEqual([first.resultId]);
    const third = dispatch(scope, tool, { toolCallId: '', runId: 'run-2' });
    captureNegativeResult(
      scope,
      third,
      absent({
        what: 'ITEM-A',
        among: {
          argument: 'item',
          source: 'synthetic inventory',
          measuredAt: '2026-01-01T00:00:00Z',
          count: 0,
        },
      }),
      tool,
    );
    settleNegativeCall(scope, third.resultId, 'ok');
    expect(serveNegativeHandle(scope, first.resultId, 'text')).toBe('text');
    expect(serveNegativeHandle(scope, second.resultId, 'text')).toBe('text');
    expect(serveNegativeHandle(scope, third.resultId, 'text')).toContain(third.handle);
    expect(scope.negativeClaimState?.pending).toEqual([first.resultId]);
    settleNegativeCall(scope, first.resultId, 'error');
    expect(negativeRecordOf(scope).ledgerComplete).toBe(true);
  });

  it('files refusal overclaims without manufacturing a dispatched read or copying the refusal', () => {
    const scope = scopeOf();
    captureNegativeRefusal(scope, 'lookup', 'ITEM-A does not exist.', { item: 'ITEM-A' });
    expect(scope.negativeClaimState?.overclaims).toEqual([
      { tool: 'lookup', code: 'refusal-asserts-absence', turn: 1 },
    ]);
    expect(negativeRecordOf(scope).calls).toEqual([]);
    expect(JSON.stringify(scope.negativeClaimState)).not.toContain('does not exist');
  });

  it('uses the recorded turn start when the time layer is unarmed', () => {
    expect(negativeRecordOf(scopeOf()).clock).toBe('2026-01-01T00:00:00.000Z');
  });

  it('keeps same-owner earlier turns but refuses another owner', () => {
    const scope = scopeOf();
    dispatch(scope);
    settleNegativeCall(scope, scope.negativeClaimState?.calls[0].resultId, 'error');
    const prior = scope.negativeClaimState;
    const next = createNegativeRuntimeState(2, identity, prior);
    expect(next.calls[0].turn).toBe(1);
    expect(createNegativeRuntimeState(2, { ...identity, tenant: 'other' }, prior).calls).toEqual(
      [],
    );
    scope.runIdentity = { ...identity, tenant: 'other' };
    expect(negativeRecordOf(scope).ledgerComplete).toBe(false);
    expect(negativeRecordOf(scope).calls).toEqual([]);
  });
});
