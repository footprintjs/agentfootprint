import { expect, it } from 'vitest';
import { Agent, allow, ask, checkInApproved, defineTool, isAskPause } from '../../src/index.js';
import { pausedRequest } from '../helpers/pausedRequest.js';
import { SkillRegistry, defineSkill } from '../../src/injection-engine.js';
import { recordRun } from '../../src/observe.js';
import { readEnvelope } from '../../src/hosting/envelope.js';
import { mock } from '../../src/providers.js';
import { gatedTools, staticTools } from '../../src/tool-providers/index.js';
import type { LLMMessage, PermissionChecker } from '../../src/provider-contract/types.js';
import { projectSkillListingHistory } from '../../src/security/skillListingHistory.js';
import { summarizeOldest } from '../../src/core/agent/window/strategies/summarizeOldest.js';
import { segmentTurns } from '../../src/core/agent/window/turns.js';

const visible = { id: 'reports', description: 'Prepare a report.' };
const restricted = { id: 'planning', description: 'Internal planning notes.' };
const serialize = (...rows: readonly (typeof visible)[]): string => JSON.stringify(rows, null, 2);

function listing() {
  const registry = new SkillRegistry();
  for (const skill of [visible, restricted]) {
    registry.register(defineSkill({ ...skill, body: 'Test instructions.' }));
  }
  const tool = registry.toTools().listSkills;
  if (tool === undefined) throw new Error('Expected the fixture listing.');
  return tool;
}

async function inspectListing(permissionChecker?: PermissionChecker) {
  const dispatchResults: unknown[] = [];
  const requests: LLMMessage[][] = [];
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond: ({ messages }) => {
        requests.push([...messages]);
        return requests.length === 1
          ? { toolCalls: [{ id: 'catalog', name: 'list_skills', args: {} }] }
          : { content: 'Done.' };
      },
    }),
    ...(permissionChecker !== undefined && { permissionChecker }),
  })
    .toolProvider(gatedTools(staticTools([listing()]), () => true))
    .build();
  const recorder = recordRun(agent);
  agent.on('agentfootprint.stream.tool_end', (event) => dispatchResults.push(event.payload.result));
  try {
    await agent.run({ message: 'List the catalog.' });
    const result = (message: LLMMessage) =>
      message.role === 'tool' && message.toolCallId === 'catalog';
    return {
      modelResult: requests[1]?.find(result)?.content,
      modelOrigin: requests[1]?.find(result)?.skillListing,
      savedResult: agent.checkpoint()?.history.find(result)?.content,
      savedOrigin: agent.checkpoint()?.history.find(result)?.skillListing,
      dispatchResults,
      recordedResults: recorder
        .toRecording()
        .events.flatMap((event) =>
          event.type === 'agentfootprint.stream.tool_end' ? [event.payload.result] : [],
        ),
    };
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
}

it('keeps catalog rows aligned across the non-governed invocation, request and record', async () => {
  const asked: string[] = [];
  const checker: PermissionChecker = {
    governs: ['tool_call'],
    check(request) {
      asked.push(request.capability);
      return { result: 'allow' };
    },
  };
  const unrestricted = serialize(visible, restricted);
  const expected = {
    modelResult: unrestricted,
    modelOrigin: undefined,
    savedResult: unrestricted,
    savedOrigin: { kind: 'rows', ids: ['reports', 'planning'] },
    dispatchResults: [unrestricted],
    recordedResults: [unrestricted],
  };
  expect(await inspectListing()).toEqual(expected);
  expect(await inspectListing(checker)).toEqual(expected);
  expect(asked).toEqual(['tool_call']);
});

it('keeps the served catalog aligned when one policy decision is unavailable', async () => {
  const asked: string[] = [];
  const checker: PermissionChecker = {
    governs: ['skill_read'],
    check(request) {
      if (request.capability === 'skill_read') asked.push(request.target ?? '');
      if (request.target === 'skill:planning') throw new Error('Fixture policy unavailable.');
      return { result: 'allow' };
    },
  };
  const offered = serialize(visible);
  expect(await inspectListing(checker)).toEqual({
    modelResult: offered,
    modelOrigin: undefined,
    savedResult: offered,
    savedOrigin: { kind: 'rows', ids: ['reports'] },
    dispatchResults: [offered],
    recordedResults: [offered],
  });
  expect(asked).toEqual(['skill:reports', 'skill:planning', 'skill:reports']);
});

