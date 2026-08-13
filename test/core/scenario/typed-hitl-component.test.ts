/**
 * Typed HITL (9.24.0) — the OPTIONAL `component` half of a human ask.
 *
 * The laws being pinned:
 *   • The pause fires exactly as it always did; the ask now CARRIES
 *     `{ componentId, props?, propsRef? }` — ids and props only, never markup
 *     (the registry lives in the frontend; the no-eval law).
 *   • A big payload rides the STORE via `propsRef`, not the checkpoint — the
 *     tool mints it via `ctx.artifacts` BEFORE raising the ask, and the ask
 *     only carries the ref. The checkpoint stays lean.
 *   • A `propsRef` that cannot be honored is refused AT THE SOURCE, teachingly
 *     — no store attached, or a ref that does not resolve in the run's scope —
 *     never discovered by the screen.
 *   • The decision RETURN path is unchanged (structured, never parsed from
 *     prose); the decision record additionally says WHICH surface collected it
 *     (`componentId` on `checkin.decision` / ledger rows / `pause.resume`).
 *   • Zero-cost: asks without a component are byte-identical — no `component`
 *     key on the pause payload, no `pausedComponentId` in the checkpoint, no
 *     `componentId` on the decision events.
 */

import { describe, it, expect, vi } from 'vitest';
import { Agent } from '../../../src/core/Agent.js';
import { defineTool } from '../../../src/core/tools.js';
import {
  ask,
  askHuman,
  checkInApproved,
  isCheckInPause,
  isAskPause,
  isPaused,
  CheckInRecorder,
  InvalidAskComponentError,
  RunCheckpointError,
  inMemoryArtifacts,
  type AgentfootprintEvent,
  type RunnerPauseOutcome,
} from '../../../src/index.js';
import { mock } from '../../../src/llm-providers.js';

// ─── Test doubles ────────────────────────────────────────────────────────

const callThenDone = (name: string, args: Record<string, unknown>) =>
  mock({
    replies: [{ toolCalls: [{ id: 't1', name, args }] }, { content: 'done' }],
  });

/** Distinctive marker so byte-presence in a serialized checkpoint is provable. */
const OPTION_MARKER = 'OPT_MARKER_9f3a';
const bigOptions = Array.from({ length: 200 }, (_, i) => ({
  id: `option-${i}`,
  label: `${OPTION_MARKER} reason #${i} for the refund`,
}));

type Caught = { type: string; payload: Record<string, unknown> };
const capture = (agent: Agent, pattern: string): Caught[] => {
  const events: Caught[] = [];
  agent.on(pattern as never, (e: AgentfootprintEvent) => {
    events.push({ type: e.type, payload: e.payload as Record<string, unknown> });
  });
  return events;
};

/** Unwrap the crash-checkpoint envelope so refusal tests read the REAL error. */
const causeOf = (err: unknown): unknown => (err instanceof RunCheckpointError ? err.cause : err);

// ─── 1. Declaration refusals (build/author time) ─────────────────────────

describe('typed HITL — teaching refusals at declaration', () => {
  it('defineTool refuses checkInComponent without checkIn (config that lies)', () => {
    expect(() =>
      defineTool({
        name: 'refund',
        description: 'refund',
        checkInComponent: { componentId: 'approve-panel' },
        execute: () => 'ok',
      }),
    ).toThrow(/checkInComponent.*has no effect without.*checkIn/s);
  });

  it('defineTool refuses a malformed component shape, naming the tool and the field', () => {
    expect(() =>
      defineTool({
        name: 'refund',
        description: 'refund',
        checkIn: 'always',
        checkInComponent: { componentId: '   ' },
        execute: () => 'ok',
      }),
    ).toThrow(/componentId must be a non-empty string/);
    expect(() =>
      defineTool({
        name: 'refund',
        description: 'refund',
        checkIn: 'always',
        checkInComponent: { componentId: 'x', props: [1, 2] as never },
        execute: () => 'ok',
      }),
    ).toThrow(/props must be a plain object/);
  });

  it('ask() refuses a malformed component in the middleware author’s own stack', () => {
    expect(() => ask({ question: 'ok?', component: { componentId: '' } })).toThrow(
      /componentId must be a non-empty string/,
    );
    expect(() => ask({ question: 'ok?', component: { componentId: 'x', propsRef: '' } })).toThrow(
      /propsRef must be a non-empty artifact ref/,
    );
  });

  it('Agent.build refuses a static checkInComponent.propsRef with no store attached', () => {
    const tool = defineTool({
      name: 'refund',
      description: 'refund',
      checkIn: 'always',
      checkInComponent: { componentId: 'option-picker', propsRef: 'art_0000000000000000000000' },
      execute: () => 'ok',
    });
    expect(() =>
      Agent.create({ provider: callThenDone('refund', {}), model: 'm' })
        .tool(tool)
        .build(),
    ).toThrow(/checkInComponent\.propsRef.*no artifact store is attached/s);
  });
});

