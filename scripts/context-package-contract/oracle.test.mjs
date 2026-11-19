import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  checkInstalledContext,
  checkPackedContext,
  readSourceOracle,
  setupIdentity,
} from './oracle.mjs';

const VERSION = '0.1.1';
const RECORD = {
  version: VERSION,
  resolved: 'https://registry.npmjs.org/contextfootprint/-/contextfootprint-0.1.1.tgz',
  integrity: 'sha512-' + 'A'.repeat(86) + '==',
};
const digest = (text) => createHash('sha256').update(text).digest('hex');

async function json(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n');
}

async function fixture(run) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'af-context-oracle-')));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function sourceDocuments() {
  return {
    metadata: {
      name: 'agentfootprint',
      version: '14.7.2',
      description: 'μ fixture',
      dependencies: { contextfootprint: VERSION },
    },
    lock: {
      packages: {
        '': { dependencies: { contextfootprint: VERSION } },
        'node_modules/contextfootprint': { ...RECORD },
      },
    },
  };
}

async function writeSource(root, { metadata, lock }) {
  await json(join(root, 'package.json'), metadata);
  await json(join(root, 'package-lock.json'), lock);
}

async function writeInstalled(root, entries = { 'node_modules/contextfootprint': { ...RECORD } }) {
  await json(join(root, 'node_modules', '.package-lock.json'), { packages: entries });
  await json(join(root, 'node_modules', 'contextfootprint', 'package.json'), {
    name: 'contextfootprint',
    version: VERSION,
  });
}

test('the original source texts own the exact context oracle and byte identities', async () => {
  await fixture(async (root) => {
    const documents = sourceDocuments();
    documents.metadata.bundleDependencies = ['unrelated'];
    await writeSource(root, documents);
    const packageText = await readFile(join(root, 'package.json'), 'utf8');
    const lockText = await readFile(join(root, 'package-lock.json'), 'utf8');
    const oracle = await readSourceOracle(root);
    assert.equal(oracle.packageText, packageText);
    assert.equal(oracle.lockText, lockText);
    assert.deepEqual(oracle.lockedContext, RECORD);
    assert.deepEqual(oracle.identity, {
      manifestSha256: digest(packageText),
      lockSha256: digest(lockText),
    });
    assert.deepEqual(await setupIdentity(root), oracle.identity);
    await writeFile(join(root, 'package.json'), packageText + ' ');
    assert.notEqual((await setupIdentity(root)).manifestSha256, oracle.identity.manifestSha256);
  });
});

const invalidSource = [
  [
    'missing dependency',
    ({ metadata }) => {
      delete metadata.dependencies.contextfootprint;
    },
  ],
  [
    'a dependency range',
    ({ metadata }) => {
      metadata.dependencies.contextfootprint = '^0.1.1';
    },
  ],
  [
    'a prerelease dependency',
    ({ metadata }) => {
      metadata.dependencies.contextfootprint = '0.1.1-rc.0';
    },
  ],
  [
    'stale root lock declaration',
    ({ lock }) => {
      lock.packages[''].dependencies.contextfootprint = '0.1.2';
    },
  ],
  [
    'wrong locked version',
    ({ lock }) => {
      lock.packages['node_modules/contextfootprint'].version = '0.1.2';
    },
  ],
  [
    'foreign registry URL',
    ({ lock }) => {
      lock.packages['node_modules/contextfootprint'].resolved =
        'https://example.invalid/context.tgz';
    },
  ],
  [
    'wrong registry archive name',
    ({ lock }) => {
      lock.packages['node_modules/contextfootprint'].resolved = RECORD.resolved.replace(
        '0.1.1.tgz',
        '0.1.2.tgz',
      );
    },
  ],
  [
    'missing integrity',
    ({ lock }) => {
      delete lock.packages['node_modules/contextfootprint'].integrity;
    },
  ],
  [
    'non-SHA512 integrity',
    ({ lock }) => {
      lock.packages['node_modules/contextfootprint'].integrity = 'sha256-abcd';
    },
  ],
  [
    'bundle-all',
    ({ metadata }) => {
      metadata.bundleDependencies = true;
    },
  ],
  [
    'named bundle',
    ({ metadata }) => {
      metadata.bundleDependencies = ['contextfootprint'];
    },
  ],
  [
    'bundledDependencies spelling',
    ({ metadata }) => {
      metadata.bundledDependencies = ['contextfootprint'];
    },
  ],
];
for (const [name, change] of invalidSource) {
  test('source oracle refuses ' + name, async () => {
    await fixture(async (root) => {
      const documents = sourceDocuments();
      change(documents);
      await writeSource(root, documents);
      await assert.rejects(readSourceOracle(root));
    });
  });
}

test('installed context matches one hidden-lock record and the actual package manifest', async () => {
  await fixture(async (root) => {
    await writeInstalled(root, {
      'node_modules/unrelated': { version: '1.0.0' },
      'node_modules/contextfootprint': { ...RECORD },
    });
    const result = await checkInstalledContext(root, { lockedContext: RECORD });
    assert.deepEqual(result, {
      path: 'node_modules/contextfootprint',
      realPath: await realpath(join(root, 'node_modules/contextfootprint')),
      ...RECORD,
      manifestSha256: digest(
        await readFile(join(root, 'node_modules/contextfootprint/package.json')),
      ),
    });
  });
});