it.each([true, false])(
  'projects a restored catalog using the current role (permitted: %s)',
  async (allowed) => {
    const original = Agent.create({
      model: 'mock',
      provider: mock({
        respond: ({ messages }) =>
          messages.some((message) => message.role === 'tool')
            ? { content: 'Done.' }
            : { toolCalls: [{ id: 'saved', name: 'list_skills', args: {} }] },
      }),
    })
      .tool(listing())
      .build();
    const currentResults: LLMMessage[] = [];
    const current = Agent.create({
      model: 'mock',
      provider: mock({
        respond: ({ messages }) => {
          currentResults.push(...messages.filter((message) => message.role === 'tool'));
          return { content: 'Continued.' };
        },
      }),
      permissionChecker: {
        governs: ['skill_read'],
        check(request) {
          return { result: request.target === 'skill:planning' && !allowed ? 'deny' : 'allow' };
        },
      },
    })
      .tool(listing())
      .build();
    try {
      await original.run({ message: 'List the catalog.' });
      const originalCheckpoint = original.checkpoint();
      if (originalCheckpoint === undefined) throw new Error('Expected a saved run.');
      const restored = JSON.parse(JSON.stringify(originalCheckpoint)) as typeof originalCheckpoint;
      await current.run({ message: 'Continue.', continueFrom: restored });
      expect(currentResults).toMatchObject([
        {
          toolCallId: 'saved',
          content: allowed ? serialize(visible, restricted) : serialize(visible),
        },
      ]);
      expect(currentResults[0]).not.toHaveProperty('skillListing');
      expect(
        current.checkpoint()?.history.find((message) => message.toolCallId === 'saved')?.content,
      ).toBe(serialize(visible, restricted));
    } finally {
      await current.shutdown();
      await original.shutdown();
    }
  },
);

it('leaves an app-authored tool with the same name unrelated to the catalog', async () => {
  const text = serialize(visible);
  const tool = defineTool({
    name: 'list_skills',
    description: 'List the capabilities of the fixture application.',
    execute: () => text,
  });
  const seen: LLMMessage[] = [];
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond: ({ messages }) => {
        seen.push(...messages);
        return messages.some((message) => message.role === 'tool')
          ? { content: 'Done.' }
          : { toolCalls: [{ id: 'app', name: 'list_skills', args: {} }] };
      },
    }),
    permissionChecker: { governs: ['skill_read'], check: () => ({ result: 'allow' }) },
  })
    .tool(tool)
    .build();
  try {
    await agent.run({ message: 'List the app capabilities.' });
    const result = agent.checkpoint()?.history.find((message) => message.role === 'tool');
    expect(result?.content).toBe(text);
    expect(result).not.toHaveProperty('skillListing');
    const saved = agent.checkpoint();
    if (saved === undefined) throw new Error('Expected a saved fixture conversation.');
    expect(saved.version).toBe(2);
    seen.length = 0;
    await agent.run({ message: 'Continue.', continueFrom: structuredClone(saved) });
    expect(seen.find((message) => message.role === 'tool')?.content).toBe(text);
  } finally {
    await agent.shutdown();
  }
});

const legacyConversation = {
  version: 1,
  runId: 'legacy-run',
  history: [
    { role: 'user', content: 'List the fixture categories.' },
    {
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'stored', name: 'list_skills', args: {} }],
    },
    { role: 'tool', toolName: 'list_skills', toolCallId: 'stored', content: 'Fixture category.' },
  ],
  lastCompletedIteration: 1,
  originalInput: { message: 'List the fixture categories.' },
  checkpointedAt: 1,
} satisfies import('../../src/core/runCheckpoint.js').AgentRunCheckpoint;

