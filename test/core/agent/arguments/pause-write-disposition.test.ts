/** Native input pauses are no-result encounters, not dead write checkers. */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  askHuman,
  defineTool,
  isPaused,
  type AgentfootprintEvent,
  type AgentOutput,
  type RunnerPauseOutcome,
  type AwaitingInput,
  type LLMResponse,
} from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';

const TOOL = 'read_vm_disks';
const question = 'Read disks for VM fixture-vm-a.';
const untraced = { id: 'untraced-disks', name: TOOL, args: { vm: 'fixture-vm-a' } };
const traced = {
  id: 'verified-disks',
  name: TOOL,
  args: {
    vm: 'fixture-vm-a',
    _findings: { basis: 'direct', from: [{ argument: 'vm', source: 'user', quote: question }] },
  },
};
const payload = (event: AgentfootprintEvent) => event.payload as unknown as Record<string, unknown>;

function fixture(
  options: {
    empty?: boolean;
    columns?: boolean;
    mixed?: boolean;
    previousResult?: boolean;
    verified?: boolean;
    multiple?: boolean;
    toolPause?: boolean;
  } = {},
) {
  const events: AgentfootprintEvent[] = [];
  const executed: string[] = [];
  const diskTool = (name: string) =>
    defineTool({
      name,
      description: 'Read synthetic VM disks.',
      inputSchema: { type: 'object', properties: { vm: { type: 'string' } }, required: ['vm'] },
      argumentsFrom: ['inventory'],
      resultColumns: { capacity_gb: 'number' },
      askOrAssume: { vm: { ask: 'Which VM should I read?' } },
      execute(args) {
        executed.push(String(args.vm));
        return [{ capacity_gb: options.previousResult ? 'wrong-type' : 0 }];
      },
    });
  const work = defineTool({
    name: 'route_work',
    description: 'Synthetic routing work.',
    execute() {
      executed.push('route_work');
      return 'ready';
    },
  });
  const ownPause = defineTool({
    name: 'ask_plain',
    description: 'Pause from inside an executed tool.',
    execute: () => askHuman({ question: 'Continue?' }),
  });
  const requested = options.verified ? traced : untraced;
  let calls: LLMResponse['toolCalls'] = [requested];
  if (options.toolPause) calls = [traced, { id: 'plain-pause', name: 'ask_plain', args: {} }];
  else if (options.multiple)
    calls = [untraced, { ...untraced, id: 'untraced-disks-2', name: 'read_backup_disks' }];
  else if (options.mixed) calls = [{ id: 'route', name: 'route_work', args: {} }, requested];
  const provider = mock({
    replies: [
      ...(options.previousResult ? [{ toolCalls: [traced] }] : []),
      { toolCalls: calls },
      'Finished.',
    ],
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 5,
    integrityPosture: 'dev',
    noticeEmptyLookups: options.empty ?? true,
    checkColumnTypes: options.columns ? 'warn' : 'off',
  })
    .tool(diskTool(TOOL))
    .tool(work);
  if (options.multiple) builder.tool(diskTool('read_backup_disks'));
  if (options.toolPause) builder.tool(ownPause);
  const agent = builder.findings({ argumentSources: true }).build();
  agent.on('*', (event) => events.push(event));
  return { agent, executed, events };
}

function paused(out: AgentOutput | RunnerPauseOutcome) {
  if (!isPaused(out)) throw new Error('Expected the actual native input pause.');
  return out;
}
function rowsOf(events: readonly AgentfootprintEvent[]) {
  const event = events.findLast((item) => item.type === 'agentfootprint.integrity.disposition');
  expect(event).toBeDefined();
  return payload(event!).rows as Record<string, unknown>[];
}
function rowFor(events: readonly AgentfootprintEvent[], check: string) {
  const row = rowsOf(events).find((item) => item.check === check && item.seam === 'write');
  expect(row).toBeDefined();
  return row!;
}

describe('failure-first: genuine undispatched argument asks reach native dev-posture pause', () => {
  it.each([
    { empty: true, columns: false, checks: ['empty-lookup'] },
    { empty: false, columns: true, checks: ['column-type-mismatch', 'missing-column'] },
    {
      empty: true,
      columns: true,
      mixed: true,
      checks: ['empty-lookup', 'column-type-mismatch', 'missing-column'],
    },
  ])('accounts only no-result encounters (%j)', async ({ checks, ...options }) => {
    const { agent, executed, events } = fixture(options);
    try {
      const out = paused(await agent.run(question));
      expect(out.checkpoint.pauseData).toHaveProperty('awaitingInput');
      expect(executed).toEqual([]); // The complete batch is held before dispatch.
      expect(agent.findings()).toContainEqual(
        expect.objectContaining({
          kind: 'argument',
          toolName: TOOL,
          toolCallId: 'untraced-disks',
          asked: 'unverified',
        }),
      );
      for (const check of checks)
        expect(rowFor(events, check)).toMatchObject({
          checked: 0,
          findings: 0,
          notApplicable: 1,
          unreachable: 0,
        });
      expect(
        events
          .filter((event) => event.type === 'agentfootprint.integrity.context_error')
          .some((event) =>
            ['column-type-mismatch', 'missing-column', 'empty-lookup'].includes(
              String(payload(event).kind),
            ),
          ),
      ).toBe(false);
    } finally {
      await agent.shutdown();
    }
  });
});

