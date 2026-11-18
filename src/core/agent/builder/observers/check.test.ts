import { describe, expect, it, vi } from 'vitest';
import type { Watcher } from '../../watch.js';
import { assertNoCollidingObserverIds } from './check.js';

const watcher = (id: string, onEmit = vi.fn()): Watcher => ({ id, onEmit } as Watcher);

describe('observer registration identity', () => {
  it('accepts the same reference repeatedly without changing the caller list', () => {
    const observer = watcher('audit');
    const observers = Object.freeze([observer, observer]);

    expect(() => assertNoCollidingObserverIds(observers)).not.toThrow();
    expect(observers).toEqual([observer, observer]);
  });

  it('refuses different objects with one id, even when their hook is shared', () => {
    const onEmit = vi.fn();
    const first = watcher('audit', onEmit);
    const second = watcher('audit', onEmit);

    expect(() => assertNoCollidingObserverIds([first, second])).toThrow(
      /two different observers were given the id 'audit'/,
    );
    expect(onEmit).not.toHaveBeenCalled();
  });

  it('accepts distinct ids and the public observer namespace', () => {
    expect(() =>
      assertNoCollidingObserverIds([watcher('audit'), watcher('agentfootprint.trace')]),
    ).not.toThrow();
  });
});
