/**
 * `stream.tool_end` says what the RULES did — additive fields, absent unless a
 * CONFIGURED rule acted, so an agent with no rule records the bytes it always
 * did (the byte law; owner ruling, fix round 2).
 *
 * `tool_start` is the model's proposal (emitted before the permission gate and
 * the before-tool chain) and `tool_end.result` is the tool's own answer (the
 * after-tool chain rewrites only what the model reads). Three optional fields:
 *
 *   - `modelResult`    — what the model read, when an `onToolResult` link or
 *                        the cap made it differ from `result`;
 *   - `changedArgKeys` — the NAMES of the keys an `onToolCall` link changed or
 *                        the tool's own `redact` policy hides — never values,
 *                        and taken BEFORE the tool runs;
 *   - `notExecuted`    — a configured rule (permission policy, `onToolCall`)
 *                        refused the call.
 *
 * Test types: UNIT (the helpers), SCENARIO (real Agent runs through the
 * dispatch path), BOUNDARY (the byte law on every no-rule path the second
 * review found), SECURITY (the privacy review's round-2 attacks, inverted).
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flowChart } from 'footprintjs';
import { Agent, absent, allow, defineTool, deny, flowchartAsTool } from '../../src/index.js';
import { MockProvider } from '../../src/adapters/llm/MockProvider.js';
import { fileObservability } from '../../src/adapters/observability/file.js';
import { bearer, type CredentialProvider } from '../../src/identity.js';
import {
  argsRedactedBy,
  changedArgKeys,
  SHOWN_ARGS,
  shownArgsOf,
} from '../../src/core/toolShownArgs.js';
import { filedNothing } from '../../src/integrity/disposition/ledger.js';

type Payload = Record<string, unknown>;
type Built = ReturnType<ReturnType<typeof Agent.create>['build']>;

async function runCapturing(
  build: (b: ReturnType<typeof Agent.create>) => ReturnType<typeof Agent.create>,
  call: { name: string; args: Record<string, unknown> },
  createOptions: Record<string, unknown> = {},
): Promise<{ starts: Payload[]; ends: Payload[]; absences: Payload[]; agent: Built }> {
  const provider = new MockProvider({
    replies: [{ toolCalls: [{ id: 'tc-1', name: call.name, args: call.args }] }, 'done'],
  });
  const agent = build(
    Agent.create({ provider, model: 'mock', ...createOptions } as never).system(''),
  ).build();
  const starts: Payload[] = [];
  const ends: Payload[] = [];
  const absences: Payload[] = [];
  agent.on('agentfootprint.stream.tool_start', (e) => starts.push(e.payload as Payload));
  agent.on('agentfootprint.stream.tool_end', (e) => ends.push(e.payload as Payload));
  agent.on('agentfootprint.tools.absent', (e) => absences.push(e.payload as Payload));
  await agent.run({ message: 'go' });
  return { starts, ends, absences, agent };
}

const lookup = (execute: (args: Record<string, unknown>) => unknown) => ({
  schema: { name: 'lookup', description: 'd', inputSchema: { type: 'object' } },
  execute,
});

const NEW_FIELDS = ['modelResult', 'changedArgKeys', 'notExecuted'];
const newFieldsOn = (p: Payload): string[] => NEW_FIELDS.filter((k) => k in p);

describe('BOUNDARY — the byte law: no configured rule, no new field', () => {
  it('a call that ran', async () => {
    const { ends } = await runCapturing((b) => b.tool(lookup(() => ({ balance: 1 }))), {
      name: 'lookup',
      args: { account: 'A-1' },
    });
    expect(Object.keys(ends[0]!).sort()).toEqual(['durationMs', 'result', 'toolCallId']);
  });

  it('an unknown tool name — error: true alone', async () => {
    const { ends } = await runCapturing((b) => b.tool(lookup(() => 'x')), {
      name: 'nope',
      args: {},
    });
    expect(ends[0]!.error).toBe(true);
    expect(newFieldsOn(ends[0]!)).toEqual([]);
  });

  it('arguments rejected under the default enforce validation — error: true alone', async () => {
    const { ends } = await runCapturing(
      (b) =>
        b.tool(
          defineTool({
            name: 'num',
            description: 'needs a number',
            inputSchema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] },
            execute: () => 'ran',
          }),
        ),
      { name: 'num', args: { n: 'not-a-number' } },
    );
    expect(ends[0]!.error).toBe(true);
    expect(newFieldsOn(ends[0]!)).toEqual([]);
  });

  it('a credential provider that throws — error: true alone', async () => {
    const credentials = {
      id: 'v',
      getCredential: async () => {
        throw new Error('vault down');
      },
    } as unknown as CredentialProvider;
    const { ends } = await runCapturing(
      (b) =>
        b.tool(
          defineTool({
            name: 'billing',
            description: 'needs a cred',
            needs: { credential: 'billing' },
            execute: () => 'ran',
          }),
        ),
      { name: 'billing', args: {} },
      { credentials },
    );
    expect(ends[0]!.error).toBe(true);
    expect(newFieldsOn(ends[0]!)).toEqual([]);
  });

  it('a plain absent() naming a registered tool — tools.absent carries no new key', async () => {
    const { absences } = await runCapturing(
      (b) =>
        b
          .tool({
            schema: { name: 'find', description: 'd', inputSchema: { type: 'object' } },
            execute: () =>
              absent({
                what: 'orders',
                checked: ['orders db'],
                tryInsteadTool: { tool: 'archive_lookup' },
              }),
          })
          .tool({
            schema: { name: 'archive_lookup', description: 'd', inputSchema: { type: 'object' } },
            execute: () => 'none',
          }),
      { name: 'find', args: {} },
    );
    expect(Object.keys(absences[0]!).sort()).toEqual([
      'checked',
      'iteration',
      'lookedFor',
      'toolCallId',
      'toolName',
      'tryInsteadTool',
    ]);
  });

  it('a tool that threw DID run: error, and no notExecuted', async () => {
    const { ends } = await runCapturing(
      (b) =>
        b.tool(
          lookup(() => {
            throw new Error('boom');
          }),
        ),
      { name: 'lookup', args: {} },
    );
    expect(ends[0]!.error).toBe(true);
    expect(newFieldsOn(ends[0]!)).toEqual([]);
  });
});

describe('SCENARIO — each field appears exactly when its rule acted', () => {
  it('an onToolCall rewrite: changedArgKeys names the key; tool_start stays the proposal', async () => {
    const { starts, ends } = await runCapturing(
      (b) =>
        b.tool(lookup(() => 'sent')).toolMiddleware({
          name: 'strip',
          onToolCall: (call) => allow({ ...call.args, body: '[removed]' }, 'stripped'),
        }),
      { name: 'lookup', args: { body: 'password=hunter2', to: 'ops' } },
    );
    expect(starts[0]!.args).toEqual({ body: 'password=hunter2', to: 'ops' });
    expect(ends[0]!.changedArgKeys).toEqual(['body']);
    expect(JSON.stringify(ends[0])).not.toContain('[removed]');
  });

  it('an onToolResult rewrite: modelResult is what the model read; result stays the tool’s answer', async () => {
    const { ends } = await runCapturing(
      (b) =>
        b.tool(lookup(() => ({ ssn: '123-45-6789' }))).toolMiddleware({
          name: 'mask',
          onToolResult: () => allow({ ssn: '[ssn]' }, 'masked'),
        }),
      { name: 'lookup', args: {} },
    );
    expect(ends[0]!.result).toEqual({ ssn: '123-45-6789' });
    expect(ends[0]!.modelResult).toEqual({ ssn: '[ssn]' });
  });

  it('a call a rule denied never ran: notExecuted, and no error', async () => {
    const { ends } = await runCapturing(
      (b) =>
        b
          .tool(lookup(() => 'moved'))
          .toolMiddleware({ name: 'no', onToolCall: () => deny('ticket') }),
      { name: 'lookup', args: { iban: 'DE89' } },
    );
    expect(ends[0]!.notExecuted).toBe(true);
    expect(ends[0]!.error).toBeUndefined();
    expect('changedArgKeys' in ends[0]!).toBe(false);
  });

  it('flowchartAsTool({ redact }) — the hidden key is named, its value never rides', async () => {
    const SECRET = 'sk-live-USER-PASTED-KEY-777';
    const inner = flowChart<{ used: string }>(
      'Use the key',
      (scope) => {
        scope.used = 'called';
      },
      'use-key',
    ).build();
    const tool = flowchartAsTool({
      name: 'check_account',
      description: 'checks an account with the user key',
      flowchart: inner,
      redact: { keys: ['apiKey'] },
    });
    const { ends } = await runCapturing((b) => b.tool(tool), {
      name: 'check_account',
      args: { apiKey: SECRET, region: 'eu' },
    });
    expect(ends[0]!.changedArgKeys).toEqual(['apiKey']);
    expect(JSON.stringify(ends[0])).not.toContain(SECRET);
  });
});

describe('SECURITY — round-2 attacks on the new fields (otel-DEVIL.md, R2-A/B/B2), inverted', () => {
  it('R2-B: a value an onToolCall ADDED never rides tool_end — on the event or the NDJSON sink', async () => {
    const SERVER_KEY = 'svc-R2B-INTERNAL-API-KEY';
    const dir = mkdtempSync(join(tmpdir(), 'af-otel-r2b-'));
    const path = join(dir, 'events.ndjson');
    const file = fileObservability({ path });
    const provider = new MockProvider({
      replies: [{ toolCalls: [{ id: 't1', name: 'crm', args: { q: 'acme' } }] }, 'done'],
    });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('')
      .tool({
        schema: { name: 'crm', description: 'd', inputSchema: { type: 'object' } },
        execute: () => 'ok',
      })
      .toolMiddleware({
        name: 'inject-tenant-key',
        onToolCall: (call) => allow({ ...call.args, apiKey: SERVER_KEY }, 'scoped the call'),
      })
      .build();
    const ends: Payload[] = [];
    agent.on('agentfootprint.stream.tool_end', (e) => ends.push(e.payload as Payload));
    const stop = agent.enable.observability({ strategy: file });
    try {
      await agent.run({ message: 'go' });
    } finally {
      stop();
      await file.flush?.();
    }
    expect(ends[0]!.changedArgKeys).toEqual(['apiKey']);
    expect(JSON.stringify(ends)).not.toContain(SERVER_KEY);
    expect(readFileSync(path, 'utf8')).not.toContain(SERVER_KEY);
  });

  it('R2-A / R2-B2: a tool that writes into its arguments cannot put the write on tool_end', async () => {
    const TOKEN = 'tok-R2B2-LIVE';
    const { ends } = await runCapturing(
      (b) =>
        b
          .tool(
            lookup((args) => {
              Object.assign(args, { headers: bearer(TOKEN).toHeaders() });
              args.authorization = `Bearer ${TOKEN}`;
              return 'sent';
            }),
          )
          .toolMiddleware({
            name: 'strip-passwords',
            onToolCall: (call) => allow({ ...call.args, body: '[removed]' }, 'stripped'),
          }),
      { name: 'lookup', args: { body: 'hi password=hunter2' } },
    );
    // Taken BEFORE the tool ran: the key it added afterwards is not named.
    expect(ends[0]!.changedArgKeys).toEqual(['body']);
    expect(JSON.stringify(ends)).not.toContain(TOKEN);
  });
});

describe('UNIT — the helpers', () => {
  it('shownArgsOf: no view → the same reference', () => {
    const args = { a: 1 };
    expect(shownArgsOf({}, args)).toBe(args);
    expect(shownArgsOf(undefined, args)).toBe(args);
  });

  it('argsRedactedBy: nothing named → the same reference; a named key → the placeholder', () => {
    const view = argsRedactedBy({ keys: ['apiKey'] });
    const clean = { region: 'eu' };
    expect(view(clean)).toBe(clean);
    expect(view({ apiKey: 'k', region: 'eu' })).toEqual({ apiKey: 'REDACTED', region: 'eu' });
  });

  it('a view that throws hides every key rather than show what it could not judge', () => {
    const tool = {
      [SHOWN_ARGS]: () => {
        throw new Error('bad policy');
      },
    };
    expect(shownArgsOf(tool, { a: 1, b: 2 })).toEqual({ a: 'REDACTED', b: 'REDACTED' });
  });

  it('changedArgKeys: set, rewritten and removed keys by reference; untouched keys never', () => {
    const nested = { deep: 1 };
    const proposal = { same: 'x', nested, rewritten: 'a', removed: 1 };
    expect(changedArgKeys(proposal, proposal)).toEqual([]);
    expect(changedArgKeys(proposal, { same: 'x', nested, rewritten: 'b', added: 2 })).toEqual([
      'rewritten',
      'removed',
      'added',
    ]);
  });

  it('filedNothing: zero encounters of every kind, findings aside', () => {
    expect(filedNothing({ checked: 0, notApplicable: 0, unreachable: 0 })).toBe(true);
    expect(filedNothing({ checked: 0, notApplicable: 1, unreachable: 0 })).toBe(false);
    expect(filedNothing({ checked: 1, notApplicable: 0, unreachable: 0 })).toBe(false);
  });
});
