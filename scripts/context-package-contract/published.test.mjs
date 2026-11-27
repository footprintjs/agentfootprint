/** Real port/refusal logic over inert archives and intercepted npm. Not installation or compatibility proof. */
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import test from 'node:test';
import { PROTOCOL, validateHandle, validateGuardReceipt } from './protocol.mjs';
import { admitPublishedInputs } from './publishedInputs.mjs';
import { publishedFixture, hash, write, json, readJson, inertCode } from './published-fixture.mjs';

const innerRefs = ['source', 'install', 'inputs', 'graph'];
const producerRefs = [...innerRefs, 'build'];
const install = (ports, request) =>
  request.caseId.startsWith('source-')
    ? ports.installSourceRoot(request)
    : ports.installPackedConsumer(request);

test('producer compiler remains bound to the original toolchain lock before an inner install', async (t) => {
  const f = publishedFixture(t);
  const ports = f.createPorts();
  const file = join(f.sourceRoot, 'node_modules/.package-lock.json');
  const lock = readJson(file);
  lock.packages['node_modules/typescript'].version = '5.4.6';
  json(file, lock);
  await assert.rejects(() => ports.installSourceRoot(f.request('source-online')), /compiler input changed/);
});
function checkRefs(f, refs) {
  for (const ref of Object.values(refs))
    assert.equal(hash(readFileSync(join(f.evidenceRoot, ref.id + '.json'))), ref.sha256);
}
function putProbes(request, probes) {
  for (const probe of probes)
    write(
      join(request.rootRealPath, 'node_modules/agentfootprint', probe.relativePath),
      probe.body,
    );
}
function removeProbes(request) {
  for (const probe of request.probes)
    rmSync(join(request.rootRealPath, 'node_modules/agentfootprint', probe.relativePath), {
      force: true,
    });
}

