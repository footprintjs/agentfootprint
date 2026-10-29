/**
 * One event a real machine will not raise on demand, for the local runner's
 * `_childProcess` seam: the runtime's `error` event for a child that has
 * STARTED.
 *
 * Everything else is real. `spawn` is Node's own, so the child really runs, in
 * the process group the runner gave it; the event is raised when the child
 * first writes to stdout — by then it has provably run — with the given
 * error code, or with none.
 */

import { spawn as realSpawn } from 'node:child_process';

import type { ChildProcessModuleLike } from '../../../src/adapters/code/local.js';

type Spawn = NonNullable<ChildProcessModuleLike['spawn']>;

export function spawnErroringAfterStart(code?: string): Spawn {
  return (...[file, args, options]: Parameters<Spawn>): ReturnType<Spawn> => {
    const child = realSpawn(file, [...args], { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let raised = false;
    child.stdout.on('data', () => {
      if (raised) return;
      raised = true;
      child.emit(
        'error',
        Object.assign(new Error('injected after the start'), code === undefined ? {} : { code }),
      );
    });
    // The real child, typed as the seam's slice of it: Node's `kill` takes its
    // own signal names, the slice a plain string.
    return child as unknown as ReturnType<Spawn>;
  };
}
