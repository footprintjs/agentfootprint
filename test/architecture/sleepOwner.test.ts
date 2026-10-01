/**
 * EVERY PROMISED MINIMUM GOES THROUGH THE ONE SLEEP.
 *
 * `lib/sleep.ts · sleep` is the only wait in `src/` that keeps its minimum: a
 * bare `setTimeout` fires early (the loop clock counts whole milliseconds and
 * floors the stamp it arms with; on Linux it is the coarse clock and the
 * shortfall passes a millisecond). Seven modules each kept their own
 * `new Promise((resolve) => setTimeout(resolve, ms))` until the retry tests
 * started measuring the shortfall in CI. This guard parses every file under
 * `src/` and refuses an eighth.
 *
 * WHAT IS A SLEEP HERE: a timer whose callback fulfils a promise with NOTHING —
 * `setTimeout(resolve, ms)`, or a callback that calls the promise's resolver
 * with no argument. That promise means only "time passed", so its caller is
 * relying on a minimum. Also refused: `timers/promises` (the same timer, behind
 * a promise) and `promisify(setTimeout)`.
 *
 * WHAT IS NOT, AND STAYS WHERE IT IS: a timer that bounds work rather than
 * delaying it — it aborts, rejects, or resolves with the sentinel its race
 * reads (`'timeout'`, `undefined` for "no answer") — and a grace, flush or
 * drain timer. Those promise a maximum, not a minimum.
 *
 * Adding a wait: `import { sleep } from '<path>/lib/sleep.js'`. A yield to the
 * event loop is `setImmediate`, not a timer.
 *
 * The scanner is proved before it is trusted: the seven shapes it replaced are
 * flagged, and every non-minimum timer shape in `src/` is not.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const isNamed = (node: ts.Node, name: string): boolean =>
  (ts.isIdentifier(node) && node.text === name) ||
  (ts.isPropertyAccessExpression(node) && node.name.text === name);

/** Does `callback` fulfil one of `resolvers` with no value? */
function resolvesWithNothing(callback: ts.Node, resolvers: readonly string[]): boolean {
  if (ts.isIdentifier(callback)) return resolvers.includes(callback.text);
  if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false;
  let found = false;
  const look = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      resolvers.includes(node.expression.text) &&
      node.arguments.length === 0
    ) {
      found = true;
    }
    ts.forEachChild(node, look);
  };
  look(callback.body);
  return found;
}

/** Every sleep-shaped timer in one file, as `file:line — what`. */
function sleepsIn(fileName: string, source: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const found: string[] = [];
  const at = (node: ts.Node, what: string): void => {
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    found.push(`${fileName}:${line} — ${what}`);
  };
  const visit = (node: ts.Node, resolvers: readonly string[]): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /^(node:)?timers\/promises$/.test(node.moduleSpecifier.text)
    ) {
      at(node, `imports ${node.moduleSpecifier.text}`);
    }
    if (ts.isCallExpression(node) && isNamed(node.expression, 'promisify')) {
      if (node.arguments.some((arg) => isNamed(arg, 'setTimeout')))
        at(node, 'promisify(setTimeout)');
    }
    if (
      ts.isCallExpression(node) &&
      isNamed(node.expression, 'setTimeout') &&
      node.arguments.length > 0 &&
      resolvesWithNothing(node.arguments[0]!, resolvers)
    ) {
      at(node, 'a setTimeout that resolves a promise with nothing');
    }
    if (ts.isNewExpression(node) && isNamed(node.expression, 'Promise')) {
      const executor = node.arguments?.[0];
      const first =
        executor && (ts.isArrowFunction(executor) || ts.isFunctionExpression(executor))
          ? executor.parameters[0]
          : undefined;
      if (first && ts.isIdentifier(first.name)) {
        const inside = [...resolvers, first.name.text];
        ts.forEachChild(node, (child) => visit(child, inside));
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, resolvers));
  };
  visit(file, []);
  return found;
}