it.each([true, false])('restores a version-1 result (governed: %s)', async (governed) => {
  const restored = structuredClone(legacyConversation);
  const messages: LLMMessage[] = [];
  const checker: PermissionChecker = {
    governs: ['skill_read'],
    check: () => ({ result: 'allow' }),
  };
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond: (request) => {
        messages.push(...request.messages);
        return { content: 'Continued.' };
      },
    }),
    ...(governed && { permissionChecker: checker }),
  }).build();
  try {
    await agent.run({
      message: 'Continue.',
      continueFrom: readEnvelope({ format: 'conversation-v1', data: restored, savedAt: 1 }),
    });
    const tool = messages.find((message) => message.role === 'tool');
    expect(tool?.content).toBe(
      governed
        ? 'A saved skill catalog result is unavailable to this recipient.'
        : 'Fixture category.',
    );
    expect(tool).not.toHaveProperty('skillListing');
    expect(restored).toEqual(legacyConversation);
    expect(agent.checkpoint()?.history.find((message) => message.role === 'tool')).toMatchObject({
      content: 'Fixture category.',
      skillListing: { kind: 'unknown', ids: [] },
    });
    expect(agent.checkpoint()?.version).toBe(2);
  } finally {
    await agent.shutdown();
  }
});

it('withholds a restored catalog-derived frame whose provenance is unknown', async () => {
  const other: LLMMessage = { role: 'user', content: 'Keep this question.' };
  const merged: LLMMessage = {
    role: 'user',
    content: 'A summary carries a catalog result.',
    skillListing: { kind: 'unknown', ids: [] },
  };
  const checker: PermissionChecker = {
    governs: ['skill_read'],
    check: () => ({ result: 'allow' }),
  };
  const original = [other, merged];
  const [kept, withheld] = await projectSkillListingHistory(original, checker, undefined);
  expect(kept).toBe(other);
  expect(withheld).toEqual({
    role: 'user',
    content: 'A saved skill catalog result is unavailable to this recipient.',
  });
  expect(original[1]).toBe(merged);
});

it.each([false, true])(
  'checks catalog provenance across a compacted span (revoked before fold: %s)',
  async (revokeBeforeFold) => {
    const history: readonly LLMMessage[] = [
      { role: 'assistant', content: 'Catalog request. '.repeat(40) },
      {
        role: 'tool',
        toolName: 'list_skills',
        content: serialize(visible, restricted),
        skillListing: { kind: 'rows', ids: ['reports', 'planning'] },
      },
      { role: 'user', content: 'Continue.' },
    ];
    const checker: PermissionChecker = {
      governs: ['skill_read'],
      check: (request) => ({ result: request.target === 'skill:planning' ? 'deny' : 'allow' }),
    };
    const summarizerRequests: string[] = [];
    const strategy = summarizeOldest({
      thresholdTokens: 50,
      model: 'fixture-summary',
      summarizer: mock({
        respond: ({ messages }) => {
          const transcript = messages.map(({ content }) => content).join('\n');
          summarizerRequests.push(transcript);
          return {
            content: transcript.includes(restricted.description)
              ? 'Two catalog rows.'
              : 'One catalog row.',
          };
        },
      }),
    });
    const view = revokeBeforeFold
      ? await projectSkillListingHistory(history, checker, undefined)
      : history;
    const fold = await strategy.plan({
      history: view,
      turns: segmentTurns(view),
      measured: { input: 200, output: 10 },
      iteration: 3,
      runId: 'fixture',
      agentModel: 'fixture-agent',
      providerName: 'mock',
      signal: undefined,
      now: () => 0,
      planRemoval: () => ({ from: 0, to: 0, refusals: [] }),
      removalFacts: () => ({ removedStageIds: [], evictions: [] }),
    });
    expect(summarizerRequests).toHaveLength(1);
    expect(summarizerRequests[0].includes(restricted.description)).toBe(!revokeBeforeFold);
    expect(fold?.window?.[0].skillListing).toEqual({
      kind: 'derived',
      ids: revokeBeforeFold ? ['reports'] : ['reports', 'planning'],
    });
    const restored = JSON.parse(JSON.stringify(fold?.window)) as LLMMessage[];
    const current = await projectSkillListingHistory(restored, checker, undefined);
    if (revokeBeforeFold) {
      expect(current).toBe(restored);
      expect(current[0].content).toContain('One catalog row.');
    } else {
      expect(current[0].content).toBe(
        'A saved skill catalog result is unavailable to this recipient.',
      );
      expect(restored[0].content).toContain('Two catalog rows.');
    }
    expect(current[1]).toBe(restored[1]);
    expect(history[1].content).toBe(serialize(visible, restricted));
  },
);