test('four strict fresh roots, independent caches, real graph guards and exact owned probe lifetimes', async (t) => {
  const f = publishedFixture(t);
  const env = {
    NODE_OPTIONS: '--unit-no-child-execution',
    NODE_PATH: '/unit/not-used',
    AF_FIXTURE_SECRET: 'unit-only',
  };
  const old = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const key of Object.keys(env))
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
  });
  const ports = f.createPorts();
  checkRefs(f, ports.producerProofRefs);
  for (const phase of ['before-command', 'after-command']) {
    const boundary = {
      protocol: PROTOCOL,
      source: f.source,
      caseId: null,
      rootRealPath: f.sourceRoot,
      command: 'source-pack',
      phase,
      execution: phase === 'before-command' ? null : { exitCode: 0, signal: null },
      probes: [],
    };
    const receipt = await ports.verifySource(boundary);
    validateGuardReceipt(
      receipt,
      boundary,
      { manifestSha256: f.source.manifestSha256, lockSha256: f.source.lockSha256 },
      producerRefs,
    );
  }
  const requests = [];
  for (const caseId of ['source-online', 'source-offline', 'consumer-online', 'consumer-offline']) {
    const request = f.request(caseId);
    requests.push(request);
    const handle = await install(ports, request);
    validateHandle(handle, request);
    checkRefs(f, handle.receipt.proofRefs);
    assert.deepEqual(handle.receipt.proofRefs.source, ports.producerProofRefs.source);
    const metadata = readJson(join(request.rootRealPath, 'package.json'));
    assert(!Object.hasOwn(metadata, 'devDependencies'));
    assert.equal(metadata.dependencies.footprintjs, '14.3.0');
    assert.equal(metadata.dependencies.foottrace, '2.3.2');
    if (caseId.startsWith('source-'))
      assert.deepEqual(metadata.peerDependencies, f.manifest.peerDependencies);
    else assert.equal(metadata.name, 'agentfootprint-context-package-consumer');
    for (const command of caseId.startsWith('source-')
      ? ['source-cjs']
      : ['packed-cjs', 'packed-esm', 'packed-types']) {
      const probes =
        command === 'packed-types'
          ? request.probes
          : request.probes.filter((probe) => probe.phase === 'runtime-and-types');
      putProbes(request, probes);
      for (const phase of ['before-command', 'after-command']) {
        const boundary = f.boundary(request, command, phase, probes);
        const receipt = await handle.verify(boundary);
        validateGuardReceipt(receipt, boundary, handle.receipt.setup, innerRefs);
        checkRefs(f, receipt.proofRefs);
      }
    }
    removeProbes(request);
    const boundary = f.boundary(request, null, 'after-cleanup');
    validateGuardReceipt(await handle.verify(boundary), boundary, handle.receipt.setup, innerRefs);
  }
  assert.equal(new Set(requests.map((request) => request.rootRealPath)).size, 4);
  assert.notEqual(f.caches.source, f.caches.consumer);
  assert.deepEqual(
    f.calls.map((call) => [basename(call.options.cwd), call.args[0]]),
    [
      ['source-online', 'install'],
      ['source-online', 'ci'],
      ['source-offline', 'ci'],
      ['consumer-online', 'install'],
      ['consumer-online', 'ci'],
      ['consumer-offline', 'ci'],
    ],
  );
  for (const call of f.calls) {
    const family = basename(call.options.cwd).startsWith('source-') ? 'source' : 'consumer';
    const offline = call.options.cwd.endsWith('-offline');
    assert.deepEqual(call.args, [
      call.args[0],
      '--omit=dev',
      '--ignore-scripts',
      '--strict-peer-deps',
      '--no-audit',
      '--fund=false',
      '--registry=https://registry.npmjs.org',
      '--userconfig=' + join(f.evidenceRoot, 'empty-user.npmrc'),
      '--globalconfig=' + join(f.evidenceRoot, 'empty-global.npmrc'),
      '--cache=' + f.caches[family],
      ...(call.args[0] === 'install' ? ['--package-lock-only'] : []),
      ...(offline ? ['--offline'] : []),
    ]);
    assert.equal(call.hadModules, false);
    assert.equal(call.hadLock, call.args[0] === 'ci');
    for (const key of Object.keys(env)) assert(!Object.hasOwn(call.options.env, key));
    assert(
      Object.keys(call.options.env).every((key) =>
        /^(PATH|SYSTEMROOT|WINDIR|TMP|TEMP|TMPDIR)$/i.test(key),
      ),
    );
    assert.equal(call.options.timeout, 120000);
    assert.equal(call.options.maxBuffer, 16 * 1024 * 1024);
  }
  assert.equal(readFileSync(join(f.evidenceRoot, 'empty-user.npmrc'), 'utf8'), '');
  assert.equal(readFileSync(join(f.evidenceRoot, 'empty-global.npmrc'), 'utf8'), '');
  assert.equal(readFileSync(join(f.sourceRoot, 'package.json'), 'utf8'), f.originalManifestText);
  assert.equal(readFileSync(join(f.sourceRoot, 'package-lock.json'), 'utf8'), f.originalLockText);
  assert.equal(readFileSync(join(f.base, 'keep-parent.txt'), 'utf8'), 'keep parent');
  assert.equal(readFileSync(join(f.sourceRoot, 'keep-source.txt'), 'utf8'), 'keep source');
});

for (const [label, mutate] of [
  [
    'wrong selected version',
    (lock) => {
      lock.packages['node_modules/foottrace'].version = '2.0.1';
    },
  ],
  [
    'wrong integrity',
    (lock) => {
      lock.packages['node_modules/foottrace'].integrity = 'wrong';
    },
  ],
  [
    'wrong registry',
    (lock) => {
      lock.packages['node_modules/foottrace'].resolved = 'file:other.tgz';
    },
  ],
  [
    'required input development-only',
    (lock) => {
      lock.packages['node_modules/footprintjs'].dev = true;
    },
  ],
  [
    'duplicate locked copy',
    (lock) => {
      lock.packages['node_modules/nested/node_modules/foottrace'] = {
        ...lock.packages['node_modules/foottrace'],
      };
    },
  ],
  [
    'linked input',
    (lock) => {
      lock.packages['node_modules/foottrace'].link = true;
    },
  ],
  ['early installed modules', (_lock, root) => mkdirSync(join(root, 'node_modules'))],
  [
    'changed projected manifest',
    (_lock, root) => json(join(root, 'package.json'), { name: 'changed' }),
  ],
])
  test(`first normal lock refuses ${label} before ci`, async (t) => {
    const f = publishedFixture(t, { metadata: mutate }),
      ports = f.createPorts();
    await assert.rejects(ports.installSourceRoot(f.request('source-online')));
    assert.deepEqual(
      f.calls.map((call) => call.args[0]),
      ['install'],
    );
    assert(!readdirSync(f.evidenceRoot).some((name) => name.endsWith('-receipt.json')));
  });

