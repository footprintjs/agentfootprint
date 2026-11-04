import { describe, expect, it } from 'vitest';

import {
  Agent,
  LLMCall,
  type Receipt,
  RunInFlightError,
  askHuman,
  defineTool,
  isPaused,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import type { LLMProvider, LLMResponse } from '../../src/provider-contract/types.js';

const response: LLMResponse = {
  content: 'ok',
  toolCalls: [],
  usage: { input: 1, output: 1 },
  stopReason: 'stop',
};

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

function outcome<T>(promise: Promise<T>) {
  return promise.then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason: unknown) => ({ status: 'rejected' as const, reason }),
  );
}

describe('run ownership covers setup callbacks, not just provider execution', () => {
  it('retains the existing ordinary overlap refusal and releases it for sequential reuse', async () => {
    const gate = barrier();
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => {
        await gate.promise;
        return response;
      },
    };
    const agent = Agent.create({ provider, model: 'mock' }).build();
    const first = agent.run('first');
    const second = outcome(agent.run('second'));
    gate.release();
    expect(await second).toMatchObject({
      status: 'rejected',
      reason: expect.any(RunInFlightError),
    });
    await expect(first).resolves.toBe('ok');
    await expect(agent.run('third')).resolves.toBe('ok');
  });

  it('refuses reentry from run_configured before a second executor or recording can begin', async () => {
    const gate = barrier();
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => {
        await gate.promise;
        return response;
      },
    };
    const agent = Agent.create({ provider, model: 'mock' }).build();
    let entered = false;
    let nested: ReturnType<typeof outcome<unknown>> | undefined;
    const configured: string[] = [];
    agent.on('agentfootprint.agent.run_configured', (event) => {
      configured.push(event.meta.runId);
      if (!entered) {
        entered = true;
        nested = outcome(agent.run('intruder'));
      }
    });
    const first = agent.run('owner');
    gate.release();
    await expect(first).resolves.toBe('ok');
    expect(nested).toBeDefined();
    expect(await nested).toMatchObject({
      status: 'rejected',
      reason: expect.any(RunInFlightError),
    });
    expect(configured).toHaveLength(1);
    await expect(agent.run('next')).resolves.toBe('ok');
  });

  it('refuses reentry from pause.resume before a resumed leg mutates shared run state', async () => {
    const tool = defineTool({
      name: 'ask',
      description: 'ask',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'continue?' }),
    });
    const agent = Agent.create({
      provider: mock({
        replies: [{ toolCalls: [{ id: 'ask-1', name: 'ask', args: {} }] }, 'resumed', 'intruder'],
      }),
      model: 'mock',
    })
      .tool(tool)
      .build();
    const paused = await agent.run('pause');
    if (!isPaused(paused)) throw new Error('expected a real paused run');
    let nested: ReturnType<typeof outcome<unknown>> | undefined;
    agent.on('agentfootprint.pause.resume', () => {
      nested = outcome(agent.run('intruder'));
    });
    await agent.resume(paused.checkpoint, 'yes');
    expect(nested).toBeDefined();
    expect(await nested).toMatchObject({
      status: 'rejected',
      reason: expect.any(RunInFlightError),
    });
  });
});

describe('LLMCall per-run receipt identity', () => {
  it('refused overlap and sequential reuse keep receipt salts joined to native run ids', async () => {
    const gate = barrier();
    const provider: LLMProvider = {
      name: 'mock',
      complete: async () => {
        await gate.promise;
        return response;
      },
    };
    const call = LLMCall.create({ provider, model: 'mock' }).system('same system').build();
    const receipts: Receipt[] = [];
    const runIds = new Set<string>();
    call.attach({
      id: 'capture-receipts',
      onWrite: (event) => {
        if (event.key === 'receipt') receipts.push(event.value as Receipt);
      },
    });
    call.on('agentfootprint.stream.llm_start', (event) => {
      runIds.add(event.meta.runId);
    });
    const first = call.run('same message');
    const second = outcome(call.run('same message'));
    gate.release();
    await expect(first).resolves.toBe('ok');
    expect(await second).toMatchObject({
      status: 'rejected',
      reason: expect.any(RunInFlightError),
    });
    await expect(call.run('same message')).resolves.toBe('ok');
    expect(receipts).toHaveLength(2);
    expect(runIds.size).toBe(2);
    expect(new Set(receipts.map((receipt) => receipt.basis.runId))).toEqual(runIds);
    expect(receipts[0]!.system.hash).not.toBe(receipts[1]!.system.hash);
  });
});
