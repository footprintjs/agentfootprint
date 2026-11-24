import { describe, expect, it } from 'vitest';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { callTraceTool, traceToolpack, type TraceToolpackArtifacts } from '../../src/observe.js';

const id = 'reused';
const name = 'inventory';
const first = [15, 26, 37, 48, 0] as const;
const second = [15, 26, 37, 48, 1] as const;
const tool = { toolCallId: id, toolName: name };

function keyField(callOccurrenceKey?: readonly number[]) {
  return callOccurrenceKey === undefined ? {} : { callOccurrenceKey };
}

function proposal(label: string, key?: readonly number[]) {
  return { role: 'assistant', toolCalls: [{ id, name, args: { label }, ...keyField(key) }] };
}

function result(label: string, key?: readonly number[]) {
  return { role: 'tool', ...tool, content: `${label} items`, ...keyField(key) };
}

function start(stage: string, key?: readonly number[]): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.tool_start',
    payload: { ...tool, args: {}, ...keyField(key) },
    meta: { runId: stage, runtimeStageId: `tool-calls#${stage}` },
  } as AgentfootprintEvent;
}

function end(stage: string, durationMs: number, key?: readonly number[]): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.tool_end',
    payload: {
      ...tool,
      durationMs,
      entered: true,
      result: 'recorded on the event',
      ...keyField(key),
    },
    meta: { runId: stage, runtimeStageId: `tool-calls#${stage}` },
  } as AgentfootprintEvent;
}

function rewrite(label: string, key?: readonly number[]) {
  return {
    at: 'tool',
    moment: 'before-tool',
    iteration: 4,
    ...tool,
    middleware: `${label}-rewrite`,
    changed: true,
    outcome: 'allow',
    after: { label: `${label}-changed` },
    ...keyField(key),
  };
}

function inspect(
  history: readonly object[],
  events: readonly AgentfootprintEvent[] | undefined,
  middlewareDecisions: readonly unknown[] = [],
  showWithheldResults = false,
  servedUnderPolicy = false,
) {
  const snapshot = {
    ...(servedUnderPolicy && { recorders: [{ id: 'agentfootprint.redaction' }] }),
    commitLog: [
      {
        idx: 0,
        stage: 'Tool calls',
        stageId: 'tool-calls',
        runtimeStageId: 'tool-calls#4',
        trace: [
          { path: 'history', verb: 'set' },
          { path: 'middlewareDecisions', verb: 'set' },
        ],
        overwrite: { history, middlewareDecisions },
        updates: {},
      },
    ],
    executionTree: {},
    commitValues: 'full',
  } as unknown as TraceToolpackArtifacts['snapshot'];
  const saved = JSON.parse(
    JSON.stringify({ snapshot, ...(events !== undefined && { events }) }),
  ) as TraceToolpackArtifacts;
  return callTraceTool(traceToolpack(saved, { showWithheldResults }), 'inspect_tool_call', {
    toolCallId: id,
  });
}