for (const [label, hooks] of [
  [
    'zero exit without any generated lock',
    { result: () => ({ status: 0, signal: null, stdout: '', stderr: '' }) },
  ],
  ['zero exit without installed packages', { skipInstall: true }],
  ['changed setup after ci', { ci: (root) => write(join(root, 'package-lock.json'), '{}') }],
  [
    'wrong installed member',
    { ci: (root) => write(join(root, 'node_modules/foottrace/dist/index.js'), 'wrong bytes') },
  ],
  [
    'additional installed member',
    { ci: (root) => write(join(root, 'node_modules/contextfootprint/extra.js'), 'extra') },
  ],
  [
    'wrong hidden lock',
    {
      ci: (root) => {
        const lock = readJson(join(root, 'node_modules/.package-lock.json'));
        lock.packages['node_modules/foottrace'].version = '0.0.0';
        json(join(root, 'node_modules/.package-lock.json'), lock);
      },
    },
  ],
  [
    'duplicate physical Foottrace',
    {
      ci: (root, f) => {
        const nested = join(root, 'node_modules/footprintjs/node_modules/foottrace');
        json(join(nested, 'package.json'), f.payloads.foottrace.manifest);
        write(join(nested, 'dist/index.js'), inertCode);
      },
    },
  ],
  [
    'linked physical Foottrace',
    {
      ci: (root, f) => {
        rmSync(join(root, 'node_modules/foottrace'), { recursive: true });
        symlinkSync(
          join(f.sourceRoot, 'node_modules/foottrace'),
          join(root, 'node_modules/foottrace'),
          'dir',
        );
      },
    },
  ],
])
  test(`a mocked successful command cannot excuse ${label}`, async (t) => {
    const f = publishedFixture(t, hooks),
      ports = f.createPorts();
    await assert.rejects(ports.installSourceRoot(f.request('source-online')));
    assert(!readdirSync(f.evidenceRoot).some((name) => name.endsWith('-receipt.json')));
  });

for (const [label, result] of [
  ['failed status', { status: 1, signal: null, stdout: 'partial out', stderr: 'native error' }],
  [
    'cut command',
    {
      status: null,
      signal: 'SIGTERM',
      stdout: '',
      stderr: 'cut',
      error: new Error('unit timeout'),
    },
  ],
])
  test(`retains ${label} as failure, without a success receipt`, async (t) => {
    const f = publishedFixture(t, { result: () => result }),
      ports = f.createPorts();
    await assert.rejects(
      ports.installSourceRoot(f.request('source-online')),
      /strict native npm install failed/,
    );
    const file = readdirSync(f.evidenceRoot).find((name) =>
      /^source-online-install-\d+\.json$/.test(name),
    );
    const record = readJson(join(f.evidenceRoot, file));
    assert.equal(record.exitCode, result.status);
    assert.equal(record.signal, result.signal);
    assert.equal(record.stdout, result.stdout);
    assert.equal(record.stderr, result.stderr);
    assert(!readdirSync(f.evidenceRoot).some((name) => name.endsWith('-receipt.json')));
  });

test('offline refuses missing or different family cache before a command', async (t) => {
  const f = publishedFixture(t),
    ports = f.createPorts();
  await assert.rejects(
    ports.installSourceRoot(f.request('source-offline', '-first')),
    /same-family cache/,
  );
  assert.equal(f.calls.length, 0);
  await ports.installSourceRoot(f.request('source-online'));
  const other = f.request('source-offline');
  other.cache.realPath = f.caches.consumer;
  await assert.rejects(ports.installSourceRoot(other), /same-family cache/);
  assert.equal(f.calls.length, 2);
});

