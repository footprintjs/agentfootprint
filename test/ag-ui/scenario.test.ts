/**
 * SCENARIOS — whole runs, read the way an AG-UI frontend reads them.
 *
 *   1. A full run with a tool call: the conversation the official client builds,
 *      and the ids lining up with agentfootprint's own record.
 *   2. A run that fails after doing work: the work stays, the run ends in
 *      RUN_ERROR in the record's own words.
 *   3. Subflows, sub-agents and a parallel fan-out — a pipeline whose first agent
 *      calls a footprintjs flowchart as a tool, then fans out to two agents in
 *      parallel that reuse the same tool-call id, then hands to a writer:
 *        · every nested turn is a SUBAGENT with the right parent links (no agent
 *          encloses another, so none names a parent agent; the composition step
 *          it runs in encloses its subflow path);
 *        · tool-call ids are unique across branches;
 *        · nothing a branch produced is attributed to its sibling;
 *      and the same pipeline under a redaction policy at every depth: nothing the
 *      policy hides reaches the wire, while the structure is unchanged.
 */

import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';

import { Agent, defineTool, flowchartAsTool, Parallel, Sequence } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { agUiSse } from '../../src/ag-ui/framing.js';
import { AG_UI_RUN_FAILED, AG_UI_TOOL_FAILED } from '../../src/ag-ui/serializer.js';
import type { AgUiEvent } from '../../src/ag-ui/types.js';
import { replayThroughClient, runAsAgUi } from './helpers.js';

const only = <T extends AgUiEvent['type']>(events: readonly AgUiEvent[], type: T) =>
  events.filter((e): e is Extract<AgUiEvent, { type: T }> => e.type === type);

const call = (name: string, id: string, args: Record<string, unknown>, said = 'Let me check.') => ({
  content: said,
  toolCalls: [{ id, name, args }],
});

const lookup = defineTool({
  name: 'lookup',
  description: 'Look a city up.',
  inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
  execute: async (args: { city?: string }) => `facts about ${args.city}`,
});

describe('scenario — a full run with a tool call', () => {
  it('reaches the client as the conversation, with ids that line up with the record', async () => {
    const agent = Agent.create({
      provider: mock({
        chunkDelayMs: 0,
        replies: [call('lookup', 'toolu_01', { city: 'Lyon' }), 'Lyon has 520k people.'],
      }),
      model: 'm',
    })
      .system('Answer from the tool.')
      .tool(lookup)
      .build();
    const run = await runAsAgUi(
      agent,
      { message: 'How big is Lyon?' },
      { threadId: 'chat-7', runId: 'ag-1' },
    );
    const client = await replayThroughClient(run.events, 'chat-7');

    expect(client.messages).toMatchObject([
      {
        role: 'assistant',
        content: 'Let me check.',
        toolCalls: [
          { type: 'function', function: { name: 'lookup', arguments: '{"city":"Lyon"}' } },
        ],
      },
      { role: 'tool', content: 'facts about Lyon' },
      { role: 'assistant', content: 'Lyon has 520k people.' },
    ]);
    expect(client.result.result).toBe('Lyon has 520k people.');

    // The run: AG-UI's ids from the request. agentfootprint's own run id counts
    // every run the process made, so it never goes out.
    const recordRunId = run.served[0]!.meta.runId;
    expect(run.events[0]).toMatchObject({ type: 'RUN_STARTED', threadId: 'chat-7', runId: 'ag-1' });
    expect(JSON.stringify(run.events)).not.toContain(recordRunId);

    // The tool call: the provider's id rides metadata; the AG-UI id is the call's
    // address in the record, the stage execution that ran it.
    const start = only(run.events, 'TOOL_CALL_START')[0]!;
    const toolStart = run.served.find((e) => e.type === 'agentfootprint.stream.tool_start')!;
    expect(start.metadata?.agentfootprint?.toolCallId).toBe('toolu_01');
    expect(start.toolCallId).toBe(`ag-1/tool/0/${toolStart.meta.runtimeStageId}`);
    const [tool] = client.messages.filter((m) => m.role === 'tool');
    expect(tool).toMatchObject({ toolCallId: start.toolCallId });

    // The messages: each is its LLM call's stage execution.
    const llmStarts = run.served.filter((e) => e.type === 'agentfootprint.stream.llm_start');
    expect(client.messages.filter((m) => m.role === 'assistant').map((m) => m.id)).toEqual(
      llmStarts.map((e) => `ag-1/text/0/${e.meta.runtimeStageId}`),
    );
  });
});

