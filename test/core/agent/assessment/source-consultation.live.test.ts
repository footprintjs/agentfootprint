import { describe, expect, it } from 'vitest';
import { meta, run as runExample } from '../../../../examples/features/130-source-not-consulted.js';
import { composedInput } from '../../../../src/core/messageFrom.js';
import type { AgentRunCheckpoint } from '../../../../src/core/runCheckpoint.js';
import { Agent, LLMCall, absent, defineTool, deny } from '../../../../src/index.js';
import { defineSkill } from '../../../../src/injection-engine.js';
import { PermissionPolicy } from '../../../../src/security/PermissionPolicy.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import { defineOntology } from '../../../../src/ontology/index.js';
import { mock } from '../../../../src/providers.js';
import { requestAttempt } from '../../../../src/provider-contract/requestObserver.js';
import type { LLMProvider, LLMResponse } from '../../../../src/provider-contract/types.js';

const reason = 'source-not-consulted';
const ANSWER = 'The switch is reachable.';
const manifest = ['status', 'monitor', 'archive'];
const source = {
  meaning: 'Link observations after changes',
  aliases: ['link monitor'],
};

function map(includeHidden = false) {
  return defineOntology({
    id: 'switch-stack',
    version: '1',
    nodes: {
      link_observation: {
        meaning: 'Current evidence for a link',
        sources: [
          {
            source: 'monitor_data',
            via: includeHidden
              ? ['monitor', 'archive', 'restricted_lookup']
              : ['monitor', 'archive'],
          },
        ],
      },
      ...(includeHidden && {
        hidden_equipment: {
          meaning: 'Restricted inventory',
          sources: [{ source: 'hidden_inventory', via: ['restricted_lookup'] }],
        },
      }),
    },
    sources: {
      monitor_data: source,
      ...(includeHidden && { hidden_inventory: { meaning: 'Restricted records' } }),
    },
  });
}

const tool = (name: string, displayName: string, execute: () => unknown = () => 'Known result.') =>
  defineTool({
    name,
    displayName,
    description: 'Read recorded switch data.',
    inputSchema: { type: 'object', properties: {} },
    execute,
  });

function scripted(
  initial: readonly string[] | undefined,
  call = 'status',
  scrub: 'remove' | 'replace' | 'overlap' | undefined = undefined,
): LLMProvider {
  let next = 0;
  return {
    name: 'scripted',
    async complete(request, hooks): Promise<LLMResponse> {
      if (scrub !== undefined) {
        const tools =
          scrub === 'replace'
            ? request.tools?.map((tool) =>
                tool.name === 'monitor' ? { ...tool, description: 'Different contract.' } : tool,
              )
            : (request.tools ?? []).filter((tool) => tool.name !== 'monitor');
        const observed = requestAttempt(hooks, {
          ...request,
          ...(tools !== undefined && { tools }),
        });
        if (scrub === 'overlap') requestAttempt(hooks, request).close();
        observed.close();
      }
      const wireManifest =
        initial === undefined
          ? {}
          : {
              wireManifest: {
                toolNames: (request.tools ?? [])
                  .map((tool) => tool.name)
                  .filter((name) => initial.includes(name) || !manifest.includes(name)),
              },
            };
      if (next++ === 0) {
        return {
          content: '',
          toolCalls: [{ id: 'call-1', name: call, args: {} }],
          usage: { input: 10, output: 3 },
          stopReason: 'tool_use',
          ...wireManifest,
        };
      }
      return {
        content: ANSWER,
        toolCalls: [],
        usage: { input: 9, output: 4 },
        stopReason: 'stop',
        ...wireManifest,
      };
    },
  };
}

