import { describe, expect, it } from 'vitest';
import { isPaused, type LLMMessage } from '../../../../src/index.js';
import { knownResults } from '../../../../src/core/agent/findings/offer.js';
import {
  sourceCorpusOf,
  declaredSourcesOf,
} from '../../../../src/core/agent/honesty/sourceCorpus.js';
import { defineTool } from '../../../../src/index.js';
import { omissionRows } from '../../../../src/core/agent/arguments/sourceCorrection.js';
import {
  VM,
  QUESTION,
  TOOL,
  proposal,
  quoted,
  batch,
  correctionFixture,
  stateOf,
  argumentsOf,
} from './sourceCorrectionHarness.js';

describe('native source correction privacy and corpus isolation', () => {
  it.each(['user', 'result', 'turn', 'app'] as const)(
    'its fixed notice cannot be redeemed as %s evidence',
    async (source) => {
      const f = correctionFixture([
        batch(proposal('held', { vm: VM })),
        batch(
          proposal('laundered', {
            vm: 'source-declaration-required',
            _findings: {
              from: [
                {
                  argument: 'vm',
                  source,
                  ...(source === 'user' && { quote: 'source-declaration-required' }),
                  ...(source === 'result' && { id: 'held' }),
                },
              ],
            },
          }),
        ),
      ]);
      try {
        expect(isPaused(await f.agent.run(QUESTION))).toBe(true);
        expect(f.ran).toEqual([]);
        expect(f.requests).toHaveLength(2);
        expect(argumentsOf(f.agent, 'laundered')).toEqual([
          expect.objectContaining({ asked: 'unverified', claimed: source }),
        ]);
        const history = stateOf(f.agent).history as readonly LLMMessage[];
        expect(knownResults(history, []).some((row) => row.toolCallId === 'held')).toBe(false);
        const corpus = sourceCorpusOf({ history }, [], 1, { toolOf: () => undefined });
        expect(corpus.results.some((row) => row.toolCallId === 'held')).toBe(false);
        expect(corpus.person.some((row) => row.text.includes('source-declaration-required'))).toBe(
          false,
        );
        expect(corpus.app.some((row) => row.text.includes('source-declaration-required'))).toBe(
          false,
        );
        expect(corpus.answers).toEqual([]);
      } finally {
        await f.agent.shutdown();
      }
    },
  );

  it('keeps ordinary produced results while excluding only the native withheld frame', async () => {
    const f = correctionFixture([
      batch(proposal('held', { vm: VM })),
      batch(quoted('produced')),
      'Done.',
    ]);
    try {
      await f.agent.run(QUESTION);
      const history = stateOf(f.agent).history as readonly LLMMessage[];
      const known = knownResults(history, []);
      expect(known.some((row) => row.toolCallId === 'held')).toBe(false);
      expect(known.some((row) => row.toolCallId === 'produced')).toBe(true);
      const corpus = sourceCorpusOf({ history }, [], 1, { toolOf: () => undefined });
      expect(corpus.results.map((row) => row.toolCallId)).toEqual(['produced']);
      expect(corpus.results[0]?.text).toContain('true');
    } finally {
      await f.agent.shutdown();
    }
  });

  it('defers and settles the tool’s actual masked argument view without quoting its private value', async () => {
    const f = correctionFixture(
      [batch(proposal('private-held', { vm: VM })), batch(quoted('private-run')), 'Done.'],
      { hidden: true },
    );
    try {
      await f.agent.run(QUESTION);
      const row = argumentsOf(f.agent, 'private-held')[0];
      expect(row).toMatchObject({
        proposed: 'REDACTED',
        correction: 'source-declaration-required',
      });
      expect(JSON.stringify(row)).not.toContain(VM);
      const notice = f.requests[1]?.messages.find(
        (message) => message.toolCallId === 'private-held',
      );
      expect(notice?.content).toContain('source-declaration-required');
      expect(notice?.content).not.toContain(VM);
      const correctionEvent = f.events.find(
        (event) =>
          event.type === 'agentfootprint.findings.argument' &&
          (event.payload as { toolCallId?: string }).toolCallId === 'private-held',
      );
      expect(JSON.stringify(correctionEvent)).not.toContain(VM);
      expect(argumentsOf(f.agent, 'private-run')[0]).toMatchObject({
        quote: 'REDACTED',
        source: 'said',
      });
      expect(f.ran).toEqual([{ vm: VM }]);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('uses the full reserved-reader fault even when a basis row owns its display counter', () => {
    const call = proposal('fault', {
      vm: VM,
      _findings: {
        basis: 'direct',
        from: [{ argument: 'other', source: 'user', quote: 7 }],
      },
    });
    const tool = defineTool({
      name: TOOL,
      description: 'Synthetic',
      inputSchema: { type: 'object', properties: { vm: { type: 'string' } } },
      askOrAssume: { vm: { ask: 'VM?' } },
      execute: () => [],
    });
    const declarations = declaredSourcesOf([call], () => tool, {
      basisRows: true,
      declarationCorrection: true,
    });
    expect(declarations[0]).toMatchObject({ from: [], declarationMalformed: true });
    expect(declarations[0]).not.toHaveProperty('malformed');
    const row = {
      kind: 'argument' as const,
      turn: 1,
      iteration: 1,
      toolCallId: 'fault',
      toolName: TOOL,
      argument: 'vm',
      asked: 'unverified' as const,
      claimed: 'none' as const,
    };
    const checked = {
      toolCallId: 'fault',
      toolName: TOOL,
      argument: 'vm',
      rule: 'ask' as const,
      asked: 'unverified' as const,
      check: { source: 'model' as const, claimed: 'none' as const },
    };
    expect(
      omissionRows(
        [row],
        [checked],
        [call],
        new Map(declarations.map((entry) => [entry.toolCallId, entry])),
      ),
    ).toEqual([]);
    const valid = { ...call, args: { vm: VM, _findings: { basis: 'direct', from: [] } } };
    const admitted = declaredSourcesOf([valid], () => tool, {
      basisRows: true,
      declarationCorrection: true,
    });
    expect(
      omissionRows(
        [row],
        [checked],
        [valid],
        new Map(admitted.map((entry) => [entry.toolCallId, entry])),
      ),
    ).toEqual([row]);
  });

  it('keeps a withheld private proposal out of the added iteration history event before any dispatch', async () => {
    const f = correctionFixture(
      [batch(proposal('private-held', { vm: VM })), 'No tool was needed.'],
      { hidden: true },
    );
    try {
      await f.agent.run('Read the selected synthetic VM.');
      expect(f.ran).toEqual([]);
      const ended = f.events.find((event) => event.type === 'agentfootprint.agent.iteration_end');
      expect(ended).toBeDefined();
      const history = (ended?.payload as { history?: readonly LLMMessage[] }).history ?? [];
      const call = history
        .flatMap((message) => message.toolCalls ?? [])
        .find((entry) => entry.id === 'private-held');
      expect(call).toBeDefined();
      expect(call?.args.vm).not.toBe(VM);
    } finally {
      await f.agent.shutdown();
    }
  });
});
