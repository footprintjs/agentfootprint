import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC_NAMES = [
  'DEFAULT_SESSION_COLLECTION',
  'EXPIRES_AT_FIELD',
  'EnvelopeTooLargeError',
  'FIRESTORE_MAX_DOCUMENT_BYTES',
  'FIRESTORE_MAX_ENVELOPE_BYTES',
  'FirestoreIndexMissingError',
  'documentIdFor',
  'firestoreFailure',
  'firestoreSessions',
  'grpcStatusOf',
  'isFailedPrecondition',
  'ttlPolicyCommand',
].sort();

describe('Firestore folder entry in real Node loaders', () => {
  it('keeps the same names and store contract in focused CJS and ESM bundles', () => {
    mkdirSync(join(ROOT, 'dist'), { recursive: true });
    const directory = mkdtempSync(join(ROOT, 'dist/.firestore-pilot-'));
    try {
      for (const format of ['cjs', 'esm'] as const)
        buildSync({
          entryPoints: [join(ROOT, 'src/adapters/hosting/firestoreSessions/index.ts')],
          outfile: join(directory, format === 'cjs' ? 'adapter.cjs' : 'adapter.mjs'),
          platform: 'node',
          target: 'node22',
          format,
          bundle: true,
          packages: 'external',
          logLevel: 'silent',
        });
      buildSync({
        entryPoints: [join(ROOT, 'test/hosting/firestoreDouble.ts')],
        outfile: join(directory, 'fake.cjs'),
        platform: 'node',
        format: 'cjs',
        bundle: true,
        packages: 'external',
        logLevel: 'silent',
      });
      const script = `
        const { pathToFileURL } = require('node:url');
        (async () => {
          const modules = [require(process.argv[1]), await import(pathToFileURL(process.argv[2]).href)];
          const { fakeFirestore } = require(process.argv[3]);
          const answers = [];
          for (const api of modules) {
            const fake = fakeFirestore();
            const store = api.firestoreSessions({ _sdk: fake.sdk });
            const envelope = { format: 'conversation-v1', savedAt: 1700000000000,
              data: { version: 1, runId: 'packaging-run', history: [{ role: 'user', content: 'hello' }],
              lastCompletedIteration: 0, originalInput: { message: 'hello' }, checkpointedAt: 1700000000000 } };
            await store.persist('session', envelope);
            const restored = await store.hydrate('session');
            const row = fake.store.get(store.documentIdFor('session'));
            await store.close();
            answers.push({ names: Object.keys(api).filter(name => name !== 'default').sort(),
              same: JSON.stringify(restored) === JSON.stringify(envelope),
              fields: Object.keys(row).sort(), terminated: fake.terminated() });
          }
          process.stdout.write(JSON.stringify(answers));
        })().catch(error => { console.error(error); process.exitCode = 1; });
      `;
      const answers = JSON.parse(
        execFileSync(
          process.execPath,
          [
            '-e',
            script,
            join(directory, 'adapter.cjs'),
            join(directory, 'adapter.mjs'),
            join(directory, 'fake.cjs'),
          ],
          { cwd: ROOT, encoding: 'utf8', timeout: 15000 },
        ),
      );
      expect(answers).toEqual(
        [0, 1].map(() => ({
          names: PUBLIC_NAMES,
          same: true,
          fields: [
            'envelope',
            'expiresAt',
            'format',
            'messageCount',
            'owner',
            'savedAt',
            'sessionId',
          ],
          terminated: true,
        })),
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