// ─── 2. The check-in door ────────────────────────────────────────────────

describe('typed HITL — a check-in carries its declared component', () => {
  const refundTool = (exec = vi.fn(() => 'refunded')) =>
    defineTool<{ amount: number }, string>({
      name: 'issue_refund',
      description: 'refund a customer',
      inputSchema: {
        type: 'object',
        properties: { amount: { type: 'number' } },
        required: ['amount'],
      },
      checkIn: 'always',
      checkInComponent: { componentId: 'approve-panel', props: { tone: 'serious' } },
      execute: exec,
    });

  it('rides CheckInRequest; the decision event + recorder say which surface answered', async () => {
    const exec = vi.fn(() => 'refunded');
    const recorder = new CheckInRecorder();
    const agent = Agent.create({
      provider: callThenDone('issue_refund', { amount: 500 }),
      model: 'm',
    })
      .system('refunds')
      .tool(refundTool(exec))
      .build();
    agent.attach(recorder);
    const decisions = capture(agent, 'agentfootprint.checkin.decision');
    const resumes = capture(agent, 'agentfootprint.pause.resume');

    const out = await agent.run({ message: 'refund order 123' });
    expect(isCheckInPause(out)).toBe(true);
    const paused = out as RunnerPauseOutcome & {
      checkIn: NonNullable<RunnerPauseOutcome['checkIn']>;
    };
    // The ask carries the typed half, verbatim.
    expect(paused.checkIn.component).toEqual({
      componentId: 'approve-panel',
      props: { tone: 'serious' },
    });
    expect(exec).not.toHaveBeenCalled();

    // The decision RETURN path is unchanged — same structured vocabulary.
    const final = await agent.resume(paused.checkpoint, checkInApproved({ by: 'alice@ops' }));
    expect(final).toBe('done');
    expect(exec).toHaveBeenCalledTimes(1);

    // …but the record now says which surface collected it.
    expect(decisions).toHaveLength(1);
    expect(decisions[0].payload.approved).toBe(true);
    expect(decisions[0].payload.componentId).toBe('approve-panel');
    expect(recorder.getDecisions()[0].componentId).toBe('approve-panel');
    // The generic resume record carries it too, read from the checkpoint.
    expect(resumes).toHaveLength(1);
    expect(resumes[0].payload.componentId).toBe('approve-panel');
  });

  it('a dangling checkInComponent.propsRef is refused at raise, not handed to the screen', async () => {
    const store = inMemoryArtifacts();
    const tool = defineTool<{ amount: number }, string>({
      name: 'issue_refund',
      description: 'refund a customer',
      checkIn: 'always',
      checkInComponent: {
        componentId: 'option-picker',
        propsRef: 'art_0000000000000000000000', // never minted
      },
      execute: () => 'refunded',
    });
    const agent = Agent.create({
      provider: callThenDone('issue_refund', {}),
      model: 'm',
      artifacts: store,
    })
      .tool(tool)
      .build();
    const refused = capture(agent, 'agentfootprint.artifacts.refused');

    const failure = causeOf(await agent.run({ message: 'refund' }).catch((e) => e));
    expect(failure).toBeInstanceOf(InvalidAskComponentError);
    expect((failure as InvalidAskComponentError).reason).toBe('unresolved-ref');
    expect((failure as InvalidAskComponentError).message).toMatch(/does not resolve/);
    // The refusal is on the record, in the artifacts vocabulary.
    expect(refused.some((e) => e.payload.reason === 'missing-or-expired')).toBe(true);
  });
});

// ─── 3. The askHuman door (mint-then-ask, the canonical flow) ────────────

