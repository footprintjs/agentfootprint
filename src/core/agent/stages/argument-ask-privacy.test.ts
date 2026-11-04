import { describe, expect, it } from 'vitest';
import {
  Agent,
  Sequence,
  defineTool,
  isInputPause,
  requestInput,
  type Tool,
} from '../../../index.js';
import { recordRun } from '../../../observe.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import { memorySessions, standingAgent } from '../../../hosting/index.js';
import { inProcessHost } from '../../../../test/hosting/testHost.js';
import {
  scripted,
  batch,
  answer,
  events,
  replyTo,
  stored,
  type Event,
} from '../../../../test/core/agent/arguments/askReviewHarness.js';

// ─── BLOCKING 2 — a hidden argument's answer reaches no surface ────────

describe('SECURITY — a hidden argument’s answer reaches no surface a viewer or a recording reads', () => {
  const SECRET = 'ACCT-99887766';

  function lookupAccount(ran: Record<string, unknown>[]): Tool {
    const tool = defineTool({
      name: 'lookup_account',
      description: 'Look an account up.',
      inputSchema: {
        type: 'object',
        properties: { account: { type: 'string' }, region: { type: 'string' } },
      },
      askOrAssume: { account: { ask: 'Which account number?' } },
      execute: async (args) => {
        ran.push({ ...args });
        return 'found';
      },
    });
    return {
      ...tool,
      [SHOWN_ARGS]: (args: Record<string, unknown>) =>
        'account' in args ? { ...args, account: 'REDACTED' } : args,
    } as never;
  }

  const script = () =>
    scripted([
      batch({ id: 'c1', name: 'lookup_account', args: { region: 'eu' } }),
      answer('Found it.'),
    ]);

  /** The resume event's reply: the shape travels, the value does not. */
  function expectRedactedResume(seen: readonly Event[]): void {
    const resumes = seen.filter((e) => e.type === 'agentfootprint.pause.resume');
    expect(resumes).toHaveLength(1);
    expect(resumes[0]!.payload.resumeInput).toMatchObject({ values: { f1: 'REDACTED' } });
  }

  it('direct resume: every event, the recording, the snapshot, the narrative, the rows, the served messages', async () => {
    const ran: Record<string, unknown>[] = [];
    const m = script();
    const agent = Agent.create({ provider: m.provider as never, model: 'm' })
      .tool(lookupAccount(ran))
      .build();
    const seen = events(agent);
    const recorder = recordRun(agent);
    const asked = await agent.run({ message: 'look my account up' });
    if (!isInputPause(asked)) throw new Error('expected the ask');
    const askContext = JSON.stringify(asked.awaitingInput);
    await agent.resume(stored(asked), replyTo(asked, { f1: SECRET }));
    // The positive control: the call DID run with the person's value.
    expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
    expectRedactedResume(seen);
    const surfaces: Record<string, string> = {
      events: JSON.stringify(seen),
      recording: JSON.stringify(recorder.toRecording()),
      snapshot: JSON.stringify(agent.getSnapshot() ?? {}),
      narrative: JSON.stringify(agent.getLastNarrativeEntries()),
      rows: JSON.stringify(agent.findings() ?? []),
      served: JSON.stringify(m.requests.map((r) => r.messages)),
      askContext,
    };
    recorder.stop();
    for (const [name, blob] of Object.entries(surfaces)) {
      expect(blob, `${name} carries the hidden answer`).not.toContain(SECRET);
    }
  });

  it.each(['direct', 'mounted'] as const)(
    'hidden answer remains absent after a later policy halt: %s',
    async (shape) => {
      const ran: Record<string, unknown>[] = [];
      const m = scripted([
        batch(
          { id: 'secret', name: 'lookup_account', args: { region: 'eu' } },
          { id: 'blocked', name: 'block', args: {} },
        ),
      ]);
      const agent = Agent.create({
        provider: m.provider as never,
        model: 'm',
        permissionChecker: {
          name: 'halt-later',
          check: ({ target }) =>
            target === 'block' ? { result: 'halt', reason: 'test:later' } : { result: 'allow' },
        },
      })
        .tool(lookupAccount(ran))
        .tool(
          defineTool({
            name: 'block',
            description: 'Must not run',
            inputSchema: { type: 'object' },
            execute: () => {
              throw new Error('unexpected tool entry');
            },
          }),
        )
        .build();
      const runner = shape === 'direct' ? agent : Sequence.create().step('ops', agent).build();
      const raw: unknown[] = [];
      runner.attach({
        id: 'privacy-halt',
        onRead: (event: unknown) => {
          raw.push(event);
        },
        onWrite: (event: unknown) => {
          raw.push(event);
        },
      });
      const seen = events(runner as never);
      const recorder = recordRun(runner);
      try {
        const asked = await runner.run({ message: 'look up' });
        if (!isInputPause(asked)) throw new Error('Expected argument ask');
        await expect(
          runner.resume(stored(asked), replyTo(asked, { f1: SECRET })),
        ).rejects.toMatchObject({ code: 'ERR_POLICY_HALT' });
        expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
        for (const surface of [
          raw,
          seen,
          recorder.toRecording(),
          runner.getSnapshot(),
          shape === 'direct' ? agent.getLastNarrativeEntries() : [],
        ])
          expect(JSON.stringify(surface)).not.toContain(SECRET);
      } finally {
        recorder.stop();
      }
    },
  );

  it('the hosted resume: no event carries it', async () => {
    const ran: Record<string, unknown>[] = [];
    const agent = Agent.create({ provider: script().provider as never, model: 'm' })
      .tool(lookupAccount(ran))
      .build();
    const seen = events(agent);
    const sessions = memorySessions();
    const host = inProcessHost();
    const handle = await standingAgent({ agent, sessions, host });
    try {
      const first = await host.deliver({ input: 'look my account up', sessionId: 's' });
      const pending = first.awaiting!.awaitingInput!;
      const done = await host.deliver({
        input: '',
        sessionId: 's',
        decision: { requestId: pending.requestId, values: { f1: SECRET } },
      });
      expect(done.output).toBe('Found it.');
      expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
      expectRedactedResume(seen);
      expect(JSON.stringify(seen)).not.toContain(SECRET);
    } finally {
      await handle.close();
    }
  });

  it('the composed resume (Sequence with a raw reply): no event carries it', async () => {
    const ran: Record<string, unknown>[] = [];
    const inner = Agent.create({ provider: script().provider as never, model: 'm' })
      .tool(lookupAccount(ran))
      .build();
    const seq = Sequence.create().step('ops', inner).build();
    const seen = events(seq as never);
    const asked = await seq.run({ message: 'look my account up' });
    if (!isInputPause(asked)) throw new Error('expected the ask through the sequence');
    await seq.resume(stored(asked), {
      requestId: asked.awaitingInput.requestId,
      values: { f1: SECRET },
    });
    expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
    expectRedactedResume(seen);
    expect(JSON.stringify(seen)).not.toContain(SECRET);
  });

  it('every OTHER pause kind keeps its reply on the resume event, unchanged', async () => {
    const collect = defineTool({
      name: 'collect_year',
      description: 'd',
      inputSchema: { type: 'object', properties: {} },
      execute: () =>
        requestInput({
          id: 'q',
          question: 'Year?',
          fields: [{ id: 'year', type: 'number', required: true }],
        }),
    });
    const agent = Agent.create({
      provider: scripted([batch({ id: 'c1', name: 'collect_year', args: {} }), answer('ok')])
        .provider as never,
      model: 'm',
    })
      .tool(collect)
      .build();
    const seen = events(agent);
    const paused = await agent.run({ message: 'go' });
    await agent.resume(stored(paused), replyTo(paused, { year: 2026 }));
    const resume = seen.find((e) => e.type === 'agentfootprint.pause.resume');
    expect(resume?.payload.resumeInput).toMatchObject({ values: { year: 2026 } });
  });
});