for (const [label, change] of [
  ['source tracked bytes', (f) => write(join(f.sourceRoot, 'keep-source.txt'), 'changed')],
  ['source manifest', (f) => write(join(f.sourceRoot, 'package.json'), '{}')],
  [
    'source compiler',
    (f) => write(join(f.sourceRoot, 'node_modules/typescript/lib/tsc.js'), 'changed'),
  ],
  ['source built output', (f) => write(join(f.sourceRoot, 'dist/index.js'), 'changed')],
  [
    'source dependency member',
    (f) => write(join(f.sourceRoot, 'node_modules/foottrace/dist/index.js'), 'changed'),
  ],
  ['installed setup', (_f, r) => write(join(r.rootRealPath, 'package.json'), '{}')],
  [
    'installed member',
    (_f, r) => write(join(r.rootRealPath, 'node_modules/foottrace/dist/index.js'), 'changed'),
  ],
])
  test(`guard rechecks ${label} after successful inert installation`, async (t) => {
    const f = publishedFixture(t),
      ports = f.createPorts(),
      request = f.request('source-online');
    const handle = await ports.installSourceRoot(request);
    change(f, request);
    await assert.rejects(handle.verify(f.boundary(request, 'source-cjs', 'before-command')));
  });

test('consumer guards permit only the exact declared probes, including the final clean graph', async (t) => {
  const f = publishedFixture(t),
    ports = f.createPorts(),
    request = f.request('consumer-online');
  const handle = await ports.installPackedConsumer(request);
  const runtime = request.probes.slice(0, 2);
  putProbes(request, runtime);
  const boundary = f.boundary(request, 'packed-cjs', 'before-command', runtime);
  await handle.verify(boundary);
  const first = join(request.rootRealPath, 'node_modules/agentfootprint', runtime[0].relativePath);
  write(first, 'wrong probe');
  await assert.rejects(handle.verify(boundary));
  putProbes(request, runtime);
  const extra = join(request.rootRealPath, 'node_modules/agentfootprint/.context-unowned.cjs');
  write(extra, 'unowned');
  await assert.rejects(handle.verify(boundary));
  rmSync(extra);
  await assert.rejects(handle.verify(f.boundary(request, 'packed-cjs', 'before-command', [])));
  await assert.rejects(handle.verify(f.boundary(request, null, 'after-cleanup')));
  removeProbes(request);
  await handle.verify(f.boundary(request, null, 'after-cleanup'));
  write(f.artifact.path, 'changed archive');
  await assert.rejects(handle.verify(f.boundary(request, null, 'after-cleanup')));
});

test('wrong consumer archive bytes refuse before any install command', async (t) => {
  const f = publishedFixture(t),
    ports = f.createPorts(),
    request = f.request('consumer-online');
  write(f.artifact.path, 'wrong archive');
  await assert.rejects(ports.installPackedConsumer(request));
  assert.equal(f.calls.length, 0);
});

test('archive admission fetch is mocked, but actual SHA512, parser and preserved bytes are checked', async (t) => {
  const f = publishedFixture(t),
    directory = join(f.base, 'admitted');
  mkdirSync(directory);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    const name = Object.keys(f.inputs.selected).find(
      (key) => f.inputs.selected[key].resolved === url,
    );
    assert(name, 'no unselected URL');
    return new Response(f.payloads[name].bytes, { status: 200 });
  });
  const admitted = await admitPublishedInputs(f.inputs, directory);
  assert.deepEqual(admitted, f.archives);
  for (const [name, payload] of Object.entries(f.payloads))
    assert.deepEqual(readFileSync(join(directory, name + '.tgz')), payload.bytes);
  assert.equal(requests.length, 3);
  for (const request of requests) {
    assert.equal(request.options.redirect, 'error');
    assert(request.options.signal instanceof AbortSignal);
  }
  assert.equal(f.calls.length, 0);
});

for (const [label, response] of [
  ['HTTP refusal', () => new Response('refused', { status: 403 })],
  ['wrong archive bytes', () => new Response(Buffer.from('wrong'), { status: 200 })],
  [
    'declared archive beyond bound',
    () =>
      new Response('small', {
        status: 200,
        headers: { 'content-length': String(32 * 1024 * 1024 + 1) },
      }),
  ],
])
  test(`mocked fetch ${label} produces no admission receipt`, async (t) => {
    const f = publishedFixture(t),
      directory = join(f.base, 'refused');
    mkdirSync(directory);
    t.mock.method(globalThis, 'fetch', response);
    await assert.rejects(admitPublishedInputs(f.inputs, directory));
    assert.deepEqual(readdirSync(directory), []);
    assert.equal(f.calls.length, 0);
  });
