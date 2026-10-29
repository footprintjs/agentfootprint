/**
 * A listing never makes a callable tool silently lose its checks (Codex review
 * of #248, round 3, P2).
 *
 * The MCP SDK's `Client` keeps its per-tool call checks — `structuredContent`
 * required by an `outputSchema` and matched against it, and a required task
 * refused before sending — for its most recent `tools/list` answer only, and
 * every list request replaces them. So every `Tool` the library hands out
 * carries the checks of the listing it came from (`callChecks.ts`), and the
 * library relies on the SDK only for a tool of a one-page list that is still
 * the latest answer, with no list request out, at both ends of the call
 * (`listingGenerations.ts`).
 *
 * Driven arm by arm, with and without a validator, through the REAL SDK client
 * against an MCP endpoint in this process whose catalogue, list failures and
 * call answers each test scripts as it goes:
 *
 *   - a refresh that fails after a page it did receive;
 *   - a refresh whose first answer the SDK fails to cache;
 *   - a successful refresh that drops or changes a tool, with a held reference;
 *   - a call in flight while a refresh's answer arrives, or while one is out;
 *   - a call made while a list request is out;
 *   - one-page controls: the same requests, nothing checked twice.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it } from 'vitest';

import type { Tool, ToolExecutionContext } from '../../src/index.js';
import {
  McpOutputUncheckedError,
  mcpClient,
  type McpJsonSchemaValidator,
} from '../../src/tool-providers/index.js';
import type { McpClient } from '../../src/mcp/types.js';

const URL_ = 'http://mcp.example.test/mcp';

// ─── The tools ────────────────────────────────────────────────────

const COUNT_SCHEMA = {
  type: 'object',
  properties: { count: { type: 'integer' } },
  required: ['count'],
};
const OBJECT = { type: 'object' } as const;

const first = { name: 'first', inputSchema: OBJECT, outputSchema: COUNT_SCHEMA };
const needsTask = {
  name: 'needsTask',
  inputSchema: OBJECT,
  execution: { taskSupport: 'required' },
};
const plain = { name: 'plain', inputSchema: OBJECT };
/** The same names, changed: no output schema, no task requirement. */
const firstChanged = { name: 'first', inputSchema: OBJECT };
const needsTaskChanged = { name: 'needsTask', inputSchema: OBJECT };
/** A tool whose output schema the SDK's validator cannot compile: caching the answer throws. */
const uncompilable = {
  name: 'uncompilable',
  inputSchema: OBJECT,
  outputSchema: { type: 'object', properties: { n: { type: 'not-a-type' } } },
};

type Pages = readonly (readonly object[])[];
/** The catalogue as one page, and paged: the checked tools on the LAST page. */
const ONE_PAGE: Pages = [[first, needsTask, plain]];
const PAGED: Pages = [[plain], [first, needsTask]];

const ANSWERS = {
  malformed: { content: [{ type: 'text', text: 'x' }], structuredContent: { count: 'wrong' } },
  missing: { content: [{ type: 'text', text: 'no structure' }] },
  valid: { content: [{ type: 'text', text: 'counted' }], structuredContent: { count: 3 } },
} as const;
type Answer = keyof typeof ANSWERS;

// ─── An endpoint the test scripts as it goes ──────────────────────

/** A door a request waits at until the test opens it. */
interface Gate {
  readonly opened: Promise<void>;
  open(): void;
}
function gate(): Gate {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}

/** What the endpoint answers right now. Each field may change between requests. */
interface Script {
  catalogue: Pages;
  /** The page index answered with a JSON-RPC error instead. */
  failPage?: number;
  answer: Answer;
  /** A `tools/call` waits here before it is answered. */
  callGate?: Gate;
  /** A `tools/list` waits here before it is answered. */
  listGate?: Gate;
}

interface Endpoint {
  readonly fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  readonly script: Script;
  /** Every `tools/call`'s params, as the server received them. */
  readonly calls: { name?: string; arguments?: unknown; _meta?: unknown }[];
  /** Opens when a `tools/call` reaches the endpoint. */
  readonly callArrived: Gate;
}

