/**
 * structuredContent from another realm (jest's environment, `node:vm`) is plain
 * data and must be accepted; every hostile shape must still be refused, without
 * running a getter or any Proxy trap. What is handed back is a copy made of
 * this realm's objects, so nothing the source does afterwards reaches the app.
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

/** A fresh realm whose hostile code reports back through `spy` — a call is a failure. */
function realm(spy = vi.fn()) {
  return { spy, run: (code: string) => vm.runInNewContext(code, { spy }) as unknown };
}

/** A handler whose every trap is counted, then forwarded. */
function countedHandler(): { handler: ProxyHandler<object>; trap: ReturnType<typeof vi.fn> } {
  const trap = vi.fn();
  const handler: ProxyHandler<object> = {};
  for (const name of [
    'get',
    'getPrototypeOf',
    'ownKeys',
    'getOwnPropertyDescriptor',
    'has',
    'set',
    'defineProperty',
  ] as const) {
    (handler as Record<string, unknown>)[name] = (...args: unknown[]) => {
      trap(name);
      return (Reflect[name] as (...a: unknown[]) => unknown)(...args);
    };
  }
  return { handler, trap };
}

describe('MCP structuredContent from another realm', () => {
  it('accepts plain objects and arrays built in a node:vm realm, as a copy of this realm', async () => {
    const { run } = realm();
    const data = run(
      '({ rows: [{ latency: 0, missing: null, ok: false, tags: ["a", "b"] }], nested: { deep: { n: 1.5 } } })',
    ) as Record<string, unknown>;
    expect(Object.getPrototypeOf(data)).not.toBe(Object.prototype);
    const received = (await execute(data)) as Record<string, unknown>;
    expect(received).toEqual(JSON.parse(JSON.stringify(data)));
    expect(received).not.toBe(data);
    expect(Object.getPrototypeOf(received)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(received.rows)).toBe(Array.prototype);
  });

  it('accepts a foreign null-prototype object and a foreign JSON own __proto__ key', async () => {
    const { run } = realm();
    const bare = (await execute(
      run('Object.assign(Object.create(null), { a: [1, { b: null }] })'),
    )) as object;
    expect(Object.getPrototypeOf(bare)).toBeNull();
    expect({ ...bare }).toEqual({ a: [1, { b: null }] });
    const parsed = (await execute(
      run('JSON.parse(\'{"__proto__":{"own":true},"rows":[]}\')'),
    )) as object;
    expect(Object.hasOwn(parsed, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
  });

  it('accepts shared sub-objects and mixed local/foreign data, copying each path', async () => {
    const { run } = realm();
    const foreign = run('({ rows: [] })') as { rows: unknown[] };
    const received = (await execute({ outer: foreign, again: foreign, list: [foreign.rows] })) as {
      outer: object;
      again: object;
      list: unknown[];
    };
    expect(received).toEqual({ outer: { rows: [] }, again: { rows: [] }, list: [[]] });
    expect(received.outer).not.toBe(received.again);
  });

  it('counts a shared sub-object on every path, so a small DAG cannot stand for a huge copy', async () => {
    let node: Record<string, unknown> = { leaf: 1 };
    for (let level = 0; level < 60; level++) node = { l: node, r: node };
    await expectRefused(node);
  });

  it('hands back a copy: a later change to the source never reaches it', async () => {
    const source = { rows: [{ id: 1 }] };
    const received = (await execute(source)) as typeof source;
    source.rows[0]!.id = 2;
    source.rows.push({ id: 3 });
    expect(received).toEqual({ rows: [{ id: 1 }] });
  });

  it('a realm whose intrinsics were replaced (data methods, same shape) reaches the app as none of its code', async () => {
    const { spy, run } = realm();
    const data = run(`
      Object.prototype.toString = function () { spy(); return 'x'; };
      Object.prototype.valueOf = function () { spy(); return 1; };
      Array.prototype[Symbol.iterator] = function* () { spy(); yield () => 1; };
      Array.prototype.map = function () { spy(); return []; };
      ({ rows: [1, 2] })
    `) as object;
    const received = (await execute(data)) as { rows: number[] };
    expect(`${String(received)}`).toBe('[object Object]');
    expect([...received.rows]).toEqual([1, 2]);
    expect(received.rows.map((n) => n * 2)).toEqual([2, 4]);
    expect(spy).not.toHaveBeenCalled();
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

  it('refuses Proxies — as the value, nested, foreign, or standing in for a prototype — running no trap', async () => {
    const { handler, trap } = countedHandler();
    await expectRefused(new Proxy({ rows: [] }, handler));
    await expectRefused({ rows: new Proxy([1, 2], handler) });
    await expectRefused({ nested: { deep: new Proxy({}, handler) } });
    await expectRefused(Object.create(new Proxy(Object.prototype, handler)));
    const { run } = realm();
    const foreignProto = Object.getPrototypeOf(run('({})')) as object;
    await expectRefused(Object.create(new Proxy(foreignProto, handler)));
    await expectRefused(run('new Proxy({ rows: [] }, {})'));
    expect(trap).not.toHaveBeenCalled();
  });

  it('refuses a nested Proxy that rewrites its parent mid-walk, and nothing it installed runs', async () => {
    const evil = vi.fn();
    const root: Record<string, unknown> = {};
    root.a = new Proxy(
      {},
      {
        getPrototypeOf() {
          Object.defineProperty(root, 'a', { get: evil, enumerable: true, configurable: true });
          Object.setPrototypeOf(root, new Proxy({}, { get: evil }));
          return Object.prototype;
        },
      },
    );
    await expectRefused(root);
    expect(evil).not.toHaveBeenCalled();
  });

  it('where the runtime cannot name a Proxy (a browser), only what its traps answered reaches the copy', async () => {
    const host = process as { getBuiltinModule?: unknown };
    const original = host.getBuiltinModule;
    host.getBuiltinModule = undefined;
    vi.resetModules();
    try {
      const { copyJsonObject } = await import('../../src/mcp/plainData.js');
      const evil = vi.fn();
      const root: Record<string, unknown> = {};
      root.a = new Proxy(
        { b: 1 },
        {
          getPrototypeOf() {
            Object.defineProperty(root, 'a', { get: evil, enumerable: true, configurable: true });
            Object.setPrototypeOf(root, new Proxy({}, { get: evil }));
            return Object.prototype;
          },
        },
      );
      const copied = copyJsonObject(root) as { a: { b: number }; missing?: unknown };
      expect(copied).toEqual({ a: { b: 1 } });
      expect(Object.getPrototypeOf(copied)).toBe(Object.prototype);
      expect(copied.missing).toBeUndefined();
      expect(evil).not.toHaveBeenCalled();
    } finally {
      host.getBuiltinModule = original;
      vi.resetModules();
    }
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
    // A realm whose Object.prototype gained a Symbol.toStringTag getter: refused
    // by shape, before the tag is ever read.
    await expectRefused(
      run(
        'Object.defineProperty(Object.prototype, Symbol.toStringTag, { get() { spy(); return "Object"; } }); ({ ok: true })',
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
    // A null-parent prototype naming a real Object constructor whose
    // `prototype` is somewhere else — refused by the missing link back.
    const forged = Object.create(null) as Record<string, unknown>;
    forged.constructor = Object;
    await expectRefused(Object.create(forged));
    const { run } = realm();
    const forgedForeign = Object.create(null) as Record<string, unknown>;
    for (const key of Reflect.ownKeys(Object.prototype)) {
      Object.defineProperty(
        forgedForeign,
        key,
        Object.getOwnPropertyDescriptor(Object.prototype, key)!,
      );
    }
    forgedForeign.constructor = run('Object');
    await expectRefused(Object.create(forgedForeign));
    expect(getter).not.toHaveBeenCalled();
  });
});
