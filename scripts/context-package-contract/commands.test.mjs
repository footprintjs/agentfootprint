/** Fixed IO boundary tests only; subprocess primitives are mocked, never executed. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { nativeCommands } from './commands.mjs';

const sourceRoot = resolve('unit-source');
const root = resolve('unit-consumer');
const temporary = resolve('unit-work');
const ids = ['source-cjs', 'source-pack', 'packed-cjs', 'packed-esm', 'packed-types'];
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const expected = [
  [
    process.execPath,
    [
      '--input-type=commonjs',
      '-e',
      "const c=require('contextfootprint'); if(c.participates(0)!==true)throw Error('source dependency did not load');",
    ],
    root,
  ],
  [
    npm,
    [
      'pack',
      '--offline',
      '--ignore-scripts',
      '--json',
      '--cache',
      join(temporary, 'pack-cache'),
      '--pack-destination',
      temporary,
    ],
    sourceRoot,
  ],
  [process.execPath, [join(root, 'node_modules', 'agentfootprint', '.context-smoke.cjs')], root],
  [process.execPath, [join(root, 'node_modules', 'agentfootprint', '.context-smoke.mjs')], root],
  [
    process.execPath,
    [
      join(sourceRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '.context-types.mts',
      '.context-types.cts',
    ],
    join(root, 'node_modules', 'agentfootprint'),
  ],
];

async function mockedIO(
  t,
  run,
  result = { status: 0, signal: null, stdout: 'captured stdout', stderr: 'captured stderr' },
) {
  const calls = [];
  t.mock.method(childProcess, 'spawnSync', (executable, args, options) => {
    calls.push({ kind: 'spawn', executable, args, options });
    return result;
  });
  t.mock.method(childProcess, 'execFileSync', (executable, args, options) => {
    calls.push({ kind: 'execFile', executable, args, options });
    return 'registry stdout';
  });
  syncBuiltinESMExports();
  try {
    await run(calls);
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
}

test('paired commands use exactly the five fixed argv/cwd pairs and retain bounded captured output', async (t) => {
  await mockedIO(t, async (calls) => {
    const commands = nativeCommands(sourceRoot, true);
    assert.equal(Object.isFrozen(commands), true);
    for (const id of ids)
      assert.deepEqual(commands.execute(id, { root, temporary }), {
        stdout: 'captured stdout',
        stderr: 'captured stderr',
      });
    assert.equal(calls.length, 5);
    for (const [index, call] of calls.entries()) {
      const [executable, args, cwd] = expected[index];
      assert.equal(call.kind, 'spawn');
      assert.equal(call.executable, executable);
      assert.deepEqual(call.args, args);
      assert.equal(call.options.cwd, cwd);
      assert.equal(call.options.encoding, 'utf8');
      assert.equal(call.options.timeout, 60_000);
      assert.equal(call.options.maxBuffer, 16 * 1024 * 1024);
      assert.equal(Object.hasOwn(call.options, 'shell'), false);
      assert.equal(Object.hasOwn(call.options, 'stdio'), false);
    }
  });
});

test('unknown command IDs cannot reach either subprocess primitive', async (t) => {
  await mockedIO(t, async (calls) => {
    for (const paired of [true, false]) {
      for (const id of ['npm install', 'source-pack --force', '', null]) {
        assert.throws(() => nativeCommands(sourceRoot, paired).execute(id, { root, temporary }));
      }
    }
    assert.equal(calls.length, 0);
  });
});

test('paired environment omits preloads, module search injection and synthetic secrets', async (t) => {
  const replacements = {
    NODE_PATH: '/unit-injected-modules',
    NODE_OPTIONS: '--require=unit-preload-must-not-run',
    CONTEXT_UNIT_SECRET: 'synthetic-only',
  };
  const saved = Object.fromEntries(Object.keys(replacements).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, replacements);
    await mockedIO(t, async (calls) => {
      nativeCommands(sourceRoot, true).execute('source-pack', { root, temporary });
      const env = calls[0].options.env;
      for (const key of Object.keys(replacements)) assert.equal(Object.hasOwn(env, key), false);
      assert.ok(
        Object.keys(env).every((key) => /^(PATH|SYSTEMROOT|WINDIR|TMP|TEMP|TMPDIR)$/i.test(key)),
      );
      for (const key of Object.keys(env)) assert.equal(env[key], process.env[key]);
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('ordinary registry commands retain their fixed argv and original environment behavior', async (t) => {
  const key = 'CONTEXT_UNIT_SECRET';
  const saved = process.env[key];
  process.env[key] = 'synthetic-only';
  try {
    await mockedIO(t, async (calls) => {
      const commands = nativeCommands(sourceRoot, false);
      for (const id of ids)
        assert.deepEqual(commands.execute(id, { root, temporary }), {
          stdout: 'registry stdout',
          stderr: '',
        });
      for (const [index, call] of calls.entries()) {
        const [executable, args, cwd] = expected[index];
        assert.equal(call.kind, 'execFile');
        assert.equal(call.executable, executable);
        assert.deepEqual(call.args, args);
        assert.equal(call.options.cwd, cwd);
        assert.equal(call.options.env.NODE_PATH, '');
        assert.equal(call.options.env[key], 'synthetic-only');
        assert.deepEqual(
          Object.keys(call.options.env).sort(),
          [...new Set([...Object.keys(process.env), 'NODE_PATH'])].sort(),
        );
        assert.equal(Object.hasOwn(call.options, 'timeout'), false);
        assert.equal(call.options.maxBuffer, 16 * 1024 * 1024);
      }
    });
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

for (const [name, outcome] of [
  ['nonzero exit', { status: 9, signal: null, stdout: 'partial', stderr: 'failure' }],
  ['Windows exit', { status: 4294967295, signal: null, stdout: '', stderr: 'failure' }],
  ['signal', { status: null, signal: 'SIGTERM', stdout: 'partial', stderr: 'interrupted' }],
  ['signal despite zero status', { status: 0, signal: 'SIGTERM', stdout: 'partial', stderr: '' }],
  [
    'spawn failure',
    {
      error: Object.assign(new Error('synthetic spawn error'), { code: 'ENOENT' }),
      status: null,
      signal: null,
      stdout: null,
      stderr: null,
    },
  ],
  [
    'timeout',
    {
      error: Object.assign(new Error('synthetic timeout'), { code: 'ETIMEDOUT' }),
      status: null,
      signal: 'SIGTERM',
      stdout: 'partial',
      stderr: 'timeout',
    },
  ],
  [
    'buffer limit',
    {
      error: Object.assign(new Error('synthetic output limit'), { code: 'ENOBUFS' }),
      status: null,
      signal: 'SIGTERM',
      stdout: 'bounded partial',
      stderr: 'limit',
    },
  ],
]) {
  test(`paired ${name} keeps the real outcome and captured streams`, async (t) => {
    await mockedIO(
      t,
      async (calls) => {
        assert.throws(
          () => nativeCommands(sourceRoot, true).execute('source-cjs', { root, temporary }),
          (error) => {
            if (outcome.error) assert.equal(error, outcome.error);
            assert.equal(error.status, outcome.status);
            assert.equal(error.signal, outcome.signal);
            assert.equal(error.stdout, outcome.stdout ?? '');
            assert.equal(error.stderr, outcome.stderr ?? '');
            return true;
          },
        );
        assert.equal(calls.length, 1);
      },
      outcome,
    );
  });
}
