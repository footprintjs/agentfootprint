/** Unit controller fixtures only: passing does not establish installed package compatibility. */
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { errorTree, probePaths, rejected, runnerFixture } from './runner-fixture.mjs';

const cases = ['source-online', 'source-offline', 'consumer-online', 'consumer-offline'];
const commandsOf = (f) => f.events.filter((event) => event.kind === 'command');
const guardsOf = (f) => f.events.filter((event) => event.kind === 'guard');

test('four new roots run in order with strict policy and separate source/consumer caches', async (t) => {
  const f = await runnerFixture(t);
  const result = await f.run();
  assert.equal(result.complete, true);
  assert.equal(result.mode, 'paired');
  assert.deepEqual(
    result.cases.map((row) => row.caseId),
    cases,
  );
  assert.equal(new Set(f.requests.map((request) => request.rootRealPath)).size, 4);
  assert.deepEqual(
    f.requests.map((request) => request.caseId),
    cases,
  );
  for (const request of f.requests) {
    assert.deepEqual(request.policy, {
      omitDev: true,
      scripts: false,
      peers: 'strict',
      offline: request.caseId.endsWith('-offline'),
    });
    assert.equal(Object.isFrozen(request), true);
    assert.equal(Object.isFrozen(request.policy), true);
    assert.equal(Object.isFrozen(request.source), true);
    assert.equal(
      request.originalManifestText,
      await readFile(join(f.sourceRoot, 'package.json'), 'utf8'),
    );
    assert.equal(
      request.originalLockText,
      await readFile(join(f.sourceRoot, 'package-lock.json'), 'utf8'),
    );
  }
  const [sourceOnline, sourceOffline, consumerOnline, consumerOffline] = f.requests;
  assert.equal(sourceOnline.cache.realPath, sourceOffline.cache.realPath);
  assert.equal(consumerOnline.cache.realPath, consumerOffline.cache.realPath);
  assert.notEqual(sourceOnline.cache.realPath, consumerOnline.cache.realPath);
  const installs = f.events.filter((event) => event.kind === 'install');
  assert.deepEqual(
    installs.map((event) => event.cacheBefore),
    [[], ['unit-cache-marker'], [], ['unit-cache-marker']],
  );
  assert.equal(sourceOnline.contextArtifact, null);
  assert.deepEqual(consumerOnline.contextArtifact, consumerOffline.contextArtifact);
  assert.equal(consumerOnline.contextArtifact.sourceVersion, '14.7.2');
  await f.assertPreserved(assert);
});

test('every fixed command is bracketed by its own guards; cleanup follows each installed root', async (t) => {
  const f = await runnerFixture(t);
  const result = await f.run();
  assert.deepEqual(
    commandsOf(f).map((event) => event.id),
    [
      'source-cjs',
      'source-cjs',
      'source-pack',
      'packed-cjs',
      'packed-esm',
      'packed-types',
      'packed-cjs',
      'packed-esm',
      'packed-types',
    ],
  );
  for (let index = 0; index < f.events.length; index++) {
    const event = f.events[index];
    if (event.kind !== 'command') continue;
    const before = f.events[index - 1],
      after = f.events[index + 1];
    assert.equal(before.kind, 'guard');
    assert.equal(after.kind, 'guard');
    assert.equal(before.boundary.phase, 'before-command');
    assert.equal(after.boundary.phase, 'after-command');
    assert.equal(before.boundary.command, event.id);
    assert.equal(after.boundary.command, event.id);
    assert.equal(before.boundary.rootRealPath, event.root);
    assert.equal(after.boundary.rootRealPath, event.root);
    assert.equal(before.boundary.execution, null);
    assert.deepEqual(after.boundary.execution, { exitCode: 0, signal: null });
  }
  assert.deepEqual(
    guardsOf(f)
      .filter((event) => event.boundary.phase === 'after-cleanup')
      .map((event) => event.boundary.caseId),
    cases,
  );
  for (const row of result.cases) {
    assert.equal(row.complete, true);
    assert.equal(row.restored.boundary.phase, 'after-cleanup');
    assert.equal(row.restored.boundary.command, null);
    assert.equal(row.restored.boundary.execution, null);
  }
  assert.equal(result.producerCommands[0].before.boundary.caseId, null);
  await f.assertPreserved(assert);
});

