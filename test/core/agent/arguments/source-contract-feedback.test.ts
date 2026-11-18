/** Captured structural failure: a source entry at args.from is not args._findings.from. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Agent, defineTool, isInputPause, type LLMProvider } from '../../../../src/index.js';
import { validateToolArgs } from '../../../../src/tools/toolArgsValidation.js';
import {
  QUESTION,
  TOOL,
  VM,
  bag,
  buildFixtureAgent,
  conditionalFixture,
  contractIn,
  flatArgs,
  nestedArgs,
  reply,
  type Bag,
} from './sourceContractFixture.js';

describe('source-declaration feedback is an actual bounded structural protocol', () => {
  it.each([false, true])(
    'only a real typed contract unlocks a nested proposal (ledger=%s)',
    async (ledger) => {
      const f = conditionalFixture(ledger);
      try {
        await f.agent.run({ message: QUESTION });
        console.info(
          'SOURCE_CONTRACT_NATIVE_SCHEMA',
          JSON.stringify({
            ledger,
            sha256: f.requests.map((request) =>
              createHash('sha256').update(JSON.stringify(request.tools)).digest('hex'),
            ),
          }),
        );
        // The unchanged native implementation safely finishes without dispatch:
        // the authored provider cannot act on its generic prose as typed JSON.
        expect(f.ran).toEqual([{ vm: VM }]);
        expect(f.beforeExecution).toEqual([0, 0, 1]);
        const contract = f.contracts[0]!;
        expect(Object.keys(contract).sort()).toEqual([
          'code',
          'declarationSchema',
          'missingArguments',
          'path',
        ]);
        expect(contract).toMatchObject({
          code: 'source-declaration-required',
          path: ['_findings', 'from'],
          missingArguments: ['vm'],
        });
        expect(bag(contract.declarationSchema)).toBe(true);
        const root = contract.declarationSchema as Bag;
        const declaration = (root.properties as Bag)._findings as Bag;
        expect(declaration.required).toEqual(ledger ? ['basis', 'from'] : ['from']);
        const served = f.requests[1]!.tools!.find((candidate) => candidate.name === TOOL)!;
        const servedDeclaration = (served.inputSchema.properties as Bag)._findings as Bag;
        const from = (declaration.properties as Bag).from as Bag;
        expect(from).toEqual((servedDeclaration.properties as Bag).from);
        const source = ((from.items as Bag).properties as Bag).source as Bag;
        expect(source.enum).toEqual(['user', 'result', 'turn', 'app', 'assumed']);
        expect(source.description).toContain('app-supplied context');
        expect(root.required).toEqual(['_findings']);
        expect(validateToolArgs({}, root).ok).toBe(false);
        expect(validateToolArgs(flatArgs(), root).ok).toBe(false);
        expect(validateToolArgs(nestedArgs(), root).ok).toBe(true);
        expect(validateToolArgs({ ...nestedArgs(), from: 'business-argument' }, root).ok).toBe(
          true,
        );
        expect(validateToolArgs({ _findings: { basis: 'direct', from: [] } }, root).ok).toBe(true);
        expect(JSON.stringify(contract)).not.toContain(VM);
        expect(JSON.stringify(contract)).not.toContain('flat-proposal');
        expect(JSON.stringify(contract)).not.toContain('previous');
        const schemas = f.requests.map((request) => JSON.stringify(request.tools));
        expect(new Set(schemas).size).toBe(1);
        const tool = f.requests[1]!.tools!.find((candidate) => candidate.name === TOOL)!;
        expect(tool.inputSchema.required ?? []).toContain('_findings');
        const history = f.agent.getSnapshot()?.sharedState.history as {
          role: string;
          toolCallId?: string;
          toolResultOrigin?: string;
          toolChars?: number;
        }[];
        expect(
          history.find(
            (message) => message.toolCallId === 'flat-proposal' && message.role === 'tool',
          ),
        ).toMatchObject({ toolResultOrigin: 'not-entered', toolChars: 0 });
        const rows = f.agent.findings() as unknown as Bag[];
        expect(rows.find((row) => row.toolCallId === 'flat-proposal')).toMatchObject({
          claimed: 'none',
          correction: 'source-declaration-required',
        });
        expect(
          rows.some(
            (row) =>
              row.toolCallId === 'nested-proposal' &&
              row.source === 'said' &&
              row.claimed === 'user',
          ),
        ).toBe(true);
      } finally {
        await f.agent.shutdown();
      }
    },
  );

  it.each([false, true])(
    'repeating the misplaced root claim still asks a real person (ledger=%s)',
    async (ledger) => {
      const f = conditionalFixture(ledger, true);
      try {
        const out = await f.agent.run({ message: QUESTION });
        expect(isInputPause(out)).toBe(true);
        expect(f.ran).toEqual([]);
        expect(f.requests).toHaveLength(2);
        const rows = f.agent.findings() as unknown as Bag[];
        expect(rows.filter((row) => row.correction === 'source-declaration-required')).toHaveLength(
          1,
        );
        expect(rows.find((row) => row.toolCallId === 'flat-again')).toMatchObject({
          claimed: 'none',
          asked: 'unverified',
        });
      } finally {
        await f.agent.shutdown();
      }
    },
  );

  it('keeps a legitimate root business from argument under its original tool schema', async () => {
    const ran: Bag[] = [];
    let requests = 0;
    const tool = defineTool({
      name: TOOL,
      description: 'A synthetic tool with its own from argument.',
      inputSchema: {
        type: 'object',
        properties: {
          vm: { type: 'string' },
          from: { type: 'string', enum: ['business-argument'] },
        },
        required: ['vm', 'from'],
        additionalProperties: false,
      },
      askOrAssume: { vm: { ask: 'Which VM?' } },
      execute(args) {
        ran.push(args);
        return [{ ok: true }];
      },
    });
    const provider: LLMProvider = {
      name: 'business-from-fixture',
      async complete(request) {
        requests++;
        if (requests === 1) return reply('flat-proposal', { vm: VM, from: 'business-argument' });
        if (requests === 2) {
          const notice = request.messages.find(
            (message) => message.role === 'tool' && message.toolCallId === 'flat-proposal',
          );
          const contract = contractIn(notice?.content);
          if (
            contract &&
            bag(contract.declarationSchema) &&
            validateToolArgs(
              { ...nestedArgs(), from: 'business-argument' },
              contract.declarationSchema,
            ).ok
          )
            return reply('business-nested', { ...nestedArgs(), from: 'business-argument' });
        }
        return reply();
      },
    };
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 4 })
      .tool(tool)
      .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
      .build();
    try {
      await agent.run({ message: QUESTION });
      expect(ran).toEqual([{ vm: VM, from: 'business-argument' }]);
      expect(requests).toBe(3);
    } finally {
      await agent.shutdown();
    }
  });

  it('matching a value already present in the schema cannot redeem the held notice as producer evidence', async () => {
    const ran: Bag[] = [];
    let requests = 0,
      notice = '';
    const provider: LLMProvider = {
      name: 'schema-value-is-not-producer-evidence',
      async complete(request) {
        requests++;
        if (requests === 1)
          return reply('flat-proposal', {
            vm: 'direct',
            from: [{ argument: 'vm', source: 'user', quote: 'VM direct' }],
          });
        notice =
          request.messages.find(
            (message) => message.role === 'tool' && message.toolCallId === 'flat-proposal',
          )?.content ?? '';
        if (contractIn(notice))
          return reply('notice-citation', {
            vm: 'direct',
            _findings: {
              basis: 'direct',
              from: [{ argument: 'vm', source: 'result', id: 'flat-proposal' }],
            },
          });
        return reply();
      },
    };
    const agent = buildFixtureAgent(provider, ran, true);
    try {
      const out = await agent.run({ message: 'Read disks for VM direct.' });
      expect(notice).toContain('"direct"');
      expect(isInputPause(out)).toBe(true);
      expect(ran).toEqual([]);
      expect(requests).toBe(2);
      expect(
        (agent.findings() as unknown as Bag[]).find((row) => row.toolCallId === 'notice-citation'),
      ).toMatchObject({ claimed: 'result', asked: 'unverified', failed: 'unknown-result' });
    } finally {
      await agent.shutdown();
    }
  });

  it.each(['utf8-notice', 'whole-batch'] as const)(
    'an unrepresentable %s contract falls back before spending correction',
    async (bound) => {
      const names =
        bound === 'utf8-notice'
          ? Array.from({ length: 16 }, (_, i) => `field_${i}_${'é'.repeat(300)}`)
          : ['vm'];
      let requests = 0,
        executed = 0;
      const tool = defineTool({
        name: TOOL,
        description: 'A bounded synthetic name-set fixture.',
        inputSchema: {
          type: 'object',
          properties: Object.fromEntries(names.map((name) => [name, { type: 'string' }])),
        },
        askOrAssume: Object.fromEntries(
          names.map((name) => [name, { ask: 'Which synthetic value?' }]),
        ),
        execute() {
          executed++;
          return 'Never reached.';
        },
      });
      const sibling = defineTool({
        name: 'held_sibling',
        description: 'No sibling may run before admission.',
        execute() {
          executed++;
          return 'Never reached.';
        },
      });
      const provider: LLMProvider = {
        name: 'unrepresentable-contract-fixture',
        async complete() {
          requests++;
          return {
            content: requests === 1 ? '' : 'No correction was expected.',
            stopReason: requests === 1 ? 'tool_use' : 'end_turn',
            usage: { input: 0, output: 0 },
            toolCalls:
              requests === 1
                ? [
                    {
                      id: 'unrepresentable',
                      name: TOOL,
                      args: Object.fromEntries(names.map((name) => [name, 'synthetic-value'])),
                    },
                    ...(bound === 'whole-batch'
                      ? Array.from({ length: 512 }, (_, i) => ({
                          id: `sibling-${i}`,
                          name: 'held_sibling',
                          args: {},
                        }))
                      : []),
                  ]
                : [],
          };
        },
      };
      const agent = Agent.create({ provider, model: 'mock', maxIterations: 3 })
        .tool(tool)
        .tool(sibling)
        .inputsLayer({ argumentSources: true, declarationCorrection: 'once' })
        .build();
      try {
        const out = await agent.run({ message: 'Read the synthetic selection.' });
        expect(isInputPause(out)).toBe(true);
        expect(requests).toBe(1);
        expect(executed).toBe(0);
        expect(agent.getSnapshot()?.sharedState.sourceDeclarationCorrectionSpent).not.toBe(true);
        expect(
          (agent.findings() as unknown as Bag[]).some((row) => row.correction !== undefined),
        ).toBe(false);
      } finally {
        await agent.shutdown();
      }
    },
  );
});
