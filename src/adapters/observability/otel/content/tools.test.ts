import { describe, expect, it } from 'vitest';
import { createToolContent } from './tools.js';
import type { TurnState } from '../turns/state.js';

const turn = (): TurnState => ({
  stack: [], sampled: true, toolSpans: new Map(),
  toolNames: new Map(), proposedArgs: new Map(), standingEvents: 0, standingOmitted: 0
});

describe('OTel proposal capture', () => {
  it('keeps the proposal snapshot, withholds changed keys, and exports only the model-read result', () => {
    const content = createToolContent(1024, new Set());
    const t = turn(); const args = { account: 'original', key: 'old' };
    t.proposedArgs.set('call', content.snapshotArgs('lookup', args));
    args.account = 'later private mutation'; args.key = 'new secret';
    expect(content.toolContent(t, {
      toolCallId: 'call', changedArgKeys: ['key', 'added'],
      result: { secret: 'raw' }, modelResult: { safe: true }
    }, false)).toEqual({
      'gen_ai.tool.call.arguments': '{"account":"original","key":"REDACTED","added":"REDACTED"}',
      'gen_ai.tool.call.result': '{"safe":true}',
    });
    expect(t.proposedArgs.has('call')).toBe(false);
  });

  it('sees a runner registered after capture, and deletes failed proposals without content', () => {
    const runners = new Set<string>(); const content = createToolContent(1024, runners);
    const t = turn(); t.proposedArgs.set('call', content.snapshotArgs('runner', { code: 'private program' }));
    runners.add('runner');
    expect(content.toolContent(t, { toolCallId: 'call', result: 'ok' }, false)).toEqual({
      'agentfootprint.tool.args.withheld': 'code-runner', 'agentfootprint.tool.result.content': 'ok',
    });
    t.proposedArgs.set('failed', content.snapshotArgs('lookup', { secret: 'x' }));
    expect(content.toolContent(t, { toolCallId: 'failed', result: 'private' }, true)).toEqual({});
    expect(t.proposedArgs.size).toBe(0);
  });
});