test('only the four declared probes exist at their phases, with exact rendered bytes', async (t) => {
  const f = await runnerFixture(t);
  await f.run();
  for (const event of guardsOf(f)) {
    const { boundary, actualProbes } = event;
    assert.deepEqual(
      actualProbes.map((probe) => probe.path),
      boundary.probes.map((probe) => probe.relativePath),
    );
    for (let index = 0; index < actualProbes.length; index++) {
      const actual = actualProbes[index],
        expected = boundary.probes[index];
      assert.equal(actual.body, expected.body);
      assert.equal(actual.sha256, expected.sha256);
      assert.equal(actual.size, expected.size);
    }
    if (boundary.command === 'packed-types')
      assert.deepEqual(
        actualProbes.map((probe) => probe.path),
        probePaths,
      );
    else if (boundary.command?.startsWith('packed-'))
      assert.deepEqual(
        actualProbes.map((probe) => probe.path),
        probePaths.slice(0, 2),
      );
    else assert.deepEqual(actualProbes, []);
  }
  for (const event of commandsOf(f)) {
    assert.equal(
      event.actualProbes.length,
      event.id === 'packed-types' ? 4 : event.id.startsWith('packed-') ? 2 : 0,
    );
  }
  await f.assertPreserved(assert);
});

for (const [name, change] of [
  [
    'unknown input',
    (input) => {
      input.extra = true;
    },
  ],
  [
    'missing source proof',
    (input) => {
      delete input.producerProofRefs.source;
    },
  ],
  [
    'missing installer',
    (input) => {
      delete input.installPackedConsumer;
    },
  ],
  [
    'source digest mismatch',
    (input) => {
      input.source.lockSha256 = 'f'.repeat(64);
    },
  ],
]) {
  test(`bad input refuses before any install: ${name}`, async (t) => {
    const f = await runnerFixture(t);
    change(f.input);
    await rejected(() => f.run());
    assert.deepEqual(f.events, []);
    await f.assertPreserved(assert);
  });
}

for (const [name, edit] of [
  [
    'setup manifest',
    async (request) => writeFile(join(request.rootRealPath, 'package.json'), '{}'),
  ],
  [
    'source lock',
    async (_request, _handle, f) => writeFile(join(f.sourceRoot, 'package-lock.json'), '{}'),
  ],
  [
    'hidden lock integrity',
    async (request, _handle, f) =>
      f.json(join(request.rootRealPath, 'node_modules', '.package-lock.json'), {
        packages: { 'node_modules/contextfootprint': { ...f.context, integrity: 'sha512-YmFk' } },
      }),
  ],
  [
    'installed context version',
    async (request, _handle, f) =>
      f.json(join(request.rootRealPath, 'node_modules', 'contextfootprint', 'package.json'), {
        version: '0.0.0',
      }),
  ],
]) {
  test(`tampered ${name} prevents the first command`, async (t) => {
    const f = await runnerFixture(t, { install: edit });
    const error = await rejected(() => f.run());
    assert.equal(error.contextPackageEvidence.complete, false);
    assert.equal(commandsOf(f).length, 0);
    await f.assertPreserved(assert);
  });
}

for (const [name, edit] of [
  [
    'missing verify',
    (_request, handle) => {
      delete handle.verify;
    },
  ],
  [
    'wrong source proof',
    (_request, handle) => {
      handle.receipt.proofRefs.source.id = 'another-source';
    },
  ],
  [
    'wrong setup receipt',
    (_request, handle) => {
      handle.receipt.setup = { ...handle.receipt.setup, lockSha256: 'f'.repeat(64) };
    },
  ],
  [
    'wrong receipt root',
    (_request, handle) => {
      handle.receipt.rootRealPath += '-other';
    },
  ],
]) {
  test(`wrong install handle refuses before commands: ${name}`, async (t) => {
    const f = await runnerFixture(t, { install: edit });
    const error = await rejected(() => f.run());
    assert.equal(error.contextPackageEvidence.complete, false);
    assert.equal(commandsOf(f).length, 0);
    await f.assertPreserved(assert);
  });
}