for (const [name, entries] of [
  ['no matching entry', {}],
  [
    'two physical entries, even at the same version',
    {
      'node_modules/contextfootprint': { ...RECORD },
      'node_modules/other/node_modules/contextfootprint': { ...RECORD },
    },
  ],
  ['wrong version', { 'node_modules/contextfootprint': { ...RECORD, version: '0.1.2' } }],
  [
    'wrong registry URL',
    {
      'node_modules/contextfootprint': {
        ...RECORD,
        resolved: 'https://example.invalid/context.tgz',
      },
    },
  ],
  [
    'wrong archive integrity',
    { 'node_modules/contextfootprint': { ...RECORD, integrity: 'sha512-other' } },
  ],
]) {
  test('installed context refuses ' + name, async () => {
    await fixture(async (root) => {
      await writeInstalled(root, entries);
      await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }));
    });
  });
}

test('installed context reads the actual manifest rather than trusting hidden-lock metadata', async () => {
  await fixture(async (root) => {
    await writeInstalled(root);
    await json(join(root, 'node_modules/contextfootprint/package.json'), {
      name: 'contextfootprint',
      version: '0.1.2',
    });
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }));
    await writeFile(join(root, 'node_modules/contextfootprint/package.json'), '{broken');
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }));
  });
});

for (const path of [
  '../outside/node_modules/contextfootprint',
  './node_modules/contextfootprint',
  '/absolute/node_modules/contextfootprint',
  'node_modules\\contextfootprint',
]) {
  test(
    'installed context refuses malformed/traversing record path ' + JSON.stringify(path),
    async () => {
      await fixture(async (root) => {
        await writeInstalled(root, { [path]: { ...RECORD } });
        await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }));
      });
    },
  );
}

test('a context package link cannot escape the actual consumer boundary', async () => {
  await fixture(async (box) => {
    const root = join(box, 'consumer');
    const outside = join(box, 'outside');
    await json(join(root, 'node_modules/.package-lock.json'), {
      packages: { 'node_modules/contextfootprint': { ...RECORD } },
    });
    await json(join(outside, 'package.json'), { name: 'contextfootprint', version: VERSION });
    await symlink(outside, join(root, 'node_modules/contextfootprint'), 'dir');
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }));
  });
});

test('packed assertions keep their original test and context-bundle refusals', () => {
  assert.doesNotThrow(() =>
    checkPackedContext([
      { path: 'dist/index.js' },
      { path: 'dist/contest.js' },
      { path: 'node_modules/contextfootprint-helper/index.js' },
    ]),
  );
  for (const path of [
    'dist/unit.test.js',
    'dist/nested.test.mjs',
    'node_modules/contextfootprint/index.js',
    'nested/node_modules/contextfootprint',
  ]) {
    assert.throws(() => checkPackedContext([{ path }]));
  }
});

test('installed context identity refuses a wrong actual package name despite a matching version', async () => {
  await fixture(async (root) => {
    await writeInstalled(root);
    await json(join(root, 'node_modules/contextfootprint/package.json'), {
      name: 'different-package',
      version: VERSION,
    });
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }), {
      code: 'ERR_ASSERTION',
    });
  });
});

test('installed context identity refuses a same-root package directory alias', async () => {
  await fixture(async (root) => {
    await writeInstalled(root);
    const packagePath = join(root, 'node_modules/contextfootprint');
    const sameRootImage = join(root, 'context-image');
    await json(join(sameRootImage, 'package.json'), { name: 'contextfootprint', version: VERSION });
    await rm(packagePath, { recursive: true });
    await symlink(sameRootImage, packagePath, 'dir');
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }), {
      code: 'ERR_ASSERTION',
    });
  });
});

test('installed context identity refuses a linked package manifest inside the consumer', async () => {
  await fixture(async (root) => {
    await writeInstalled(root);
    const manifestPath = join(root, 'node_modules/contextfootprint/package.json');
    const sameRootManifest = join(root, 'context-manifest.json');
    await json(sameRootManifest, { name: 'contextfootprint', version: VERSION });
    await rm(manifestPath);
    await symlink(sameRootManifest, manifestPath);
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }), {
      code: 'ERR_ASSERTION',
    });
  });
});

test('installed context identity refuses an outside linked manifest before parsing its bytes', async () => {
  await fixture(async (box) => {
    const root = join(box, 'consumer');
    await writeInstalled(root);
    const manifestPath = join(root, 'node_modules/contextfootprint/package.json');
    const outside = join(box, 'outside-manifest.json');
    await writeFile(outside, '{outside-fixture-not-json');
    await rm(manifestPath);
    await symlink(outside, manifestPath);
    await assert.rejects(checkInstalledContext(root, { lockedContext: RECORD }), {
      code: 'ERR_ASSERTION',
    });
    assert.equal(await readFile(outside, 'utf8'), '{outside-fixture-not-json');
  });
});