describe('typed HITL — askHuman carries a component whose big half rides the store', () => {
  const pickerTool = (store: 'attached' | 'none') =>
    defineTool<{ amount: number }, string>({
      name: 'pick_reason',
      description: 'ask the person to pick a refund reason',
      execute: async (_args, ctx) => {
        if (store === 'attached') {
          const meta = await ctx.artifacts.put({
            kind: 'options/list',
            mediaType: 'application/json',
            data: bigOptions,
            label: 'refund reasons',
          });
          return askHuman({
            question: 'Which reason?',
            component: {
              componentId: 'option-picker',
              props: { title: 'Pick one' },
              propsRef: meta.ref,
            },
          });
        }
        return askHuman({
          question: 'Which reason?',
          component: { componentId: 'option-picker', propsRef: 'art_0000000000000000000000' },
        });
      },
    });

  it('mint → ask → the checkpoint stays LEAN (options in the store, ref on the ask)', async () => {
    const store = inMemoryArtifacts();
    const agent = Agent.create({
      provider: callThenDone('pick_reason', {}),
      model: 'm',
      artifacts: store,
    })
      .tool(pickerTool('attached'))
      .build();
    const resolved = capture(agent, 'agentfootprint.artifacts.resolved');
    const resumes = capture(agent, 'agentfootprint.pause.resume');

    const out = await agent.run({ message: 'refund' });
    expect(isPaused(out)).toBe(true);
    const paused = out as RunnerPauseOutcome;
    const data = paused.pauseData as {
      question?: string;
      component?: { componentId: string; props?: unknown; propsRef?: string };
    };
    expect(data.question).toBe('Which reason?');
    expect(data.component?.componentId).toBe('option-picker');
    const ref = data.component?.propsRef as string;
    expect(ref).toMatch(/^art_/);

    // THE LEAN PIN — the 200 options are provably NOT checkpoint freight:
    const checkpointJson = JSON.stringify(paused.checkpoint);
    expect(checkpointJson).not.toContain(OPTION_MARKER);
    // …while the ref the ask carries redeems the whole payload from the store.
    const scope = {
      conversationId: JSON.parse(checkpointJson).sharedState.runIdentity.conversationId as string,
    };
    const record = await store.get(scope, ref);
    expect(record).not.toBeNull();
    expect((record?.data as typeof bigOptions).length).toBe(200);
    // Raise-time validation put the resolution on the record (head, by name).
    expect(resolved.some((e) => e.payload.ref === ref && e.payload.via === 'head')).toBe(true);

    // The answer returns as a VALUE, exactly as every askHuman always has —
    // and the resume record says which surface collected it.
    const final = await agent.resume(paused.checkpoint, 'option-42');
    expect(final).toBe('done');
    expect(resumes[0].payload.componentId).toBe('option-picker');
  });

  it('the comparative pin — propsRef keeps the checkpoint far smaller than inline props', async () => {
    const store = inMemoryArtifacts();
    const viaRef = Agent.create({
      provider: callThenDone('pick_reason', {}),
      model: 'm',
      artifacts: store,
    })
      .tool(pickerTool('attached'))
      .build();
    const inlineTool = defineTool({
      name: 'pick_reason',
      description: 'ask the person to pick a refund reason',
      execute: () =>
        askHuman({
          question: 'Which reason?',
          component: { componentId: 'option-picker', props: { options: bigOptions } },
        }),
    });
    const viaInline = Agent.create({ provider: callThenDone('pick_reason', {}), model: 'm' })
      .tool(inlineTool)
      .build();

    const refOut = (await viaRef.run({ message: 'go' })) as RunnerPauseOutcome;
    const inlineOut = (await viaInline.run({ message: 'go' })) as RunnerPauseOutcome;
    const refBytes = JSON.stringify(refOut.checkpoint).length;
    const inlineBytes = JSON.stringify(inlineOut.checkpoint).length;
    // Inline pays for all 200 options in the checkpoint; the ref pays ~26 chars.
    expect(inlineBytes - refBytes).toBeGreaterThan(4000);
  });

  it('propsRef with NO store attached is a teaching refusal naming the fix', async () => {
    const agent = Agent.create({ provider: callThenDone('pick_reason', {}), model: 'm' })
      .tool(pickerTool('none'))
      .build();
    const failure = causeOf(await agent.run({ message: 'go' }).catch((e) => e));
    expect(failure).toBeInstanceOf(InvalidAskComponentError);
    expect((failure as InvalidAskComponentError).reason).toBe('no-store');
    expect((failure as InvalidAskComponentError).message).toMatch(
      /Agent\.create\(\{ \.\.\., artifacts \}\)/,
    );
  });

  it('a malformed component thrown through askHuman refuses at raise, naming the door', async () => {
    const badTool = defineTool({
      name: 'pick_reason',
      description: 'ask',
      execute: () => askHuman({ question: 'x', component: { componentId: 42 as never } }),
    });
    const agent = Agent.create({ provider: callThenDone('pick_reason', {}), model: 'm' })
      .tool(badTool)
      .build();
    const failure = causeOf(await agent.run({ message: 'go' }).catch((e) => e));
    expect(failure).toBeInstanceOf(InvalidAskComponentError);
    expect((failure as InvalidAskComponentError).door).toBe("askHuman in tool 'pick_reason'");
  });
});

