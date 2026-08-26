/**
 * The ports must not know where you deploy.
 *
 * This is a crude test and deliberately so: it greps the hosting source for
 * cloud vendor names and for path literals borrowed from a particular runtime's
 * container contract. A subtler check would be a better test and a worse
 * guardrail — the failure it is here to catch is somebody, in a hurry, adding
 * `region` or `functionArn` or a vendor's route to a port "just for now",
 * because after that every adapter inherits that vendor's shape forever.
 *
 * `/invocations` is on the list for a specific reason: it is one runtime's
 * container contract, and it very nearly became this adapter's default path by
 * inheritance rather than by decision. A default that silently matches one
 * vendor is that vendor leaking into a library that promises not to know about
 * it. Adapters for those runtimes are welcome — they pass `invokePath` like
 * anybody else, and they live in their own file.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOSTING_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/hosting');

/** Names no port may contain. Word-bounded so ordinary prose survives. */
const FORBIDDEN: readonly RegExp[] = [
  /\baws\b/i,
  /\bamazon\b/i,
  /\bbedrock\b/i,
  /\bagentcore\b/i,
  /\bsagemaker\b/i,
  /\bazure\b/i,
  /\bgcp\b/i,
  /\bvertex\s*ai\b/i,
  /\bcloudflare\b/i,
  /\bvercel\b/i,
  /\bfargate\b/i,
  /\bdynamodb\b/i,
  /\bcloudwatch\b/i,
  /\bfirebase\b/i,
  /\bfoundry\b/i,
  /\bmicrosoft\b/i,
  // A borrowed route literal is vendor shape even when no vendor is named.
  /\/invocations\b/,
  // `/readiness` is one runtime's probe spelling, on the list for exactly the
  // reason `/invocations` is. Note what is NOT here: `/responses`. That one is
  // a PROTOCOL's path, spoken by more than one runtime and owned by none, and
  // banning it would be this test mistaking a protocol for a vendor. The line
  // the list draws is who decides the spelling, not who happens to use it.
  /\/readiness\b/,
  // `/ping` is one runtime's health spelling — `nodeHost` uses `/health`, and
  // the day a port defaults to `/ping` is the day that runtime has leaked in.
  // Note again what is NOT here: `/.well-known/agent-card.json`, which belongs
  // to the A2A protocol and to no vendor, and lives in a neutral wire file.
  /\/ping\b/,
];

/**
 * Every `.ts` under `src/hosting`, INCLUDING subdirectories (9.36.1).
 *
 * It used to read one directory level, which was true of the tree until
 * `conformance/` arrived. A guardrail that stops at the first folder somebody
 * adds is a guardrail with an opt-out nobody had to ask for — and the whole
 * point of this test is that it is cruder than the thing it guards. Names are
 * reported relative to `src/hosting`, so a failure says which file.
 */
function hostingSources(dir: string = HOSTING_DIR, prefix = ''): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      found.push(...hostingSources(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith('.ts')) {
      found.push({
        file: `${prefix}${entry.name}`,
        text: readFileSync(join(dir, entry.name), 'utf8'),
      });
    }
  }
  return found;
}

describe('the hosting ports name no vendor', () => {
  it('finds the source files it is supposed to be checking', () => {
    const files = hostingSources().map((s) => s.file);
    // If this ever shrinks to nothing the test would pass vacuously.
    expect(files).toContain('types.ts');
    expect(files).toContain('nodeHost.ts');
    // The shared HTTP machinery is the file a vendor is MOST likely to leak
    // into, because every cloud adapter is a configuration of it.
    expect(files).toContain('httpHost.ts');
    // The conversation port and its transport, named one by one rather than
    // trusted to the directory listing: a new port file is exactly the moment
    // somebody is most tempted to write a vendor's spelling into it, and a pin
    // that only counts files would not notice the one that was never added.
    expect(files).toContain('webSocketConversation.ts');
    // And the subtree the walk was widened for: the conformance battery is
    // read by every store author, in-tree and out, which makes it the last
    // place a vendor's spelling should turn up as an example.
    expect(files).toContain('conformance/cases.ts');
    expect(files).toContain('webSocketFrames.ts');
    expect(files).toContain('headers.ts');
    expect(files.length).toBeGreaterThanOrEqual(10);
  });

  it.each(FORBIDDEN.map((pattern) => [pattern.source, pattern] as const))(
    'no hosting source mentions %s',
    (_label, pattern) => {
      const offenders = hostingSources()
        .filter(({ text }) => pattern.test(text))
        .map(({ file }) => file);
      expect(offenders).toEqual([]);
    },
  );

  it("nodeHost's defaults are its own, not inherited", () => {
    const source = hostingSources().find((s) => s.file === 'nodeHost.ts')!.text;
    expect(source).toContain("'/invoke'");
    expect(source).toContain("'/health'");
    // The conversation door's path is this adapter's own word too, named for
    // what it carries. `/ws` is one runtime's spelling and lives in that
    // runtime's adapter file, the same way `/invocations` does.
    expect(source).toContain("'/conversation'");
    expect(source).not.toContain("'/ws'");
  });
});