for (const change of ['boundary', 'source-proof']) {
  test(`wrong ${change} from before guard refuses execution`, async (t) => {
    const f = await runnerFixture(t, {
      guard(boundary, receipt) {
        if (boundary.phase === 'before-command') {
          if (change === 'boundary') receipt.boundary.rootRealPath += '-other';
          else receipt.proofRefs.source.id = 'wrong-source';
        }
      },
    });
    const error = await rejected(() => f.run());
    assert.equal(error.contextPackageEvidence.complete, false);
    assert.equal(commandsOf(f).length, 0);
    assert.equal(guardsOf(f).at(-1).boundary.phase, 'after-cleanup');
    await f.assertPreserved(assert);
  });
}

test('a failed command still gets its after guard and cleanup; the command error stays primary', async (t) => {
  const original = Object.assign(new Error('synthetic command failure'), {
    status: 7,
    stdout: 'partial output',
    stderr: 'diagnostic',
  });
  const afterError = new Error('synthetic after guard failure');
  const cleanupError = new Error('synthetic cleanup guard failure');
  const f = await runnerFixture(t, {
    command(id) {
      if (id === 'packed-cjs') throw original;
    },
    guard(boundary) {
      if (boundary.caseId !== 'consumer-online') return;
      if (boundary.phase === 'after-command') throw afterError;
      if (boundary.phase === 'after-cleanup') throw cleanupError;
    },
  });
  const error = await rejected(() => f.run());
  assert.equal(error.message, original.message);
  const errors = errorTree(error);
  assert.ok(errors.includes(original));
  assert.ok(errors.includes(afterError));
  assert.ok(errors.includes(cleanupError));
  const row = error.contextPackageEvidence.cases.find(
    (value) => value.caseId === 'consumer-online',
  );
  assert.equal(row.complete, false);
  assert.deepEqual(row.commands[0].execution, { exitCode: 7, signal: null });
  assert.equal(row.commands[0].stdout, 'partial output');
  assert.equal(row.commands[0].stderr, 'diagnostic');
  assert.deepEqual(
    guardsOf(f)
      .filter((event) => event.boundary.caseId === 'consumer-online')
      .map((event) => event.boundary.phase),
    ['before-command', 'after-command', 'after-cleanup'],
  );
  assert.deepEqual(guardsOf(f).at(-1).actualProbes, []);
  assert.equal(
    f.requests.some((request) => request.caseId === 'consumer-offline'),
    false,
  );
  await f.assertPreserved(assert);
});

test('partial install failure is incomplete and removes only the owned child', async (t) => {
  const original = new Error('synthetic installer stopped');
  const f = await runnerFixture(t, {
    install(request) {
      if (request.caseId === 'source-offline') throw original;
    },
  });
  const error = await rejected(() => f.run());
  assert.equal(error.contextPackageEvidence.complete, false);
  assert.ok(errorTree(error).includes(original));
  assert.deepEqual(
    commandsOf(f).map((event) => event.id),
    ['source-cjs'],
  );
  assert.equal(
    error.contextPackageEvidence.cases.some(
      (row) => row.caseId === 'source-offline' && row.complete,
    ),
    false,
  );
  await f.assertPreserved(assert);
});

test('a pre-existing work-parent entry is preserved and prevents every effect', async (t) => {
  const f = await runnerFixture(t);
  await writeFile(join(f.ownedWorkRoot, 'keep.txt'), 'belongs to the caller');
  await rejected(() => f.run());
  assert.deepEqual(f.events, []);
  assert.equal(await readFile(join(f.ownedWorkRoot, 'keep.txt'), 'utf8'), 'belongs to the caller');
  assert.deepEqual(await readdir(f.ownedWorkRoot), ['keep.txt']);
});

