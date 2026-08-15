/**
 * The artifact PORT must not know whose bucket it is.
 *
 * The sibling of `test/hosting/no-vendor-names.test.ts`, applied to the store
 * the same way and for the same reason: `src/artifacts/` now contains two cloud
 * adapters, and the failure this guards against is somebody, in a hurry, adding
 * `region` or `Bucket` or a vendor's metadata cap to a shared file "just for
 * now" — because after that every adapter inherits that vendor's shape forever.
 *
 * The split this test enforces is the whole architecture in one line:
 *
 *   • **the adapter files ARE the vendor layer** — `s3Artifacts.ts` and
 *     `gcsArtifacts.ts` name their SDKs, their commands and their caps, which
 *     is exactly where a vendor belongs. They are exempt BY NAME, so adding a
 *     third cloud column is a conscious edit to this list rather than a silent
 *     widening of the exemption.
 *   • **everything else is port or shared law** — and may not name a vendor at
 *     all. `objectStore.ts` is the file this matters most for: it says in its
 *     own header that it "imports no SDK, names no vendor, and knows no wire
 *     format", and a claim a file makes about itself should be tested rather
 *     than trusted.
 *
 * Crude and deliberately so. A subtler check would be a better test and a worse
 * guardrail.
 */

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ARTIFACTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/artifacts');

/**
 * The vendor layer — the ONLY files here allowed to name a cloud. Listed
 * explicitly: a new cloud adapter must be added here on purpose, which is the
 * moment somebody re-reads what the exemption means.
 */
const VENDOR_LAYER: readonly string[] = ['s3Artifacts.ts', 'gcsArtifacts.ts'];

/** Names no port or shared-law file may contain. Word-bounded so ordinary
 *  prose ("the object store", "a bucket") survives. */
const FORBIDDEN: readonly RegExp[] = [
  /\baws\b/i,
  /\bamazon\b/i,
  /\bs3\b/i,
  /\bgcs\b/i,
  /\bgcp\b/i,
  /\bazure\b/i,
  /\bbedrock\b/i,
  /\bcloudflare\b/i,
  /\bfirebase\b/i,
  /\bdynamodb\b/i,
  /\bcloud\s+storage\b/i,
  /\bblob\s+storage\b/i,
  // Wire-shape leaks: a vendor's own request field names, which are how a
  // vendor's shape enters a port without its name ever appearing.
  /\bContinuationToken\b/,
  /\bx-amz-/i,
];

/**
 * Every `.ts` under `src/artifacts`, SUBTREES INCLUDED.
 *
 * Widened when `conformance/` arrived: a guardrail that stops at the first
 * folder somebody adds is a guardrail that ages badly, and the battery is
 * exactly the kind of file a vendor name creeps into ("skip this case on the
 * bucket one"). Names are relative to the root so a report says
 * `conformance/cases.ts` rather than `cases.ts`.
 */
function artifactSources(): { file: string; text: string }[] {
  const found: { file: string; text: string }[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, `${prefix}${entry.name}/`);
      else if (entry.name.endsWith('.ts')) {
        found.push({ file: `${prefix}${entry.name}`, text: readFileSync(path, 'utf8') });
      }
    }
  };
  walk(ARTIFACTS_DIR, '');
  return found;
}

describe('the artifact port names no vendor', () => {
  it('finds the source files it is supposed to be checking', () => {
    const files = artifactSources().map((s) => s.file);
    // If this ever shrinks to nothing the test would pass vacuously.
    expect(files).toContain('types.ts');
    // The shared object-adapter law is the file a vendor is MOST likely to leak
    // into, because both cloud adapters are a translation of it.
    expect(files).toContain('objectStore.ts');
    expect(files).toContain('scopePath.ts');
    expect(files).toContain('streaming.ts');
  });

  it('every vendor-layer file this test exempts actually exists', () => {
    const files = artifactSources().map((s) => s.file);
    for (const exempt of VENDOR_LAYER) expect(files).toContain(exempt);
  });

  it.each(
    artifactSources()
      .filter((source) => !VENDOR_LAYER.includes(source.file))
      .map((source) => [source.file, source.text] as const),
  )('%s names no cloud vendor and borrows no wire field', (file, text) => {
    for (const pattern of FORBIDDEN) {
      expect(
        pattern.test(text),
        `${file} matches ${pattern}. This file is port or shared law — the vendor layer is ` +
          `${VENDOR_LAYER.join(' / ')}. If this is a real new cloud adapter, add it to ` +
          `VENDOR_LAYER; if it is a vendor detail that crept into shared code, move it into ` +
          `the adapter where it belongs.`,
      ).toBe(false);
    }
  });

  it('the two cloud adapters DO name their vendors — the exemption is real, not decorative', () => {
    const sources = new Map(artifactSources().map((s) => [s.file, s.text]));
    // A vendor layer that named nothing would mean the split had quietly
    // collapsed and this whole test was guarding an empty distinction.
    expect(sources.get('s3Artifacts.ts')).toMatch(/@aws-sdk\/client-s3/);
    expect(sources.get('gcsArtifacts.ts')).toMatch(/@google-cloud\/storage/);
  });

  it('no shared file imports a cloud SDK — the lazy-load law, checked structurally', () => {
    for (const { file, text } of artifactSources()) {
      if (VENDOR_LAYER.includes(file)) continue;
      expect(
        /from\s+'@(aws-sdk|google-cloud)\//.test(text),
        `${file} imports a cloud SDK. Only the vendor layer may, and even there it is loaded ` +
          `lazily at construction so a browser bundle never sees it.`,
      ).toBe(false);
    }
  });
});
