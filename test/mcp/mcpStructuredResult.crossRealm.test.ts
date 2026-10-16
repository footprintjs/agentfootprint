/**
 * structuredContent from another realm (jest's environment, `node:vm`) is plain
 * data and must be accepted; every hostile shape the identity check used to
 * refuse must still be refused, without running a getter or a Proxy trap that
 * reads a value.
 */
import { describe, expect, it, vi } from 'vitest';
import vm from 'node:vm';
import { mcpClient } from '../../src/mcp/mcpClient.js';
import type { McpCallToolResult, McpConnection } from '../../src/mcp/types.js';

const declaration = {
  name: 'inventory',
  description: 'Declared inventory',
  inputSchema: { type: 'object', properties: {} },
};

async function execute(structuredContent: unknown): Promise<unknown> {
  const connection: McpConnection = {
    listTools: async () => ({ tools: [declaration] }),
    callTool: async () => ({ content: [], structuredContent } as McpCallToolResult),
    close: async () => {},
  };
  const client = await mcpClient({ name: 'realm-source', connection, resultMode: 'structured' });
  return (await client.tools())[0]!.execute({});
}

async function expectRefused(structuredContent: unknown): Promise<void> {
  await expect(execute(structuredContent)).rejects.toThrow(
    /did not provide valid structuredContent/,
  );
}

/** A fresh realm whose getters report back through `spy` — a call is a failure. */
function realm(spy = vi.fn()) {
  return { spy, run: (code: string) => vm.runInNewContext(code, { spy }) as unknown };
}

describe('MCP structuredContent from another realm', () => {
  it('accepts plain objects and arrays built in a node:vm realm, returned as validated', async () => {
    const { run } = realm();
    const data = run(
      '({ rows: [{ latency: 0, missing: null, ok: false, tags: ["a", "b"] }], nested: { deep: { n: 1.5 } } })',
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(data)).not.toBe(Object.prototype);
    expect(Array.isArray(data.rows)).toBe(true);
    expect(await execute(data)).toBe(data);
  });

  it('accepts a foreign null-prototype object and a foreign JSON own __proto__ key', async () => {
    const { run } = realm();
    const bare = run('Object.assign(Object.create(null), { a: [1, { b: null }] })');
    expect(await execute(bare)).toBe(bare);
    const parsed = run('JSON.parse(\'{"__proto__":{"own":true},"rows":[]}\')') as object;
    expect(await execute(parsed)).toBe(parsed);
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
  });

  it('accepts local data nested inside foreign data and the reverse', async () => {
    const { run } = realm();
    const foreign = run('({ rows: [] })') as { rows: unknown[] };
    const mixed = { outer: foreign, list: [foreign.rows] };
    expect(await execute(mixed)).toBe(mixed);
  });
});

describe('MCP structuredContent hostile shapes stay refused', () => {
  it('refuses class instances from this realm and from another', async () => {
    class Row {
      latency = 0;
    }
    const { run } = realm();
    await expectRefused(new Row());
    await expectRefused({ row: new Row() });
    await expectRefused(run('new (class Row { constructor() { this.latency = 0; } })()'));
    await expectRefused(run('({ when: new Date(0) })'));
    await expectRefused(run('({ map: new Map() })'));
    await expectRefused(run('({ boxed: new Number(1) })'));
  });

  it('refuses an instance of a class that extends null (a null-parent prototype that is not Object.prototype)', async () => {
    class Detached extends (null as unknown as ObjectConstructor) {}
    const instance = Object.create(Detached.prototype) as Record<string, unknown>;
    instance.latency = 0;
    await expectRefused(instance);
    const { run } = realm();
    await expectRefused(
      run(
        '(() => { class D extends null {} const o = Object.create(D.prototype); o.a = 1; return o; })()',
      ),
    );
  });

  it('refuses Proxies — as the value, nested, foreign, or standing in for a prototype — without reading through them', async () => {
    const get = vi.fn(() => 'PRIVATE');
    const handler = { get };
    await expectRefused(new Proxy({ rows: [] }, handler));
    await expectRefused({ rows: new Proxy([1, 2], handler) });
    await expectRefused({ nested: { deep: new Proxy({}, handler) } });
    const { run } = realm();
    await expectRefused(run('new Proxy({ rows: [] }, {})'));
    // A Proxy forwarding to a real foreign Object.prototype: every descriptor
    // matches, but the native constructor's `prototype` cannot point at it.
    const foreignProto = Object.getPrototypeOf(run('({})')) as object;
    await expectRefused(Object.create(new Proxy(foreignProto, {})));
    await expectRefused(Object.create(new Proxy(Object.prototype, {})));
    expect(get).not.toHaveBeenCalled();
  });

  it('refuses accessors on the value, in another realm, and on the inherited path', async () => {
    const { spy, run } = realm();
    await expectRefused(run('({ get rows() { spy(); return []; } })'));
    await expectRefused({
      list: run(
        '(() => { const a = [1]; Object.defineProperty(a, "0", { get: spy, enumerable: true }); return a; })()',
      ),
    });
    // A realm whose Object.prototype gained a getter: values from it inherit it.
    await expectRefused(
      run(
        'Object.defineProperty(Object.prototype, "rows", { get() { spy(); return []; } }); ({ ok: true })',
      ),
    );
    // Same for a realm whose Array.prototype gained one.
    await expectRefused(
      run(
        'Object.defineProperty(Array.prototype, "leak", { get() { spy(); return 1; } }); ({ rows: [1] })',
      ),
    );
    const local = vi.fn(() => 'PRIVATE');
    await expectRefused(Object.defineProperty({}, 'rows', { enumerable: true, get: local }));
    expect(spy).not.toHaveBeenCalled();
    expect(local).not.toHaveBeenCalled();
  });

  it('refuses __proto__ tricks and forged prototypes', async () => {
    const getter = vi.fn(() => 'PRIVATE');
    const evilParent = Object.defineProperty({}, 'rows', { get: getter });
    await expectRefused({ __proto__: evilParent, ok: true });
    await expectRefused(Object.setPrototypeOf({ ok: true }, Object.create(null)));
    await expectRefused(Object.setPrototypeOf({ ok: true }, Array.prototype));
    await expectRefused({ rows: Object.setPrototypeOf([1], Object.prototype) });
    await expectRefused({ rows: Object.setPrototypeOf([1], Object.create(Array.prototype)) });
    // A null-parent prototype that names a real Object constructor whose
    // `prototype` is somewhere else.
    const forged = Object.create(null) as Record<string, unknown>;
    forged.constructor = Object;
    await expectRefused(Object.create(forged));
    const { run } = realm();
    const foreignObject = run('Object') as ObjectConstructor;
    const forgedForeign = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(Object.prototype)) {
      Object.defineProperty(
        forgedForeign,
        key,
        Object.getOwnPropertyDescriptor(Object.prototype, key)!,
      );
    }
    forgedForeign.constructor = foreignObject;
    await expectRefused(Object.create(forgedForeign));
    // A prototype carrying a Symbol.toStringTag getter is refused by shape,
    // before the tag is ever read.
    const tagged = Object.create(null) as object;
    Object.defineProperty(tagged, Symbol.toStringTag, { get: getter });
    await expectRefused(Object.create(tagged));
    expect(getter).not.toHaveBeenCalled();
  });
});