describe('the scanner tells a wait from a bound', () => {
  /** The seven waits this guard replaced, as they read before. */
  const WAITS: Readonly<Record<string, string>> = {
    'typesafe · wait': `
      function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) { reject(abortReason(signal)); return; }
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, ms);
          const onAbort = (): void => { clearTimeout(timer); reject(abortReason(signal!)); };
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      }`,
    'withRetry · sleep (and retryingFetch, MockProvider)': `
      function sleep(ms: number, signal?: AbortSignal): Promise<void> {
        if (ms <= 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const id = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, ms);
          const onAbort = (): void => { clearTimeout(id); reject(signal?.reason ?? new Error('Aborted')); };
          signal?.addEventListener('abort', onAbort, { once: true });
        });
      }`,
    'withCredentialRetry · sleep': `
      function sleep(ms: number): Promise<void> {
        if (ms <= 0) return Promise.resolve();
        return new Promise((resolve) => setTimeout(resolve, ms));
      }`,
    'door · sleep': `
      function sleep(ms: number): Promise<void> {
        return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
      }`,
    'githubDeviceSignIn · defaultSleep': `
      const defaultSleep = (ms: number, signal?: AbortSignal): Promise<void> =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
          }, ms);
          const onAbort = (): void => { clearTimeout(timer); reject(abortedError()); };
          signal?.addEventListener('abort', onAbort, { once: true });
        });`,
    'a global, by property': `const pause = (ms: number) => new Promise<void>((r) => globalThis.setTimeout(() => r(), ms));`,
    'timers/promises': `import { setTimeout as delay } from 'node:timers/promises';`,
    'promisify(setTimeout)': `const delay = util.promisify(setTimeout);`,
  };

  /** Timers that bound work — every shape `src/` holds today. */
  const BOUNDS: Readonly<Record<string, string>> = {
    'abort after (typesafe · attemptOnce)': `const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);`,
    'a deadline that rejects (OllamaProvider)': `
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { timedOut = true; controller.abort(); reject(new Error('late')); }, ms);
      });`,
    'a race sentinel (standingAgent)': `
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs);
      });`,
    'a probe deadline answering undefined (FoundryLocalProvider)': `
      const deadline = new Promise<undefined>((resolve) => {
        timer = setTimeout(() => { controller.abort(); resolve(undefined); }, ms);
      });`,
    'a deadline that aborts inside a promise (InvokeModelGatewayProvider)': `
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => { controller.abort(new Error('late')); }, timeoutMs);
        pending.then((value) => { clearTimeout(timer); resolve(value); }, reject);
      });`,
    'a grace timer (webSocketConversation)': `const grace = setTimeout(() => socket.destroy(), CLOSE_GRACE_MS);`,
    'a flush timer (file sink)': `timer = setTimeout(() => { timer = undefined; void doFlush(); }, flushIntervalMs);`,
    'a drain bound (httpHost)': `const timer = setTimeout(finish, REFUSAL_DRAIN_MS);`,
  };

  for (const [name, source] of Object.entries(WAITS)) {
    it(`flags ${name}`, () => {
      expect(sleepsIn('fixture.ts', source)).toHaveLength(1);
    });
  }

  for (const [name, source] of Object.entries(BOUNDS)) {
    it(`leaves ${name}`, () => {
      expect(sleepsIn('fixture.ts', source)).toEqual([]);
    });
  }
});

describe('src/ holds one wait', () => {
  const files = walk(join(ROOT, 'src'));

  it('finds the tree', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it('no file keeps its own sleep — every promised minimum goes through lib/sleep.ts', () => {
    const found = files.flatMap((file) =>
      sleepsIn(relative(ROOT, file), readFileSync(file, 'utf8')),
    );
    expect(
      found,
      `A bare timer behind a promise fires early, so it cannot keep a minimum. Use ` +
        `\`sleep\` from src/lib/sleep.ts (it takes the signal and your abort error). ` +
        `If this timer BOUNDS work instead, make it abort, reject, or resolve with the ` +
        `sentinel its race reads.\n\n${found.join('\n')}`,
    ).toEqual([]);
  });
});