describe('inspect_tool_call from keyed saved recordings', () => {
  it('keeps the same text for one complete call with or without a key', async () => {
    const inspectOne = (key?: readonly number[]) =>
      inspect(
        [proposal('one', key), result('one', key)],
        [
          start('4', key),
          end('4', 12, key),
          {
            type: 'agentfootprint.agent.iteration_end',
            payload: { iterIndex: 4 },
            meta: { runId: '4', runtimeStageId: 'tool-calls#4' },
          } as AgentfootprintEvent,
        ],
        [rewrite('one', key)],
        true,
      );
    const keyed = await inspectOne(first);
    expect(keyed).toBe(await inspectOne());
    expect(keyed).toContain('"label":"one-changed"');
    expect(keyed).not.toContain('callOccurrenceKey');
  });

  it('reads only the selected call across reused IDs and two stage addresses', async () => {
    const out = await inspect(
      [
        proposal('older', first),
        result('older', first),
        proposal('later', second),
        result('later', second),
      ],
      [start('3', first), start('4', second), end('3', 2, first), end('5', 17, second)],
      [rewrite('later', second), rewrite('older', first)],
    );
    expect(out).toContain('step: tool-calls#4');
    expect(out).toContain('proposed by the model: {"label":"later"}');
    expect(out).toContain('"label":"later-changed"');
    expect(out).toContain('result: "later items"');
    expect(out).toContain('duration: 17ms');
    expect(out).not.toContain('older');
  });

  it('keeps the selected result separate when only a same-ID neighbour remains', async () => {
    const history = [proposal('neighbour', first), result('neighbour', first)];
    const events = [end('5', 17, second)];
    const decisions = [rewrite('neighbour', first)];
    expect(await inspect(history, events, decisions)).toBe('A result was kept out by a rule.');
    const out = await inspect(history, events, decisions, true);
    expect(out).toContain("no result for call 'reused' remains in the retained history");
    expect(out).toContain('the tool ran, but its result is not in the kept history');
    expect(out).not.toContain('neighbour');
  });

  it('reads a keyed result without an event tail but leaves its clock unknown', async () => {
    const out = await inspect([proposal('one', first), result('one', first)], undefined);
    expect(out).toContain('step: tool-calls#4');
    expect(out).toContain('result: "one items"');
    expect(out).toContain('duration: ⚠ unavailable');
  });

  it('takes no proposal, ledger or result from duplicate keyed event brackets', async () => {
    const out = await inspect(
      [proposal('one', first), result('one', first)],
      [start('3', first), end('4', 1, first), end('5', 17, first)],
      [rewrite('one', first)],
    );
    expect(out).toContain('proposed by the model: ⚠ not recorded');
    expect(out).toContain('result: ⚠ the recording cannot identify a unique result');
    expect(out).toContain('outcome: ⚠ unknown');
    expect(out).not.toContain('one items');
  });

  it('names the final after-tool changer from this occurrence only', async () => {
    const after = (label: string, key: readonly number[]) => ({
      ...rewrite(label, key),
      moment: 'after-tool',
      after: 'public summary',
    });
    const out = await inspect(
      [proposal('one', second), result('one', second)],
      [start('4', second), end('4', 0, second)],
      [after('foreign', first), after('inner', second), after('outer', second)],
      true,
    );
    expect(out).toContain('rewritten by: "outer-rewrite"');
    expect(out).not.toContain('rewritten by: "inner-rewrite"');
    expect(out).not.toContain('foreign-rewrite');
  });

  it.each([undefined, '[REDACTED]', ' \t'])(
    'does not substitute an earlier name for an unavailable final changer (%s)',
    async (middleware) => {
      const rows = [
        { ...rewrite('inner', second), moment: 'after-tool' },
        { ...rewrite('outer', second), moment: 'after-tool', middleware },
      ];
      const out = await inspect(
        [proposal('one', second), result('one', second)],
        [start('4', second), end('4', 0, second)],
        rows,
        true,
        middleware !== undefined,
      );
      expect(out).not.toContain('rewritten by:');
    },
  );

  it.each([
    ['null row', null],
    ['opaque row', '[REDACTED]'],
    ['absent final key', { ...rewrite('unplaced'), moment: 'after-tool' }],
    ['malformed final key', { ...rewrite('unplaced', [1]), moment: 'after-tool' }],
  ])('an unavailable %s cannot leave an earlier trace owner', async (_, row) => {
    const out = await inspect(
      [proposal('one', second), result('one', second)],
      [start('4', second), end('4', 0, second)],
      [{ ...rewrite('inner', second), moment: 'after-tool' }, row],
      true,
    );
    expect(out).toContain('result: "one items"');
    expect(out).not.toContain('rewritten by:');
  });

  it('a later bound trace owner survives an earlier null decision', async () => {
    const out = await inspect(
      [proposal('one', second), result('one', second)],
      [start('4', second), end('4', 0, second)],
      [null, { ...rewrite('final', second), moment: 'after-tool' }],
      true,
    );
    expect(out).toContain('rewritten by: "final-rewrite"');
    expect(out).toContain('result: "one items"');
  });
});
