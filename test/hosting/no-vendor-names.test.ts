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
  // A borrowed route literal is vendor shape even when no vendor is named.
  /\/invocations\b/,
];

function hostingSources(): { file: string; text: string }[] {
  return readdirSync(HOSTING_DIR)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => ({ file: name, text: readFileSync(join(HOSTING_DIR, name), 'utf8') }));
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