describe('completed-result and resume controls', () => {
  it('a partial reply holds both declared siblings through a genuine reask, then executes each once', async () => {
    const { agent, executed, events } = fixture({ columns: true, multiple: true });
    try {
      const first = paused(await agent.run(question));
      const input = (first.checkpoint.pauseData as { awaitingInput: AwaitingInput }).awaitingInput;
      expect(input.fields).toHaveLength(2);
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column'])
        expect(rowFor(events, check)).toMatchObject({ checked: 0, findings: 0, notApplicable: 2 });
      const second = paused(
        await agent.resume(first.checkpoint, {
          requestId: input.requestId,
          values: { [input.fields[0]!.id]: 'fixture-vm-first' },
        }),
      );
      expect(executed).toEqual([]);
      const next = (second.checkpoint.pauseData as { awaitingInput: AwaitingInput }).awaitingInput;
      // Partial replies are retained at the native resume door; no ToolCalls
      // pass is invented merely to file another disposition for that reply.
      expect(next.supplied).toMatchObject({ [input.fields[0]!.id]: 'fixture-vm-first' });
      expect(next.missing).toEqual([input.fields[1]!.id]);
      const beforeDone = events.length;
      expect(
        await agent.resume(second.checkpoint, {
          requestId: next.requestId,
          values: { [next.missing[0]!]: 'fixture-vm-second' },
        }),
      ).toBe('Finished.');
      expect(executed).toEqual(['fixture-vm-first', 'fixture-vm-second']);
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column'])
        expect(rowFor(events.slice(beforeDone), check)).toMatchObject({
          checked: 2,
          findings: 0,
          notApplicable: 1,
        });
    } finally {
      await agent.shutdown();
    }
  });

  it('does not relabel already executed writes when a later tool raises its own mid-batch pause', async () => {
    const { agent, executed, events } = fixture({ columns: true, toolPause: true });
    try {
      paused(await agent.run(question));
      expect(executed).toEqual(['fixture-vm-a']);
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column'])
        expect(rowFor(events, check)).toMatchObject({ checked: 1, findings: 0, notApplicable: 0 });
    } finally {
      await agent.shutdown();
    }
  });

  it('preserves a completed result finding and accounts the distinct still-undispatched call', async () => {
    const { agent, executed, events } = fixture({ previousResult: true, columns: true });
    try {
      paused(await agent.run(question));
      expect(executed).toEqual(['fixture-vm-a']);
      expect(rowFor(events, 'empty-lookup')).toMatchObject({
        checked: 1,
        findings: 0,
        notApplicable: 1,
      });
      expect(rowFor(events, 'column-type-mismatch')).toMatchObject({
        checked: 1,
        findings: 1,
        notApplicable: 1,
      });
      const mismatches = events.filter(
        (event) =>
          event.type === 'agentfootprint.integrity.context_error' &&
          payload(event).kind === 'column-type-mismatch',
      );
      expect(mismatches).toHaveLength(1);
      expect(payload(mismatches[0]!).message).toContain('verified-disks');
    } finally {
      await agent.shutdown();
    }
  });

  it('consumes the genuine native reply and checks its result once on resume', async () => {
    const { agent, executed, events } = fixture({ columns: true });
    try {
      const out = paused(await agent.run(question));
      const input = (out.checkpoint.pauseData as { awaitingInput: AwaitingInput }).awaitingInput;
      const before = events.length;
      expect(
        await agent.resume(out.checkpoint, {
          requestId: input.requestId,
          values: { [input.fields[0]!.id]: 'fixture-vm-confirmed' },
        }),
      ).toBe('Finished.');
      expect(executed).toEqual(['fixture-vm-confirmed']);
      const resumed = events.slice(before);
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column'])
        expect(rowFor(resumed, check)).toMatchObject({ checked: 1, findings: 0, notApplicable: 1 });
    } finally {
      await agent.shutdown();
    }
  });

  it('a verified ordinary call keeps its existing checked result and final no-call encounter counts', async () => {
    const { agent, executed, events } = fixture({ verified: true, columns: true });
    try {
      expect(await agent.run(question)).toBe('Finished.');
      expect(executed).toEqual(['fixture-vm-a']);
      for (const check of ['empty-lookup', 'column-type-mismatch', 'missing-column'])
        expect(rowFor(events, check)).toMatchObject({ checked: 1, findings: 0, notApplicable: 1 });
    } finally {
      await agent.shutdown();
    }
  });
});
