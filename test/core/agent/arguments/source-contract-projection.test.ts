/** Public native request contracts; no new API or provider behavior is assumed. */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  Agent,
  defineTool,
  isPaused,
  receiptAt,
  receiptHash,
  servedAt,
  type LLMProvider,
  type LLMRequest,
  type LLMResponse,
  type Tool,
} from '../../../../src/index.js';
import { validateToolArgs } from '../../../../src/tools/toolArgsValidation.js';
import { FINDINGS_INSTRUCTION } from '../../../../src/core/agent/findings/reserved.js';
import { ASK_SOURCES_SENTENCE } from '../../../../src/core/agent/arguments/serve/schema.js';
import { assumeSentence } from '../../../../src/core/agent/arguments/serve/values.js';
import type { ContextRecordedPayload } from '../../../../src/events/payloads/contextRecorded.js';

type Bag = Record<string, unknown>;
const VM = 'synthetic-contract-vm';
const QUESTION = `Read the disks for ${VM}.`;
const DONE: LLMResponse = {
  content: 'Done.',
  toolCalls: [],
  stopReason: 'end_turn',
  usage: { input: 0, output: 0 },
};
const call = (args: Bag): LLMResponse => ({
  ...DONE,
  content: '',
  stopReason: 'tool_use',
  toolCalls: [{ id: 'actual-proposal', name: 'read_disks', args }],
});
const quoted = () => ({
  basis: 'direct',
  from: [{ argument: 'vm', source: 'user', quote: QUESTION }],
});

function tools(ran: Bag[]) {
  const schema = {
    type: 'object',
    properties: { vm: { type: 'string' }, from: { type: 'string' } },
    required: ['vm'],
  };
  return [
    defineTool({
      name: 'read_disks',
      description: 'Read synthetic disks.',
      inputSchema: schema,
      askOrAssume: { vm: { ask: 'Which VM?' } },
      execute(args) {
        ran.push(args);
        return [];
      },
    }),
    defineTool({
      name: 'default_disks',
      description: 'Read the authored default.',
      inputSchema: schema,
      askOrAssume: { vm: { assume: VM } },
      execute: () => [],
    }),
    defineTool({
      name: 'plain_disks',
      description: 'An unruled source.',
      inputSchema: schema,
      execute: () => [],
    }),
  ];
}

function fixture(
  options: {
    ledger: boolean;
    sources: boolean;
    mode?: 'dynamic' | 'dynamic-grouped';
    once?: boolean;
    redact?: { keys: string[] };
    system?: string;
  },
  replies: readonly LLMResponse[] = [DONE],
  external?: Tool,
) {
  const requests: LLMRequest[] = [],
    ran: Bag[] = [];
  const provider: LLMProvider = {
    name: 'native-source-contract-capture',
    async complete(request) {
      requests.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })) as LLMRequest);
      const response = replies[requests.length - 1];
      if (!response) throw Error('The authored fixture has no further provider response.');
      return response;
    },
  };
  const builder = Agent.create({
    provider,
    model: 'synthetic',
    reactMode: options.mode ?? 'dynamic',
    ...(options.redact && { redact: options.redact }),
  })
    .tools(tools(ran))
    .inputsLayer({
      argumentSources: options.sources,
      ...(options.once && { declarationCorrection: 'once' as const }),
    });
  if (options.ledger) builder.findings({ argumentSources: options.sources });
  if (options.system) builder.system(options.system);
  if (external) builder.toolProvider({ id: 'authored-owner', list: () => [external] });
  const agent = builder.build();
  return {
    agent,
    requests,
    ran,
    async first() {
      await agent.run({ message: QUESTION });
      expect(requests.length).toBeGreaterThan(0);
      console.info(
        'SOURCE_CONTRACT_COHORT',
        JSON.stringify({
          ledger: options.ledger,
          sources: options.sources,
          mode: options.mode ?? 'dynamic',
          schemas: requests[0]!.tools?.map((tool) => ({
            name: tool.name,
            sha256: createHash('sha256').update(JSON.stringify(tool)).digest('hex'),
          })),
        }),
      );
      return requests[0]!;
    },
  };
}

function schema(request: LLMRequest, name = 'read_disks'): Bag {
  const tool = request.tools?.find((tool) => tool.name === name);
  expect(tool, 'the actual native request must offer the resolved tool').toBeDefined();
  return tool!.inputSchema as Bag;
}
const envelope = (input: Bag) => (input.properties as Bag)._findings as Bag | undefined;