function endpoint(catalogue: Pages): Endpoint {
  const script: Script = { catalogue, answer: 'valid' };
  const self: Endpoint = {
    script,
    calls: [],
    callArrived: gate(),
    fetch: async (_input, init) => {
      if ((init?.method ?? 'GET').toUpperCase() !== 'POST') {
        return new Response(null, { status: 405 });
      }
      const message = JSON.parse(String(init?.body)) as {
        method?: string;
        id?: unknown;
        params?: { cursor?: string; name?: string; arguments?: unknown };
      };
      const respond = (body: object): Response =>
        new Response(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...body }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      switch (message.method) {
        case 'initialize':
          return respond({
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'listing', version: '1.0.0' },
            },
          });
        case 'tools/list': {
          const listGate = script.listGate;
          if (listGate !== undefined) await listGate.opened;
          const index = message.params?.cursor === undefined ? 0 : Number(message.params.cursor);
          if (index === script.failPage) {
            return respond({ error: { code: -32603, message: 'the page failed' } });
          }
          const pages = script.catalogue;
          const more = index + 1 < pages.length;
          return respond({
            result: { tools: pages[index], ...(more && { nextCursor: String(index + 1) }) },
          });
        }
        case 'tools/call': {
          self.calls.push({ ...message.params });
          self.callArrived.open();
          const callGate = script.callGate;
          if (callGate !== undefined) await callGate.opened;
          return respond({ result: ANSWERS[script.answer] });
        }
        default:
          return new Response(null, { status: 202 });
      }
    },
  };
  return self;
}

// ─── The arms, with and without a validator ───────────────────────

type Arm = 'default' | 'sdk' | 'connection';

async function clientOn(
  arm: Arm,
  server: Endpoint,
  validator?: McpJsonSchemaValidator,
): Promise<McpClient> {
  const transport = { transport: 'http' as const, url: URL_, fetch: server.fetch };
  const given = validator === undefined ? {} : { jsonSchemaValidator: validator };
  if (arm === 'default') return mcpClient({ name: 'listing', transport, ...given });
  if (arm === 'sdk') {
    const sdk = { Client, StreamableHTTPClientTransport };
    return mcpClient({ name: 'listing', transport, sdk, ...given });
  }
  // The caller's own client, given the same validator they hand mcpClient.
  const connection = new Client({ name: 'own', version: '1.0.0' }, { capabilities: {}, ...given });
  await connection.connect(
    new StreamableHTTPClientTransport(new URL(URL_), { fetch: server.fetch }),
  );
  return mcpClient({ name: 'listing', connection, ...given });
}

/** An SDK validator that counts what it compiles and every value it is asked to check. */
function recordingValidator(): McpJsonSchemaValidator & {
  readonly compiled: string[];
  readonly checked: unknown[];
} {
  const inner = new AjvJsonSchemaValidator();
  const compiled: string[] = [];
  const checked: unknown[] = [];
  return {
    compiled,
    checked,
    getValidator(schema: object) {
      compiled.push(JSON.stringify(schema));
      const check = inner.getValidator(schema as never);
      return (input: unknown) => {
        checked.push(input);
        return check(input);
      };
    },
  };
}

/** Each arm with a validator: the default arm's is the SDK's own; the others are given one. */
const WITH_VALIDATOR = [
  ['default (the SDK default validator)', 'default', () => undefined],
  ['default (a given validator)', 'default', () => new AjvJsonSchemaValidator()],
  ['sdk (a given validator)', 'sdk', () => new AjvJsonSchemaValidator()],
  ['connection (a given validator)', 'connection', () => new AjvJsonSchemaValidator()],
] as const;
/** The arms that load no validator when none is given. */
const WITHOUT_VALIDATOR = ['sdk', 'connection'] as const;

const CTX = { toolCallId: 'tc-listing', iteration: 1 } as unknown as ToolExecutionContext;