for (const [name, edit] of [
  ['setup', async (boundary) => writeFile(join(boundary.rootRealPath, 'package.json'), '{}')],
  ['source', async (_boundary, f) => writeFile(join(f.sourceRoot, 'package-lock.json'), '{}')],
  [
    'context metadata',
    async (boundary, f) =>
      f.json(join(boundary.rootRealPath, 'node_modules', 'contextfootprint', 'package.json'), {
        version: '0.0.0',
      }),
  ],
]) {
  test(`a verifier cannot modify the checked ${name} and then release a command`, async (t) => {
    const f = await runnerFixture(t, {
      async guard(boundary, _receipt, fixture) {
        if (boundary.caseId === 'source-online' && boundary.phase === 'before-command')
          await edit(boundary, fixture);
      },
    });
    const error = await rejected(() => f.run());
    assert.equal(error.contextPackageEvidence.complete, false);
    assert.equal(
      commandsOf(f).length,
      0,
      `changed ${name} must be refused before the command executes`,
    );
    await f.assertPreserved(assert);
  });
}

for (const target of ['probe', 'archive']) {
  test(`a verifier cannot change the admitted ${target} before a packed command`, async (t) => {
    const f = await runnerFixture(t, {
      async guard(boundary, _receipt, fixture) {
        if (
          boundary.caseId === 'consumer-online' &&
          boundary.phase === 'before-command' &&
          boundary.command === 'packed-cjs'
        ) {
          const path =
            target === 'probe'
              ? join(boundary.rootRealPath, 'node_modules', 'agentfootprint', '.context-smoke.cjs')
              : fixture.requests.at(-1).contextArtifact.path;
          await writeFile(path, 'changed by verifier');
        }
      },
    });
    const error = await rejected(() => f.run());
    assert.equal(error.contextPackageEvidence.complete, false);
    assert.equal(
      commandsOf(f).some((event) => event.id === 'packed-cjs'),
      false,
    );
    await f.assertPreserved(assert);
  });
}

test('cleanup verifier cannot change the restored setup and still yield a complete result', async (t) => {
  const f = await runnerFixture(t, {
    async guard(boundary) {
      if (boundary.caseId === 'source-online' && boundary.phase === 'after-cleanup') {
        await writeFile(join(boundary.rootRealPath, 'package.json'), '{}');
      }
    },
  });
  const error = await rejected(() => f.run());
  assert.equal(error.contextPackageEvidence.complete, false);
  assert.equal(
    f.requests.some((request) => request.caseId === 'source-offline'),
    false,
  );
  await f.assertPreserved(assert);
});

test('command returning malformed output cannot be recorded as a successful boundary', async (t) => {
  const f = await runnerFixture(t, {
    command(id) {
      if (id === 'source-cjs') return { stdout: undefined, stderr: '' };
    },
  });
  const error = await rejected(() => f.run());
  assert.equal(error.contextPackageEvidence.complete, false);
  assert.deepEqual(error.contextPackageEvidence.cases[0].commands[0].execution, {
    exitCode: null,
    signal: null,
  });
  assert.deepEqual(
    guardsOf(f).map((event) => event.boundary.phase),
    ['before-command', 'after-command', 'after-cleanup'],
  );
  await f.assertPreserved(assert);
});

test('a cancellation retains its actual signal and still gets after and cleanup guards', async (t) => {
  const original = Object.assign(new Error('synthetic cancellation'), {
    status: null,
    signal: 'SIGTERM',
  });
  const f = await runnerFixture(t, {
    command(id) {
      if (id === 'source-cjs') throw original;
    },
  });
  const error = await rejected(() => f.run());
  assert.ok(errorTree(error).includes(original));
  assert.deepEqual(error.contextPackageEvidence.cases[0].commands[0].execution, {
    exitCode: null,
    signal: 'SIGTERM',
  });
  assert.deepEqual(
    guardsOf(f).map((event) => event.boundary.phase),
    ['before-command', 'after-command', 'after-cleanup'],
  );
  await f.assertPreserved(assert);
});
