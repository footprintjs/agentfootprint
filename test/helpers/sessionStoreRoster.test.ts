import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assertEnrolledSessionStores, sessionStoreFactories } from './sessionStoreRoster.js';

describe('session-store roster discovery', () => {
  const root = mkdtempSync(join(tmpdir(), 'af-session-roster-'));
  let factories: Set<string>;

  function source(name: string, text: string): void {
    const file = join(root, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, text);
  }

  beforeAll(() => {
    source(
      'ports.ts',
      `export interface SessionLifecycle { persist(value: string): void; hydrate(): unknown; }`,
    );
    source(
      'local.ts',
      `import type { SessionLifecycle } from './ports.js';
export function openLocal(): SessionLifecycle;
export function openLocal(value: string): SessionLifecycle;
export function openLocal(value?: string): SessionLifecycle { throw new Error('not executed'); }`,
    );
    source(
      'nested/deeper/remote.ts',
      `import type { SessionLifecycle as Store } from '../../ports.js';
interface RemoteStore extends Store { close(): void; }
type RemoteAlias = RemoteStore;
export function remoteStore(): RemoteAlias { throw new Error('not executed'); }`,
    );
    source(
      'reply.ts',
      `import type { SessionLifecycle } from './ports.js';
export function deliverSessions(reply: object, op: string, result: SessionLifecycle): void {}
interface UnrelatedSessions { send(): void; }
export function otherSessions(): UnrelatedSessions { throw new Error('not executed'); }
export function uncheckedSessions(): any { throw new Error('not executed'); }
export function stoppedSessions(): never { throw new Error('not executed'); }
export function unknownSessions(): unknown { throw new Error('not executed'); }
export function nullableSessions(): SessionLifecycle | null { throw new Error('not executed'); }
/*
export function commentedSessions(): SessionLifecycle { throw new Error('not executed'); }
*/`,
    );
    for (const name of ['fixture.test.ts', 'fixture.d.ts']) {
      source(name, 'export function ignoredSessions(): SessionLifecycle;');
    }
    factories = sessionStoreFactories([root], join(root, 'ports.ts'));
  });

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('finds direct and imported derived ports recursively, independent of factory names', () => {
    expect([...factories].sort()).toEqual(['openLocal', 'remoteStore']);
  });

  it('ignores void replies, unrelated types, unchecked returns, comments and fixture sources', () => {
    expect(factories.has('deliverSessions')).toBe(false);
    expect(factories.has('otherSessions')).toBe(false);
    expect(factories.has('uncheckedSessions')).toBe(false);
    expect(factories.has('stoppedSessions')).toBe(false);
    expect(factories.has('unknownSessions')).toBe(false);
    expect(factories.has('nullableSessions')).toBe(false);
    expect(factories.has('commentedSessions')).toBe(false);
    expect(factories.has('ignoredSessions')).toBe(false);
  });

  it('fails when a real nested factory has no enrolled harness', () => {
    expect(() => assertEnrolledSessionStores(factories, ['openLocal'])).toThrow(
      'remoteStore ships and is not enrolled in the battery',
    );
  });

  it('accepts all actual factories and refuses a vacuous census', () => {
    expect(() =>
      assertEnrolledSessionStores(factories, ['openLocal', 'remoteStore']),
    ).not.toThrow();
    expect(() => assertEnrolledSessionStores(new Set(), [])).toThrow('scan found nothing');
  });

  it('refuses two factory owners with the same name instead of hiding an omission', () => {
    for (const name of ['first', 'second']) {
      source(
        `collision/${name}.ts`,
        `import type { SessionLifecycle } from '../ports.js';
export function openLocal(): SessionLifecycle { throw new Error('not executed'); }`,
      );
    }
    try {
      expect(() => sessionStoreFactories([root], join(root, 'ports.ts'))).toThrow(
        'Multiple session-store factories named openLocal',
      );
    } finally {
      rmSync(join(root, 'collision'), { recursive: true, force: true });
    }
  });
});
