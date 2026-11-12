import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as charts from './chart.js';
import { buildStore } from './factory.js';
import { EnvelopeTooLargeError } from './errors.js';
import { FIRESTORE_MAX_ENVELOPE_BYTES } from './constants.js';
import type { SessionRunRecord } from './record.js';
import { fakeFirestore } from '../../../../test/hosting/firestoreDouble.js';

const ROOT = process.cwd();
const README = resolve(ROOT, 'src/adapters/hosting/firestoreSessions/README.md');
const chartNames = [
  'saveChart',
  'hydrateChart',
  'listChart',
  'ownerChart',
  'forgetChart',
  'ownershipChart',
  'closeChart',
] as const;
export function diagrams(): string {
  return chartNames
    .map((name) => `### ${name}\n\n\`\`\`mermaid\n${charts[name].toMermaid()}\n\`\`\`\n`)
    .join('\n');
}

describe('chart pilot artifacts', () => {
  it('pins each README drawing to the actual executable chart', () => {
    const generated = diagrams();
    if (process.env.AF_FIRESTORE_PILOT_ARTIFACTS === 'write') {
      const text = readFileSync(README, 'utf8');
      writeFileSync(
        README,
        text.replace(
          /<!-- charts:start -->[\s\S]*<!-- charts:end -->/,
          `<!-- charts:start -->\n${generated}<!-- charts:end -->`,
        ),
      );
    }
    const text = readFileSync(README, 'utf8');
    expect(text).toContain(`<!-- charts:start -->\n${generated}<!-- charts:end -->`);
  });

  it('saves an actual refused run with bounded facts and the original refusal', async () => {
    const fake = fakeFirestore();
    const records: SessionRunRecord[] = [];
    const store = buildStore({ _sdk: fake.sdk }, (record) => records.push(record));
    const content = 'private-canary'.repeat(100000);
    const envelope = {
      format: 'conversation-v1' as const,
      savedAt: 1700000000000,
      data: {
        version: 1 as const,
        runId: 'pilot-run',
        history: [{ role: 'user' as const, content }],
        lastCompletedIteration: 0,
        originalInput: { message: 'hello' },
        checkpointedAt: 1700000000000,
      },
    };
    const error = await store.persist('pilot-refused', envelope).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EnvelopeTooLargeError);
    expect(fake.calls).not.toContain('Firestore.runTransaction');
    expect(records).toHaveLength(1);
    const record = records[0];
    const raw = JSON.stringify(record);
    expect(raw).toContain('envelope-too-large');
    expect(raw).not.toContain('private-canary');
    const refusal = error as EnvelopeTooLargeError;
    const artifact = {
      sentence: `Save refused: ${refusal.bytes} bytes exceeds the ${FIRESTORE_MAX_ENVELOPE_BYTES}-byte envelope ceiling; no transaction started.`,
      error: {
        name: refusal.name,
        code: refusal.code,
        message: refusal.message,
        bytes: refusal.bytes,
      },
      record,
    };
    if (process.env.AF_FIRESTORE_PILOT_ARTIFACTS === 'write') {
      mkdirSync(resolve(ROOT, 'bench/results'), { recursive: true });
      writeFileSync(
        resolve(ROOT, 'bench/results/firestore-refused-save.json'),
        JSON.stringify(artifact, null, 2) + '\n',
      );
    }
    await store.close();
  });
});