// ─── 4. The middleware ask door ──────────────────────────────────────────

describe('typed HITL — a middleware ask carries its component', () => {
  it('rides outcome.ask; the resume-side ledger row says which surface answered', async () => {
    const runTool = defineTool({
      name: 'deploy',
      description: 'deploy to prod',
      execute: () => 'deployed',
    });
    const agent = Agent.create({ provider: callThenDone('deploy', {}), model: 'm' })
      .tool(runTool)
      .toolMiddleware({
        name: 'prod-gate',
        onToolCall: () =>
          ask({
            question: 'Deploy to prod?',
            component: { componentId: 'confirm-dialog', props: { danger: true } },
          }),
      })
      .build();
    const rows = capture(agent, 'agentfootprint.middleware.decision');

    const out = await agent.run({ message: 'ship it' });
    expect(isAskPause(out)).toBe(true);
    const paused = out as RunnerPauseOutcome & { ask: NonNullable<RunnerPauseOutcome['ask']> };
    expect(paused.ask.component).toEqual({
      componentId: 'confirm-dialog',
      props: { danger: true },
    });

    const final = await agent.resume(paused.checkpoint, checkInApproved({ by: 'dana@ops' }));
    expect(final).toBe('done');
    const answered = rows.filter((r) => r.payload.componentId !== undefined);
    expect(answered).toHaveLength(1);
    expect(answered[0].payload.componentId).toBe('confirm-dialog');
    expect(answered[0].payload.outcome).toBe('allow');
    // The ask-time row (before any person existed) carries no componentId.
    expect(rows.filter((r) => r.payload.outcome === 'ask')[0]?.payload.componentId).toBe(undefined);
  });
});

// ─── 5. Zero-cost — asks without a component are byte-identical ──────────

describe('typed HITL — zero-cost when unused', () => {
  it('a component-less check-in: no component key, no pausedComponentId, no componentId', async () => {
    const exec = vi.fn(() => 'refunded');
    const agent = Agent.create({
      provider: callThenDone('issue_refund', {}),
      model: 'm',
    })
      .tool(
        defineTool<Record<string, never>, string>({
          name: 'issue_refund',
          description: 'refund a customer',
          checkIn: 'always',
          execute: exec,
        }),
      )
      .build();
    const decisions = capture(agent, 'agentfootprint.checkin.decision');
    const resumes = capture(agent, 'agentfootprint.pause.resume');

    const out = (await agent.run({ message: 'refund' })) as RunnerPauseOutcome;
    expect(isCheckInPause(out)).toBe(true);
    // The pause payload has exactly the keys it had before 9.24.0.
    expect(Object.keys(out.pauseData as object).sort()).toEqual([
      'checkIn',
      'toolCallId',
      'toolName',
    ]);
    expect(Object.keys(out.checkIn as object).sort()).toEqual(['args', 'evidence', 'tool']);
    // The checkpoint never gained the carrier key.
    expect(JSON.stringify(out.checkpoint)).not.toContain('pausedComponentId');

    await agent.resume(out.checkpoint, checkInApproved({ by: 'alice' }));
    expect('componentId' in decisions[0].payload).toBe(false);
    expect('componentId' in resumes[0].payload).toBe(false);
  });

  it('a component-less askHuman: pauseData and checkpoint gain nothing', async () => {
    const agent = Agent.create({ provider: callThenDone('pick_reason', {}), model: 'm' })
      .tool(
        defineTool({
          name: 'pick_reason',
          description: 'ask',
          execute: () => askHuman({ question: 'Which reason?' }),
        }),
      )
      .build();
    const out = (await agent.run({ message: 'go' })) as RunnerPauseOutcome;
    expect(isPaused(out)).toBe(true);
    expect(Object.keys(out.pauseData as object).sort()).toEqual([
      'question',
      'toolCallId',
      'toolName',
    ]);
    expect(JSON.stringify(out.checkpoint)).not.toContain('pausedComponentId');
    expect(await agent.resume(out.checkpoint, 'because')).toBe('done');
  });
});