it('gives a custom window strategy the current role view and preserves retained catalog bytes', async () => {
  const original = Agent.create({
    model: 'mock',
    provider: mock({
      respond: ({ messages }) =>
        messages.some((message) => message.role === 'tool')
          ? { content: 'Done.' }
          : { toolCalls: [{ id: 'saved', name: 'list_skills', args: {} }] },
    }),
  })
    .tool(listing())
    .build();
  const strategyReads: string[] = [];
  const replacement = 'Custom window summary.';
  const fresh = Agent.create({
    model: 'mock',
    provider: mock({ reply: 'Continued.' }),
    permissionChecker: {
      governs: ['skill_read'],
      check: (request) => ({ result: request.target === 'skill:planning' ? 'deny' : 'allow' }),
    },
  })
    .window({
      name: 'catalog-view-fixture',
      async plan({ history, turns, iteration, now }) {
        const result = history.find((message) => message.toolCallId === 'saved');
        if (result === undefined) return undefined;
        const turnResult = turns
          .flatMap((turn) => turn.messages)
          .find((message) => message.toolCallId === 'saved');
        strategyReads.push(result.content, turnResult?.content ?? '');
        const windowCharsBefore = history.reduce(
          (total, message) => total + message.content.length,
          0,
        );
        return {
          window: [...history, { role: 'user', content: replacement }],
          rebase: { headCount: history.length, keptTailCount: 0, insertedAtMs: now() },
          record: {
            strategy: 'catalog-view-fixture',
            iteration,
            removedStageIds: [],
            removedMessageCount: 0,
            windowCharsBefore,
            windowCharsAfter: windowCharsBefore + replacement.length,
            refusals: [],
          },
          evictions: [],
        };
      },
    })
    .build();
  try {
    await original.run({ message: 'List the catalog.' });
    const checkpoint = original.checkpoint();
    if (checkpoint === undefined) throw new Error('Expected a saved history.');
    await fresh.run({ message: 'Continue.', continueFrom: checkpoint });
    expect(strategyReads).toEqual([serialize(visible), serialize(visible)]);
    const retained = fresh.checkpoint()?.history ?? [];
    expect(retained.find((message) => message.toolCallId === 'saved')?.content).toBe(
      serialize(visible, restricted),
    );
    expect(retained.find((message) => message.content === replacement)?.skillListing).toEqual({
      kind: 'derived',
      ids: ['reports'],
    });
  } finally {
    await fresh.shutdown();
    await original.shutdown();
  }
});

it('the composed call reads the governed catalog through the same execution capability', async () => {
  const hidden: PermissionChecker = {
    governs: ['skill_read'],
    check(request) {
      return { result: request.target === 'skill:planning' ? 'deny' : 'allow' };
    },
  };
  const relay = defineTool({
    name: 'catalog_summary',
    description: 'Read the available catalog.',
    execute: async (_args, context) => {
      if (context.tools === undefined) throw new Error('Expected the composing context.');
      return await context.tools.call('list_skills', {});
    },
  });
  const reads: string[] = [];
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      respond: ({ messages }) => {
        const current = messages.find((message) => message.role === 'tool');
        if (current !== undefined) {
          reads.push(String(current.content));
          return { content: 'Done.' };
        }
        return { toolCalls: [{ id: 'summary', name: 'catalog_summary', args: {} }] };
      },
    }),
    permissionChecker: hidden,
  })
    .tool(listing())
    .tool(relay)
    .build();
  try {
    await agent.run({ message: 'Summarize the catalog.' });
    expect(reads).toEqual([serialize(visible)]);
    expect(agent.checkpoint()?.history.find((message) => message.role === 'tool')).toMatchObject({
      content: serialize(visible),
      skillListing: { kind: 'derived', ids: ['reports'] },
    });
  } finally {
    await agent.shutdown();
  }
});