describe('source contract projection on actual native provider requests', () => {
  for (const ledger of [false, true])
    for (const mode of ['dynamic', 'dynamic-grouped'] as const) {
      it(`requires the source envelope for an ask obligation (ledger=${ledger}, ${mode})`, async () => {
        const f = fixture({ ledger, sources: true, mode });
        try {
          const input = schema(await f.first());
          expect((input.required as unknown[] | undefined) ?? []).toContain('_findings');
          const declared = envelope(input)!;
          expect(declared.required).toContain('from');
          expect(declared.required).toEqual(ledger ? ['basis', 'from'] : ['from']);
          const flat = { vm: VM, from: [{ argument: 'vm', source: 'user', quote: QUESTION }] };
          expect(
            validateToolArgs(flat, input).ok,
            'root from cannot satisfy the advertised envelope',
          ).toBe(false);
          expect(validateToolArgs({ vm: VM, _findings: quoted() }, input).ok).toBe(true);
          expect(
            validateToolArgs({ _findings: { ...(ledger && { basis: 'direct' }), from: [] } }, input)
              .ok,
            'a genuinely absent VM must remain structurally representable for the native human ask',
          ).toBe(true);
        } finally {
          await f.agent.shutdown();
        }
      });
    }

  it('the actual ask hint names every source the native ask admission accepts', async () => {
    const f = fixture({ ledger: true, sources: true });
    try {
      const input = schema(await f.first());
      const hint = String(((input.properties as Bag).vm as Bag).description);
      expect(hint).not.toContain('unless the person gave it');
      expect(hint).toContain('_findings.from');
      for (const source of ['user', 'result', 'turn', 'app']) expect(hint).toContain(source);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('source-armed findings teaching does not advertise the entire contract as optional', async () => {
    const f = fixture({ ledger: true, sources: true });
    try {
      const request = await f.first();
      expect(request.systemPrompt).not.toContain(
        'Tool schemas carry an optional `_findings` argument',
      );
      expect(request.systemPrompt).toContain('_findings.from');
    } finally {
      await f.agent.shutdown();
    }
  });

  it('once-only correction is not what determines the static source obligation', async () => {
    const first = fixture({ ledger: true, sources: true });
    const second = fixture({ ledger: true, sources: true, once: true });
    try {
      expect(schema(await first.first())).toEqual(schema(await second.first()));
    } finally {
      await first.agent.shutdown();
      await second.agent.shutdown();
    }
  });

  for (const ledger of [false, true])
    it(`preserves unruled and assume-only optionality (ledger=${ledger})`, async () => {
      const f = fixture({ ledger, sources: true });
      try {
        const request = await f.first();
        for (const name of ['plain_disks', 'default_disks']) {
          const input = schema(request, name);
          expect((input.required as unknown[] | undefined) ?? []).not.toContain('_findings');
          if (!ledger && name === 'plain_disks') expect(envelope(input)).toBeUndefined();
        }
      } finally {
        await f.agent.shutdown();
      }
    });

  it('preserves optional observations with explicitly mounted inputs but disabled sources', async () => {
    const f = fixture({ ledger: true, sources: false });
    try {
      const request = await f.first(),
        input = schema(request);
      expect((input.required as unknown[] | undefined) ?? []).not.toContain('_findings');
      expect(envelope(input)?.properties).not.toHaveProperty('from');
      expect(request.systemPrompt).toContain('Tool schemas carry an optional `_findings` argument');
      expect(String(((input.properties as Bag).vm as Bag).description)).toContain(
        'unless the person gave it',
      );
    } finally {
      await f.agent.shutdown();
    }
  });

  it('does not claim a provider author-owned property or install the source hint on it', async () => {
    const external: Tool = {
      schema: {
        name: 'author_disks',
        description: 'An author-owned envelope.',
        inputSchema: {
          type: 'object',
          properties: { vm: { type: 'string' }, _findings: { type: 'string' } },
          required: ['vm', '_findings'],
        },
      },
      askOrAssume: { vm: { ask: 'Which VM?' } },
      execute: () => [],
    };
    const first = fixture({ ledger: true, sources: false }, [DONE], external);
    const second = fixture({ ledger: true, sources: true }, [DONE], external);
    try {
      const off = schema(await first.first(), 'author_disks'),
        on = schema(await second.first(), 'author_disks');
      expect(on).toEqual(off);
      expect(envelope(on)).toEqual({ type: 'string' });
      expect(String(((on.properties as Bag).vm as Bag).description)).not.toContain(
        '_findings.from',
      );
    } finally {
      await first.agent.shutdown();
      await second.agent.shutdown();
    }
  });

  it('preserves a legitimate business root from while peeling only native metadata', async () => {
    const f = fixture({ ledger: true, sources: true }, [
      call({ vm: VM, from: 'business-input', _findings: quoted() }),
      DONE,
    ]);
    try {
      expect(await f.agent.run({ message: QUESTION })).toBe('Done.');
      expect(f.ran).toEqual([{ vm: VM, from: 'business-input' }]);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('empty declarations still earn no source and a real missing value asks immediately', async () => {
    const f = fixture({ ledger: true, sources: true, once: true }, [
      call({ _findings: { basis: 'direct', from: [] } }),
    ]);
    try {
      const outcome = await f.agent.run({ message: 'Read disks for a VM.' });
      expect(isPaused(outcome)).toBe(true);
      expect(f.requests).toHaveLength(1);
      expect(f.ran).toEqual([]);
      expect(f.agent.findings()?.some((row) => 'correction' in row)).toBe(false);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('a provider ASK withdrawal restores the exact optional observation instruction on the current cohort', async () => {
    const requests: LLMRequest[] = [],
      ran: Bag[] = [];
    const [ask, assume] = tools(ran);
    const replacement = { ...assume!, schema: { ...assume!.schema, name: ask!.schema.name } };
    const trigger = defineTool({
      name: 'next_round',
      description: 'Advance the synthetic observation.',
      inputSchema: { type: 'object' },
      execute: () => [],
    });
    const provider: LLMProvider = {
      name: 'current-native-provider-cohort',
      async complete(request) {
        requests.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })) as LLMRequest);
        return requests.length === 1
          ? {
              ...DONE,
              content: '',
              stopReason: 'tool_use',
              toolCalls: [{ id: 'advance', name: trigger.schema.name, args: {} }],
            }
          : DONE;
      },
    };
    const agent = Agent.create({ provider, model: 'synthetic', maxIterations: 3 })
      .tool(trigger)
      .toolProvider({
        id: 'changing-source',
        list: () => (requests.length === 0 ? [ask!] : [replacement]),
      })
      .inputsLayer({ argumentSources: true })
      .findings({ argumentSources: true })
      .build();
    const frames: ContextRecordedPayload[] = [];
    const off = agent.on('agentfootprint.context.recorded', (event) => frames.push(event.payload));
    try {
      expect(await agent.run({ message: QUESTION })).toBe('Done.');
      expect(requests).toHaveLength(2);
      expect(
        ((schema(requests[0]!).properties as Bag).vm as Bag).description,
        'the first actual offered implementation must be the authored ASK tool',
      ).toBe(ASK_SOURCES_SENTENCE);
      expect(
        ((schema(requests[1]!).properties as Bag).vm as Bag).description,
        'the second actual offered implementation must be the authored ASSUME replacement',
      ).toBe(assumeSentence(VM, false));
      expect((schema(requests[0]!).required as unknown[] | undefined) ?? []).toContain('_findings');
      expect((schema(requests[1]!).required as unknown[] | undefined) ?? []).not.toContain(
        '_findings',
      );
      expect(requests[0]!.systemPrompt).not.toContain(
        'Tool schemas carry an optional `_findings` argument',
      );
      expect(requests[1]!.systemPrompt).toBe(FINDINGS_INSTRUCTION);
      const snapshot = agent.getSnapshot()!;
      expect(frames).toHaveLength(2);
      for (const [index, request] of requests.entries()) {
        const receipt = receiptAt(snapshot, index + 1)!;
        const view = servedAt(snapshot, index + 1)!;
        expect(receipt).toBeDefined();
        expect(view).toBeDefined();
        expect(view.system.text).toBe(request.systemPrompt);
        expect(receipt.system.chars).toBe(request.systemPrompt!.length);
        expect(receipt.system.hash).toBe(receiptHash(receipt.basis.runId, request.systemPrompt!));
        expect(view.tools.schemas).toEqual(request.tools);
        expect(
          frames[index]!.pieces.filter(
            (piece) => piece.source !== 'registry' && piece.source !== 'request-only',
          ).map((piece) => piece.rawContent),
        ).toEqual(view.system.pieces.map((piece) => piece.text));
        expect(
          frames[index]!.pieces.filter((piece) => piece.source === 'request-only').map(
            (piece) => piece.rawContent,
          ),
        ).toEqual(view.messages.requestOnly.map((piece) => piece.text));
        expect(
          frames[index]!.pieces.filter((piece) => piece.source === 'registry').map(
            (piece) => piece.schema,
          ),
        ).toEqual(request.tools);
        expect(receipt.system.pieces.map((piece) => piece.hash)).toEqual(
          view.system.pieces.map((piece) => receiptHash(receipt.basis.runId, piece.text)),
        );
      }
      expect(ran).toEqual([]);
    } finally {
      off();
      await agent.shutdown();
    }
  });

  it('registered ASK rules already enforce findings sources without an explicit inputsLayer call', async () => {
    const requests: LLMRequest[] = [],
      ran: Bag[] = [];
    const provider: LLMProvider = {
      name: 'native-automatic-inputs',
      async complete(request) {
        requests.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })) as LLMRequest);
        return call({ vm: VM });
      },
    };
    const agent = Agent.create({ provider, model: 'synthetic' })
      .tool(tools(ran)[0]!)
      .findings({ argumentSources: true })
      .build();
    try {
      const outcome = await agent.run({ message: QUESTION });
      expect(isPaused(outcome)).toBe(true);
      expect(requests).toHaveLength(1);
      expect(ran).toEqual([]);
      expect(
        agent
          .findings()
          ?.some(
            (row) =>
              row.kind === 'argument' &&
              row.argument === 'vm' &&
              row.asked === 'unverified' &&
              row.claimed === 'none',
          ),
      ).toBe(true);
      expect((schema(requests[0]!).required as unknown[] | undefined) ?? []).toContain('_findings');
    } finally {
      await agent.shutdown();
    }
  });

  it('ordinary findings without an explicit inputsLayer call keep optional observations and existing dispatch', async () => {
    const requests: LLMRequest[] = [],
      ran: Bag[] = [];
    const provider: LLMProvider = {
      name: 'native-observational-findings',
      async complete(request) {
        requests.push(JSON.parse(JSON.stringify({ ...request, signal: undefined })) as LLMRequest);
        return requests.length === 1 ? call({ vm: VM }) : DONE;
      },
    };
    const agent = Agent.create({ provider, model: 'synthetic' })
      .tool(tools(ran)[0]!)
      .findings()
      .build();
    try {
      expect(await agent.run({ message: QUESTION })).toBe('Done.');
      expect(ran).toEqual([{ vm: VM }]);
      expect((schema(requests[0]!).required as unknown[] | undefined) ?? []).not.toContain(
        '_findings',
      );
      expect(requests[0]!.systemPrompt).toContain(FINDINGS_INSTRUCTION.split('\n')[0]);
    } finally {
      await agent.shutdown();
    }
  });

  it('the findings source door still refuses a future provider ASK without an armed inputs layer', () => {
    const provider: LLMProvider = {
      name: 'unarmed-native-provider',
      async complete() {
        return DONE;
      },
    };
    expect(() =>
      Agent.create({ provider, model: 'synthetic' })
        .toolProvider({ id: 'future-ask', list: () => [tools([])[0]!] })
        .findings({ argumentSources: true })
        .build(),
    ).toThrow(/needs the inputs layer/);
  });

  it('does not infer an optional source instruction when privacy withheld the actual offered schemas', async () => {
    const app = 'PUBLIC-AUTHORED-PIECE-941';
    const f = fixture({
      ledger: true,
      sources: true,
      redact: { keys: ['dynamicToolSchemas', 'toolSchemas'] },
      system: app,
    });
    try {
      const wire = await f.first();
      expect(wire.systemPrompt).toContain('where _findings is required');
      const snapshot = f.agent.getSnapshot()!;
      expect(snapshot.sharedState.dynamicToolSchemas).toBe('REDACTED');
      expect(JSON.stringify(snapshot.sharedState.systemPromptInjections)).toContain(app);
      const before = JSON.stringify(snapshot);
      const view = servedAt(snapshot, 1)!;
      expect(view.gaps.map((gap) => gap.gap)).toContain('privacy-policy');
      expect(view.tools.schemas).toEqual([]);
      expect(view.system.text).toContain(app);
      expect(view.system.pieces.some((piece) => piece.text.startsWith('Findings v1.'))).toBe(false);
      expect(view.system.text).not.toContain('optional `_findings`');
      expect(JSON.stringify(snapshot)).toBe(before);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('rebuilds visible marker-free recordings byte-for-byte without rewriting the saved history', async () => {
    const f = fixture({ ledger: true, sources: false });
    try {
      const wire = await f.first();
      const snapshot = JSON.parse(JSON.stringify(f.agent.getSnapshot()!));
      expect(JSON.stringify(wire.tools)).not.toContain('agentfootprint:source-contract');
      const before = JSON.stringify(snapshot);
      const first = servedAt(snapshot, 1)!;
      expect(first.system.text).toBe(wire.systemPrompt);
      expect(first.tools.schemas).toEqual(wire.tools);
      expect(servedAt(snapshot, 1)).toEqual(first);
      expect(JSON.stringify(snapshot)).toBe(before);
    } finally {
      await f.agent.shutdown();
    }
  });
});