async function exercise({
  wire = undefined,
  call = 'status',
  sourceNotConsulted = true,
  raiseOn = undefined,
  linked = true,
  suggests = false,
  hidden = false,
  withheld = false,
  archiveOutcome = 'returned',
  commitValues = 'delta',
  scrub = undefined,
  mode = 'classic',
}: {
  wire?: readonly string[];
  call?: string;
  sourceNotConsulted?: boolean;
  raiseOn?: readonly (typeof reason)[];
  linked?: boolean;
  suggests?: boolean;
  hidden?: boolean;
  withheld?: boolean;
  archiveOutcome?: 'returned' | 'denied' | 'failed';
  commitValues?: 'delta' | 'full';
  scrub?: 'remove' | 'replace' | 'overlap';
  mode?: 'classic' | 'dynamic' | 'dynamic-grouped';
} = {}) {
  const provider = scripted(wire, call, scrub);
  const agentBuilder = Agent.create({
    provider,
    model: 'mock',
    reactMode: mode,
    commitValues,
    ...(hidden && {
      permissionChecker: PermissionPolicy.fromRoles(
        { support: ['status', 'monitor', 'archive', 'restricted_lookup'] },
        'support',
        { skills: { support: [] } },
      ),
    }),
  })
    .tool(
      tool('status', 'array status', () =>
        suggests
          ? absent({
              what: 'The requested switch',
              checked: ['Current status'],
              tryInsteadTool: { tool: 'monitor', why: 'It has the recent observations.' },
            })
          : 'Online.',
      ),
    )
    .tool(tool('monitor', 'link monitor'))
    .tool(
      tool('archive', 'link archive', () => {
        if (archiveOutcome === 'failed') throw new Error('Archive query failed.');
        if (archiveOutcome === 'denied') throw new Error('The refused query should not execute.');
        return 'Known result.';
      }),
    )
    .answerLayer({
      sourceNotConsulted,
      standingLine: { when: 'not-sure-or-ask', ...(raiseOn !== undefined && { raiseOn }) },
    });
  if (linked) agentBuilder.ontology(map(hidden));
  if (hidden) {
    agentBuilder.skill(
      defineSkill({
        id: 'restricted',
        description: 'Restricted skill.',
        body: 'Read restricted inventories.',
        tools: [tool('restricted_lookup', 'restricted inventory')],
      }),
    );
  }
  if (archiveOutcome === 'denied') {
    agentBuilder.toolMiddleware({
      name: 'refuse-archive',
      onToolCall: () => deny('Read refused.'),
    });
  }
  if (withheld) {
    agentBuilder.toolMiddleware({ name: 'withhold-status', onToolResult: () => deny('Held.') });
  }
  const agent = agentBuilder.build();
  const recorder = recordRun(agent);
  try {
    const answer = await agent.run({
      message: hidden
        ? 'Give the link observation and hidden equipment.'
        : linked
        ? 'Give the link observation.'
        : 'Is the switch reachable?',
    });
    const recording = recorder.toRecording();
    const turnEnd = recording.events.find(
      (event) => event.type === 'agentfootprint.agent.turn_end',
    );
    const recorded = JSON.parse(JSON.stringify(recording));
    const saved = assessAnswer(recorded);
    expect(await agent.assessment()).toEqual(saved);
    return {
      answer,
      choice: saved.reasons.filter((row) => row.reason === reason),
      sourceConsultation: recorded.snapshot.sharedState.sourceConsultation,
      standingLineOmittedByRaiseOn: turnEnd?.payload.standingLineOmittedByRaiseOn,
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

describe('declared sources skipped in a native turn', () => {
  it.each([
    ['a person', false, 1],
    ['an earlier runner', true, 0],
  ] as const)(
    'respects whether the native request came from %s',
    async (_author, composed, expected) => {
      const question = 'Give the link observation.';
      const agent = Agent.create({ provider: scripted(manifest), model: 'mock' })
        .tools([
          tool('status', 'array status'),
          tool('monitor', 'link monitor'),
          tool('archive', 'link archive'),
        ])
        .ontology(map())
        .answerLayer({ sourceNotConsulted: true })
        .build();
      try {
        if (composed) {
          const prior = LLMCall.create({
            provider: mock({ reply: question }),
            model: 'mock',
          }).build();
          try {
            const message = await prior.run({
              message: 'Formulate a request to inspect the switch.',
            });
            if (typeof message !== 'string')
              throw new Error('Expected the prior runner to finish.');
            expect(message).toBe(question);
            // Hand off through the same mapper as a native composition, then
            // enter Agent.run so the run owner must preserve the marker.
            const input = composedInput(agent, { message });
            expect(input).toHaveProperty('messageFrom', 'composed');
            await agent.run(input);
          } finally {
            await prior.shutdown();
          }
        } else {
          await agent.run({ message: question });
        }
        const assessment = await agent.assessment();
        expect(assessment?.reasons.filter((row) => row.reason === reason)).toHaveLength(expected);
        expect(agent.getLastSnapshot()?.sharedState.userMessageFrom).toBe(
          composed ? 'composed' : undefined,
        );
      } finally {
        await agent.shutdown();
      }
    },
  );

  it.each([
    ['classic', undefined, false],
    ['classic', manifest, true],
    ['classic', ['status'], false],
    ['dynamic', manifest, true],
    ['dynamic-grouped', manifest, true],
  ] as const)('requires a positive manifest witness in %s (%j)', async (mode, wire, expected) => {
    const result = await exercise({ mode, ...(wire !== undefined && { wire }) });
    expect(result.choice).toHaveLength(expected ? 1 : 0);
    if (expected) expect(result.answer).toContain('link monitor');
  });

  it.each(['returned', 'denied', 'failed'] as const)(
    'counts an equivalent archive attempt when %s',
    async (archiveOutcome) => {
      const result = await exercise({ wire: manifest, call: 'archive', archiveOutcome });
      expect(result.choice).toEqual([]);
      expect(result.sourceConsultation?.attempted).toHaveLength(1);
    },
  );

  it('records the same evidence in full and delta commit logs', async () => {
    const full = await exercise({ wire: manifest, commitValues: 'full' });
    const delta = await exercise({ wire: manifest, commitValues: 'delta' });
    expect(full.choice).toHaveLength(1);
    expect(delta).toEqual(full);
  });

  it.each(['remove', 'replace', 'overlap'] as const)(
    'requires an authorized effective contract when the adapter records %s',
    async (scrub) => {
      const result = await exercise({ wire: ['status', 'monitor'], scrub });
      expect(result.choice).toEqual([]);
    },
  );

  it('keeps skipped-source evidence when a reason filter hides its warning', async () => {
    const baseline = await exercise({ wire: manifest });
    const selected = await exercise({ wire: manifest, raiseOn: [reason] });
    const suppressed = await exercise({ wire: manifest, raiseOn: [] });

    expect(baseline.answer).toContain('link monitor');
    expect(selected).toEqual(baseline);
    expect(suppressed).toEqual({
      ...baseline,
      answer: ANSWER,
      standingLineOmittedByRaiseOn: true,
    });
  });

  it('keeps the unarmed output and the state key unchanged', async () => {
    const result = await exercise({ wire: manifest, sourceNotConsulted: false });
    expect(result.choice).toEqual([]);
    expect(result.sourceConsultation).toBeUndefined();
    expect(result.answer).toBe(ANSWER);
  });

  it('admits a typed suggestion only through a natively served absence', async () => {
    const admitted = await exercise({ wire: manifest, suggests: true, linked: false });
    const withheld = await exercise({
      wire: manifest,
      suggests: true,
      linked: false,
      withheld: true,
    });
    expect(admitted.choice).toHaveLength(1);
    expect(admitted.answer).toContain('link monitor');
    expect(withheld.choice).toEqual([]);
  });

  it('keeps visible warning names and counts identical when a tool belongs to a hidden skill', async () => {
    const visible = await exercise({ wire: [...manifest, 'restricted_lookup'] });
    const hidden = await exercise({ wire: [...manifest, 'restricted_lookup'], hidden: true });
    expect(hidden.choice).toEqual(visible.choice);
    expect(hidden.sourceConsultation).toEqual(visible.sourceConsultation);
    expect(hidden.answer).toEqual(visible.answer);
  });

  it('keeps visible source evidence unchanged for a guessed hidden route', async () => {
    const options = { wire: manifest, call: 'restricted_lookup' } as const;
    const absent = await exercise(options);
    const hidden = await exercise({ ...options, hidden: true });
    expect(absent.choice).toHaveLength(1);
    expect(hidden.choice).toEqual(absent.choice);
    expect(hidden.sourceConsultation).toEqual(absent.sourceConsultation);
  });

  it('joins a typed suggestion to a later positively witnessed provider tool', async () => {
    let looked = false;
    const monitor = tool('monitor', 'link monitor');
    const agent = Agent.create({
      provider: scripted(manifest),
      model: 'mock',
      reactMode: 'dynamic',
    })
      .tool(
        tool('status', 'array status', () => {
          looked = true;
          return absent({
            what: 'The switch',
            checked: ['Status'],
            tryInsteadTool: { tool: 'monitor' },
          });
        }),
      )
      .toolProvider({ id: 'live-monitor', list: () => (looked ? [monitor] : []) })
      .answerLayer({ sourceNotConsulted: true, standingLine: true })
      .build();
    try {
      expect(await agent.run({ message: 'Is the switch reachable?' })).toContain('link monitor');
      expect((await agent.assessment())?.reasons.map((row) => row.reason)).toContain(reason);
    } finally {
      await agent.shutdown();
    }
  });

  it.each(['classic', 'dynamic-grouped'] as const)(
    'keeps a recovered same request incomplete in %s',
    async (reactMode) => {
      let calls = 0;
      const provider: LLMProvider = {
        name: 'recover',
        async complete(request) {
          const turn = calls++;
          if (turn === 1) throw new Error('Scripted transport interruption.');
          return {
            content: turn === 0 ? '' : ANSWER,
            toolCalls: turn === 0 ? [{ id: 'already-ran', name: 'monitor', args: {} }] : [],
            usage: { input: 1, output: 1 },
            stopReason: turn === 0 ? 'tool_use' : 'stop',
            wireManifest: { toolNames: (request.tools ?? []).map((tool) => tool.name) },
          };
        },
      };
      const agent = Agent.create({ provider, model: 'mock', reactMode })
        .tool(tool('monitor', 'link monitor'))
        .tool(tool('archive', 'link archive'))
        .ontology(map())
        .answerLayer({ sourceNotConsulted: true })
        .build();
      try {
        let failure: { checkpoint?: AgentRunCheckpoint } | undefined;
        try {
          await agent.run({ message: 'Give the link observation.' });
        } catch (error) {
          failure = error as typeof failure;
        }
        if (failure?.checkpoint === undefined) throw new Error('Expected a native checkpoint.');
        await agent.resumeOnError(failure.checkpoint);
        expect((await agent.assessment())?.reasons.map((row) => row.reason)).not.toContain(reason);
        const state = agent.getLastSnapshot()?.sharedState as {
          sourceConsultation?: { complete: boolean };
        };
        expect(state.sourceConsultation?.complete).toBe(false);
      } finally {
        await agent.shutdown();
      }
    },
  );

  it('runs the documented example with an offered skipped monitor', async () => {
    const result = await runExample(meta.defaultInput ?? '');
    expect(result.answer).toContain('link monitor');
    expect(result.assessment?.reasons.map((row) => row.reason)).toContain(reason);
  });
});