function named(tools: readonly Tool[], name: string): Tool {
  const tool = tools.find((t) => t.schema.name === name);
  if (tool === undefined) throw new Error(`no tool '${name}' listed`);
  return tool;
}

/** Call `tool` with `answer` scripted: what it returned or threw, and whether a request reached the server. */
async function call(
  server: Endpoint,
  tool: Tool,
  answer: Answer,
): Promise<{ value?: unknown; error?: unknown; sent: boolean }> {
  server.script.answer = answer;
  const before = server.calls.length;
  return tool.execute({}, CTX).then(
    (value) => ({ value, sent: server.calls.length > before }),
    (error: unknown) => ({ error, sent: server.calls.length > before }),
  );
}

/** What a caller can branch on: the class's name, the code, the message. */
function handled(error: unknown): { name: string; code: unknown; message: string } {
  const e = error as { name?: unknown; code?: unknown; message?: unknown };
  return { name: String(e.name), code: e.code, message: String(e.message) };
}

/** The SDK's own errors, which a tool's own checks raise as they are. */
const INVALID_PARAMS = { name: 'McpError', code: -32602 };
const INVALID_REQUEST = { name: 'McpError', code: -32600 };

/** What a stale tool is asked, one case per test so each fails on its own. */
const CASES = ['malformed output', 'missing structuredContent', 'a required task'] as const;
type Case = (typeof CASES)[number];

/** Every case on every arm with a validator, and on every arm without one. */
const CHECKED = CASES.flatMap((kase) =>
  WITH_VALIDATOR.map(([label, arm, validator]) => [kase, label, arm, validator] as const),
);
const REFUSED = CASES.flatMap((kase) => WITHOUT_VALIDATOR.map((arm) => [kase, arm] as const));

/** With a validator: `kase` fails exactly as the SDK fails it, and a valid answer still returns. */
async function expectChecked(server: Endpoint, tools: readonly Tool[], kase: Case): Promise<void> {
  if (kase === 'a required task') {
    const task = await call(server, named(tools, 'needsTask'), 'valid');
    expect(task.sent).toBe(false);
    expect(handled(task.error)).toMatchObject(INVALID_REQUEST);
    expect(handled(task.error).message).toContain('requires task-based execution');
    return;
  }
  const failed = await call(
    server,
    named(tools, 'first'),
    kase === 'malformed output' ? 'malformed' : 'missing',
  );
  expect(failed.value).toBeUndefined();
  if (kase === 'malformed output') {
    expect(handled(failed.error)).toMatchObject(INVALID_PARAMS);
    expect(handled(failed.error).message).toContain('data/count must be integer');
  } else {
    expect(handled(failed.error)).toMatchObject(INVALID_REQUEST);
    expect(handled(failed.error).message).toContain('did not return structured content');
  }
  expect((await call(server, named(tools, 'first'), 'valid')).value).toBe('counted');
}

/** No validator: `kase`'s tool is refused before it is sent — never answered unchecked. */
async function expectRefused(server: Endpoint, tools: readonly Tool[], kase: Case): Promise<void> {
  if (kase === 'a required task') {
    const task = await call(server, named(tools, 'needsTask'), 'valid');
    expect(task.sent).toBe(false);
    expect(handled(task.error)).toMatchObject(INVALID_REQUEST);
    expect(handled(task.error).message).toContain('requires task-based execution');
    return;
  }
  const refused = await call(
    server,
    named(tools, 'first'),
    kase === 'malformed output' ? 'malformed' : 'missing',
  );
  expect(refused.value).toBeUndefined();
  expect(refused.sent).toBe(false);
  expect(refused.error).toBeInstanceOf(McpOutputUncheckedError);
  expect(refused.error).toMatchObject({
    code: 'ERR_MCP_OUTPUT_UNCHECKED',
    reason: 'output-unchecked',
    sent: false,
    server: 'listing',
    tool: 'first',
  });
}

// ─── A failed refresh ─────────────────────────────────────────────

