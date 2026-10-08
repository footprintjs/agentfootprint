/**
 * No policy ⇒ byte-identical to `main`: a no-policy agent's WHOLE event
 * stream — a declared tool call, a tool the model made up, a call with
 * invalid arguments, a person asked mid-run and the resume, a composition, a
 * consumer's own emit, a host's fact filed for the run — is the stream the
 * library produced before the redaction work, byte for byte.
 *
 * The golden (`fixtures/no-policy-stream.main.json`) was produced by running
 * THIS scenario (`noPolicyStream.scenario.ts`, public API only) against
 * `main` at 228d85e1 (v9.139.0); only clock readings, durations and minted
 * run ids are normalized. A change that alters what a no-policy run emits —
 * a field added, renamed, reordered or served differently — fails here.
 * Regenerate it only from `main`, never from this branch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { noPolicyStream } from './noPolicyStream.scenario.js';

describe('no policy ⇒ the whole event stream is byte-identical to main', () => {
  it('the scenario’s stream equals the golden produced on main', async () => {
    const golden = readFileSync(join(__dirname, 'fixtures/no-policy-stream.main.json'), 'utf8');
    expect(await noPolicyStream()).toBe(golden);
  });
});