it('an approved call across a saved pause asks the current role on the fresh executor', async () => {
  let roleAllowsPlanning = true;
  const checker: PermissionChecker = {
    governs: ['skill_read'],
    check(request) {
      return {
        result: request.target === 'skill:planning' && !roleAllowsPlanning ? 'deny' : 'allow',
      };
    },
  };
  const catalog = listing();
  const makeAgent = () =>
    Agent.create({
      model: 'mock',
      provider: mock({
        respond: ({ messages }) =>
          messages.some((message) => message.role === 'tool')
            ? { content: 'Done.' }
            : { toolCalls: [{ id: 'approved', name: 'list_skills', args: {} }] },
      }),
      permissionChecker: checker,
    })
      .tool(catalog)
      .toolMiddleware({
        name: 'confirm-listing',
        onToolCall: () => ask({ question: 'Confirm the listing?' }),
      })
      .build();
  const original = makeAgent();
  const fresh = makeAgent();
  const projected: unknown[] = [];
  fresh.on('agentfootprint.stream.tool_end', (event) => projected.push(event.payload.result));
  try {
    const pause = await original.run({ message: 'List the catalog.' });
    if (!isAskPause(pause)) throw new Error('Expected the fixture to pause.');
    const restored = JSON.parse(JSON.stringify(pause.checkpoint)) as typeof pause.checkpoint;
    roleAllowsPlanning = false;
    await fresh.resume(
      restored,
      checkInApproved({ request: pausedRequest(pause), by: 'reviewer' }),
    );
    expect(fresh.checkpoint()?.history.find((message) => message.role === 'tool')).toMatchObject({
      content: serialize(visible),
      skillListing: { kind: 'rows', ids: ['reports'] },
    });
    expect(projected).toEqual([serialize(visible)]);
  } finally {
    await fresh.shutdown();
    await original.shutdown();
  }
});

it.each([false, true])('restores native pause catalog provenance (legacy: %s)', async (legacy) => {
  const appTool = defineTool({
    name: 'list_skills',
    description: 'A fixture app tool.',
    execute: () => 'Fixture category.',
  });
  const confirm = defineTool({
    name: 'confirm',
    description: 'Prompt for a confirmation.',
    execute: () => 'Confirmed.',
  });
  const makeAgent = (observed: LLMMessage[]) =>
    Agent.create({
      model: 'mock',
      provider: mock({
        respond: ({ messages }) => {
          observed.push(...messages);
          if (messages.some((entry) => entry.toolCallId === 'confirm')) return { content: 'Done.' };
          return {
            toolCalls: messages.some((entry) => entry.toolCallId === 'stored')
              ? [{ id: 'confirm', name: 'confirm', args: {} }]
              : [{ id: 'stored', name: 'list_skills', args: {} }],
          };
        },
      }),
      permissionChecker: { governs: ['skill_read'], check: () => ({ result: 'allow' }) },
    })
      .tool(appTool)
      .tool(confirm)
      .toolMiddleware({
        name: 'confirm-fixture',
        onToolCall: (call) =>
          call.toolName === 'confirm' ? ask({ question: 'Confirm?' }) : allow(),
      })
      .build();

  const requests: LLMMessage[] = [];
  const original = makeAgent([]);
  const resumed = makeAgent(requests);
  try {
    const pause = await original.run({ message: 'Prepare a fixture and confirm.' });
    if (!isAskPause(pause)) throw new Error('Expected a native pause fixture.');
    const checkpoint: typeof pause.checkpoint & { agentCheckpointVersion?: number } = JSON.parse(
      JSON.stringify(pause.checkpoint),
    );
    expect(checkpoint.agentCheckpointVersion).toBe(2);
    if (legacy) delete checkpoint.agentCheckpointVersion;
    await resumed.resume(
      checkpoint,
      checkInApproved({ request: pausedRequest(pause), by: 'fixture' }),
    );
    expect(requests.find((entry) => entry.toolCallId === 'stored')?.content).toBe(
      legacy
        ? 'A saved skill catalog result is unavailable to this recipient.'
        : 'Fixture category.',
    );
  } finally {
    await original.shutdown();
    await resumed.shutdown();
  }
});