describe('scenario — a run that fails', () => {
  it('keeps the work it did and ends in RUN_ERROR, never quoting the thrown message', async () => {
    let calls = 0;
    const flaky = {
      name: 'flaky',
      complete: async () => {
        calls += 1;
        if (calls === 1)
          return {
            content: '',
            toolCalls: [{ id: 't1', name: 'lookup', args: { city: 'Oslo' } }],
            usage: { input: 1, output: 1 },
            stopReason: 'tool_use',
          };
        throw new Error('upstream 503');
      },
    };
    const agent = Agent.create({ provider: flaky as never, model: 'm' })
      .system('s')
      .tool(lookup)
      .build();
    const run = await runAsAgUi(agent, { message: 'Oslo?' });

    expect(run.error).toBeInstanceOf(Error);
    // The record quotes the thrown message; a browser is told only that the run failed.
    const fatal = run.served.find((e) => e.type === 'agentfootprint.error.fatal')!;
    expect((fatal.payload as { error: string }).error).toContain('upstream 503');
    const last = run.events.at(-1)!;
    expect(last).toMatchObject({ type: 'RUN_ERROR', message: AG_UI_RUN_FAILED });
    expect(JSON.stringify(run.events)).not.toContain('upstream 503');
    expect(only(run.events, 'RUN_FINISHED')).toEqual([]);

    const client = await replayThroughClient(run.events);
    expect(client.messages).toMatchObject([
      { role: 'assistant', toolCalls: [{ function: { name: 'lookup' } }] },
      { role: 'tool', content: 'facts about Oslo' },
    ]);
  });
});