describe('a refresh that fails after a page it received — the old tools keep their checks', () => {
  /** List `catalogue`, then refresh into a list whose page 1 answers and page 2 fails. */
  async function afterFailedRefresh(
    arm: Arm,
    catalogue: Pages,
    validator?: McpJsonSchemaValidator,
  ): Promise<{ server: Endpoint; client: McpClient; tools: readonly Tool[] }> {
    const server = endpoint(catalogue);
    const client = await clientOn(arm, server, validator);
    const tools = await client.tools();
    server.script.catalogue = [[plain], [plain]];
    server.script.failPage = 1;
    await expect(client.refresh()).rejects.toThrow(/the page failed/);
    // The catalogue served after the failed refresh is the old one, as it was.
    expect(await client.tools()).toBe(tools);
    return { server, client, tools };
  }

  for (const [label, catalogue] of [
    ['a one-page catalogue', ONE_PAGE],
    ['a paged catalogue', PAGED],
  ] as const) {
    it.each(CHECKED)(`${label}: %s, with a validator — %s`, async (kase, _, arm, validator) => {
      const { server, client, tools } = await afterFailedRefresh(arm, catalogue, validator());
      await expectChecked(server, tools, kase);
      await client.close();
    });

    it.each(REFUSED)(`${label}: %s, no validator — %s arm`, async (kase, arm) => {
      const { server, client, tools } = await afterFailedRefresh(arm, catalogue);
      await expectRefused(server, tools, kase);
      await client.close();
    });
  }
});

describe('a refresh whose answer the SDK fails to cache — a failed list request counts', () => {
  // The SDK caches an answer before returning it, and clears the old checks
  // first: an output schema its validator cannot compile rejects the request
  // with the old checks already gone.
  async function afterUncachedRefresh(
    arm: Arm,
    validator?: McpJsonSchemaValidator,
  ): Promise<{ server: Endpoint; client: McpClient; tools: readonly Tool[] }> {
    const server = endpoint(ONE_PAGE);
    const client = await clientOn(arm, server, validator);
    const tools = await client.tools();
    server.script.catalogue = [[uncompilable]];
    await expect(client.refresh()).rejects.toThrow(/not-a-type/);
    expect(await client.tools()).toBe(tools);
    return { server, client, tools };
  }

  it.each(CHECKED)('%s, with a validator — %s', async (kase, _, arm, validator) => {
    const { server, client, tools } = await afterUncachedRefresh(arm, validator());
    await expectChecked(server, tools, kase);
    await client.close();
  });

  it.each(REFUSED)('%s, no validator — %s arm', async (kase, arm) => {
    const { server, client, tools } = await afterUncachedRefresh(arm);
    await expectRefused(server, tools, kase);
    await client.close();
  });
});

// ─── A successful refresh, and a reference held across it ─────────

describe('a successful refresh that drops or changes a tool — a held reference keeps its checks', () => {
  async function heldAcross(
    arm: Arm,
    next: Pages,
    validator?: McpJsonSchemaValidator,
  ): Promise<{
    server: Endpoint;
    client: McpClient;
    held: readonly Tool[];
    fresh: readonly Tool[];
  }> {
    const server = endpoint(ONE_PAGE);
    const client = await clientOn(arm, server, validator);
    const held = await client.tools();
    server.script.catalogue = next;
    const fresh = await client.refresh();
    return { server, client, held, fresh };
  }

  const CHANGES = [
    ['dropped', [[plain]]],
    ['changed', [[firstChanged, needsTaskChanged, plain]]],
  ] as const;

  for (const [how, next] of CHANGES) {
    it.each(CHECKED)(`${how}: %s, with a validator — %s`, async (kase, _, arm, validator) => {
      const { server, client, held } = await heldAcross(arm, next, validator());
      await expectChecked(server, held, kase);
      await client.close();
    });

    it.each(REFUSED)(`${how}: %s, no validator — %s arm`, async (kase, arm) => {
      const { server, client, held } = await heldAcross(arm, next);
      await expectRefused(server, held, kase);
      await client.close();
    });
  }

  it.each(['default', 'sdk', 'connection'] as const)(
    'the tools the refresh returned follow the NEW listing — %s arm',
    async (arm) => {
      const { server, client, fresh } = await heldAcross(arm, [
        [firstChanged, needsTaskChanged, plain],
      ]);
      // The server no longer declares an output schema or a required task.
      expect((await call(server, named(fresh, 'first'), 'missing')).value).toBe('no structure');
      const task = await call(server, named(fresh, 'needsTask'), 'valid');
      expect(task.sent).toBe(true);
      expect(task.value).toBe('counted');
      await client.close();
    },
  );
});

// ─── A call in flight while a listing moves ───────────────────────

describe('a call in flight while a refresh answers — never returned unchecked', () => {
  /**
   * Start a call to `first` and hold its answer at the endpoint; meanwhile a
   * refresh lists a catalogue without it — to its answer, or left out — then
   * release the call's answer.
   */
  async function acrossRefresh(
    arm: Arm,
    answer: Answer,
    refresh: 'answered' | 'out',
    validator?: McpJsonSchemaValidator,
  ): Promise<{ value?: unknown; error?: unknown; sent: boolean }> {
    const server = endpoint(ONE_PAGE);
    const client = await clientOn(arm, server, validator);
    const tools = await client.tools();
    const callGate = gate();
    server.script.callGate = callGate;
    const pending = call(server, named(tools, 'first'), answer);
    await server.callArrived.opened;
    server.script.catalogue = [[plain]];
    const listGate = refresh === 'out' ? gate() : undefined;
    server.script.listGate = listGate;
    const refreshing = client.refresh();
    if (listGate === undefined) await refreshing;
    callGate.open();
    const settled = await pending;
    listGate?.open();
    await refreshing;
    await client.close();
    return settled;
  }

  const OUTPUTS = (['malformed', 'missing'] as const).flatMap((answer) =>
    WITH_VALIDATOR.map(([label, arm, validator]) => [answer, label, arm, validator] as const),
  );

  it.each(OUTPUTS)(
    'the refresh answered while the call was out: %s, with a validator — %s',
    async (answer, _, arm, validator) => {
      const failed = await acrossRefresh(arm, answer, 'answered', validator());
      expect(failed.value).toBeUndefined();
      expect(failed.sent).toBe(true);
      expect(handled(failed.error)).toMatchObject(
        answer === 'malformed' ? INVALID_PARAMS : INVALID_REQUEST,
      );
      expect((await acrossRefresh(arm, 'valid', 'answered', validator())).value).toBe('counted');
    },
  );

  it.each(
    (['malformed', 'valid'] as const).flatMap((answer) =>
      WITHOUT_VALIDATOR.map((arm) => [answer, arm] as const),
    ),
  )(
    'the refresh answered while the call was out: %s, no validator — %s arm: refused, and said to be sent',
    async (answer, arm) => {
      const refused = await acrossRefresh(arm, answer, 'answered');
      expect(refused.value).toBeUndefined();
      expect(refused.sent).toBe(true);
      expect(refused.error).toBeInstanceOf(McpOutputUncheckedError);
      expect(refused.error).toMatchObject({
        code: 'ERR_MCP_OUTPUT_UNCHECKED',
        reason: 'output-unchecked',
        sent: true,
        server: 'listing',
        tool: 'first',
      });
      expect((refused.error as Error).message).toContain('was sent');
    },
  );

  it.each(WITH_VALIDATOR)(
    'a refresh still out when the answer came, with a validator — %s',
    async (_, arm, validator) => {
      const malformed = await acrossRefresh(arm, 'malformed', 'out', validator());
      expect(handled(malformed.error)).toMatchObject(INVALID_PARAMS);
      expect((await acrossRefresh(arm, 'valid', 'out', validator())).value).toBe('counted');
    },
  );

  it.each(WITHOUT_VALIDATOR)(
    'a refresh still out when the answer came, no validator — %s arm: refused, and said to be sent',
    async (arm) => {
      const refused = await acrossRefresh(arm, 'valid', 'out');
      expect(refused.value).toBeUndefined();
      expect(refused.sent).toBe(true);
      expect(refused.error).toMatchObject({ reason: 'output-unchecked', sent: true });
    },
  );
});