describe('scenario — subflows, sub-agents and a parallel fan-out', () => {
  const SECRETS = [
    'Zurich',
    'Basel',
    'Geneva',
    'ssn-123-45-6789',
    'the-intake-note',
    'a-writer-answer',
  ];

  /** The footprintjs subflow: a flowchart the intake agent calls as one tool. */
  const intakeChart = flowChart<{ note: string }>(
    'Intake',
    async (scope) => {
      scope.note = 'the-intake-note';
      return 'the-intake-note';
    },
    'intake',
  ).build();
  const intakeTool = flowchartAsTool({
    name: 'intake',
    description: 'Run the intake procedure.',
    inputSchema: { type: 'object', properties: { ssn: { type: 'string' } } },
    flowchart: intakeChart,
  });

  function pipeline(redact?: {
    readonly keys: readonly string[];
    readonly patterns?: readonly RegExp[];
  }) {
    const agent = (replies: unknown[], ...tools: ReturnType<typeof defineTool>[]) => {
      const builder = Agent.create({
        provider: mock({ chunkDelayMs: 0, replies: replies as never }),
        model: 'm',
        ...(redact !== undefined && { redact }),
      }).system('s');
      for (const t of tools) builder.tool(t);
      return builder.build();
    };
    const intake = agent(
      [call('intake', 'c1', { ssn: 'ssn-123-45-6789' }), 'Intake done for Zurich.'],
      intakeTool,
    );
    const legal = agent([call('lookup', 'c1', { city: 'Basel' }), 'Basel is fine.'], lookup);
    const finance = agent([call('lookup', 'c1', { city: 'Geneva' }), 'Geneva is fine.'], lookup);
    const writer = agent(['a-writer-answer']);
    const research = Parallel.create()
      .branch('legal', legal)
      .branch('finance', finance)
      .mergeWithFn((r) => `${r.legal} ${r.finance}`)
      .build();
    return Sequence.create()
      .step('intake', intake)
      .step('research', research)
      .step('answer', writer)
      .build();
  }

  const subflowOf = (e: AgUiEvent): readonly string[] | undefined =>
    e.metadata?.agentfootprint?.subflowPath;
  const leads = (prefix: readonly string[], path: readonly string[]) =>
    prefix.every((s, i) => path[i] === s);

  async function checkStructure(events: readonly AgUiEvent[]) {
    const started = only(events, 'SUBAGENT_STARTED');
    // Every nested turn is a sub-agent, named by its mount; no agent encloses another.
    expect(started.map((e) => e.name)).toEqual([
      'step-intake',
      'step-research/legal',
      'step-research/finance',
      'step-answer',
    ]);
    expect(started.every((e) => e.parentSubagentRunId === undefined)).toBe(true);
    const handle = Object.fromEntries(started.map((e) => [e.name, e.subagentRunId]));

    // Parent links: the composition step a sub-agent runs in encloses its subflow path,
    // and is open across the sub-agent's whole life.
    const parallelStep = only(events, 'STEP_STARTED').find(
      (e) => e.stepName === 'Parallel:step-research',
    )!;
    for (const branch of ['step-research/legal', 'step-research/finance']) {
      const sub = started.find((e) => e.name === branch)!;
      expect(leads(subflowOf(parallelStep)!, subflowOf(sub)!)).toBe(true);
      const opened = events.indexOf(parallelStep);
      const closed = events.findIndex(
        (e) => e.type === 'STEP_FINISHED' && e.stepName === 'Parallel:step-research',
      );
      const subEnd = events.findIndex(
        (e) => e.type === 'SUBAGENT_FINISHED' && e.subagentRunId === sub.subagentRunId,
      );
      expect(opened).toBeLessThan(events.indexOf(sub));
      expect(subEnd).toBeLessThan(closed);
    }
    expect(only(events, 'STEP_STARTED')[0]!.stepName).toBe('Sequence');

    // No mis-attribution: every addressed event a sub-agent owns lies under its mount.
    for (const sub of started) {
      const mount = subflowOf(sub)!;
      for (const e of events) {
        if (
          !('subagentRunId' in e) ||
          e.subagentRunId !== sub.subagentRunId ||
          e.type === 'SUBAGENT_STARTED'
        )
          continue;
        const path = subflowOf(e);
        if (path !== undefined) expect(leads(mount, path), `${e.type} of ${sub.name}`).toBe(true);
      }
    }

    // Tool-call ids: unique across the run although three agents said `c1`.
    const calls = only(events, 'TOOL_CALL_START');
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((e) => e.toolCallId)).size).toBe(3);
    const results = only(events, 'TOOL_CALL_RESULT');
    expect(new Set(results.map((e) => e.messageId)).size).toBe(3);
    for (const result of results) {
      const owner = calls.find((c) => c.toolCallId === result.toolCallId)!;
      expect(result.subagentRunId).toBe(owner.subagentRunId);
    }

    // The official client accepts the stream and keeps each branch's messages apart.
    const client = await replayThroughClient(events);
    expect(client.warnings).toEqual([]);
    const ownersOf = (name: string) =>
      client.messages.filter(
        (m) => (m as { subagentRunId?: string }).subagentRunId === handle[name],
      );
    for (const name of ['step-intake', 'step-research/legal', 'step-research/finance']) {
      expect(ownersOf(name).map((m) => m.role)).toEqual(['assistant', 'tool', 'assistant']);
    }
    expect(ownersOf('step-answer').map((m) => m.role)).toEqual(['assistant']);
    return { handle, client };
  }

  it('maps parent links, keeps tool-call ids unique and never crosses branches', async () => {
    const run = await runAsAgUi(pipeline(), { message: 'Check Zurich' });
    expect(run.error).toBeUndefined();
    const { handle, client } = await checkStructure(run.events);

    const resultsOf = (name: string) =>
      client.messages
        .filter(
          (m) =>
            m.role === 'tool' && (m as { subagentRunId?: string }).subagentRunId === handle[name],
        )
        .map((m) => m.content);
    expect(resultsOf('step-research/legal')).toEqual(['facts about Basel']);
    expect(resultsOf('step-research/finance')).toEqual(['facts about Geneva']);
    // The footprintjs subflow's result, as the flowchart tool returned it.
    expect(resultsOf('step-intake')).toEqual(['{"note":"the-intake-note"}']);
    // Each branch's own record id, carried beside its unique AG-UI id.
    expect(
      only(run.events, 'TOOL_CALL_START').map((e) => e.metadata?.agentfootprint?.toolCallId),
    ).toEqual(['c1', 'c1', 'c1']);
  });

  it('under a redaction policy at every depth, nothing it hides reaches the wire; the structure holds', async () => {
    const run = await runAsAgUi(pipeline({ keys: ['city', 'ssn'], patterns: [/note/] }), {
      message: 'Check Zurich',
    });
    expect(run.error).toBeUndefined();
    await checkStructure(run.events);

    const framing = agUiSse();
    const wire = run.events.map((e, i) => framing.frame(e, { sequence: i + 1 })).join('');
    for (const secret of SECRETS) expect(wire, secret).not.toContain(secret);
    // What the policy hid is SAID to be hidden, not silently dropped.
    expect(wire).toContain('[REDACTED]');
  });
});

describe('scenario — a tool that throws', () => {
  it('reaches the client as a failed call, without the thrown text', async () => {
    const db = defineTool({
      name: 'db',
      description: 'Query the database.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        throw new Error('ECONNREFUSED postgres://admin:hunter2@db:5432');
      },
    });
    const agent = () =>
      Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          replies: [{ content: '', toolCalls: [{ id: 'q1', name: 'db', args: {} }] }, 'Sorry.'],
        }),
        model: 'm',
      })
        .system('s')
        .tool(db)
        .build();
    const run = await runAsAgUi(agent(), { message: 'count rows' });
    expect(run.served.some((e) => JSON.stringify(e).includes('hunter2'))).toBe(true); // the record has it
    expect(JSON.stringify(run.events)).not.toContain('hunter2');
    const client = await replayThroughClient(run.events);
    expect(client.messages.find((m) => m.role === 'tool')).toMatchObject({
      content: AG_UI_TOOL_FAILED,
    });
  });
});