describe('a call made while a list request is out — the tool’s own checks, from the start', () => {
  async function duringListing(
    arm: Arm,
    validator?: McpJsonSchemaValidator,
  ): Promise<{ server: Endpoint; tools: readonly Tool[]; finish: () => Promise<unknown> }> {
    const server = endpoint(ONE_PAGE);
    const client = await clientOn(arm, server, validator);
    const tools = await client.tools();
    const listGate = gate();
    server.script.listGate = listGate;
    const refreshing = client.refresh();
    return {
      server,
      tools,
      finish: async () => {
        listGate.open();
        await refreshing;
        await client.close();
      },
    };
  }

  it.each(CHECKED)('%s, with a validator — %s', async (kase, _, arm, validator) => {
    const { server, tools, finish } = await duringListing(arm, validator());
    await expectChecked(server, tools, kase);
    await finish();
  });

  it.each(REFUSED)('%s, no validator — %s arm', async (kase, arm) => {
    const { server, tools, finish } = await duringListing(arm);
    await expectRefused(server, tools, kase);
    await finish();
  });
});

// ─── One page, the latest answer: the SDK's, exactly as before ────

describe('one page, still the latest answer — the SDK checks every call, nothing twice', () => {
  it.each(['default', 'sdk', 'connection'] as const)(
    '%s arm: the same requests, the SDK’s verdicts, the validator asked once per call',
    async (arm) => {
      const server = endpoint(ONE_PAGE);
      const validator = recordingValidator();
      const client = await clientOn(arm, server, validator);
      const tools = await client.tools();
      // The SDK client compiled the one output schema with it as it listed the page.
      expect(validator.compiled).toEqual([JSON.stringify(COUNT_SCHEMA)]);

      const malformed = await call(server, named(tools, 'first'), 'malformed');
      expect(handled(malformed.error)).toMatchObject(INVALID_PARAMS);
      const missing = await call(server, named(tools, 'first'), 'missing');
      expect(handled(missing.error)).toMatchObject(INVALID_REQUEST);
      const task = await call(server, named(tools, 'needsTask'), 'valid');
      expect(task.sent).toBe(false);
      expect((await call(server, named(tools, 'first'), 'valid')).value).toBe('counted');
      expect((await call(server, named(tools, 'plain'), 'missing')).value).toBe('no structure');

      // Each structured answer was checked once — by the SDK — and nothing new was compiled.
      expect(validator.checked).toEqual([{ count: 'wrong' }, { count: 3 }]);
      expect(validator.compiled).toHaveLength(1);
      // The server received exactly the requests it always did.
      expect(server.calls).toEqual([
        { name: 'first', arguments: {} },
        { name: 'first', arguments: {} },
        { name: 'first', arguments: {} },
        { name: 'plain', arguments: {} },
      ]);
      await client.close();
    },
  );

  it.each(WITHOUT_VALIDATOR)(
    '%s arm, no validator: nothing is refused while the one page is the latest answer',
    async (arm) => {
      const server = endpoint(ONE_PAGE);
      const client = await clientOn(arm, server);
      const tools = await client.tools();
      expect((await call(server, named(tools, 'first'), 'valid')).value).toBe('counted');
      const malformed = await call(server, named(tools, 'first'), 'malformed');
      expect(handled(malformed.error)).toMatchObject(INVALID_PARAMS);
      // A refresh that lists the same page again: the new tools are the latest answer's.
      const fresh = await client.refresh();
      expect((await call(server, named(fresh, 'first'), 'valid')).value).toBe('counted');
      await client.close();
    },
  );
});
