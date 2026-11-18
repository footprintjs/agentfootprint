/** Inert filesystem/archive fixtures. Only Git runs; npm, package code and compilers never run. */
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { archiveBytes } from '../publish-archive/archive-fixture.mjs';
import { getPublishedInputs } from './publishedSetup.mjs';
import { createPublishedContextPorts } from './published.mjs';
import { PROTOCOL } from './protocol.mjs';
import { renderContextProbes } from './probes.mjs';

const require = createRequire(import.meta.url);
const { inspectPublishedDependency } = require('../publish-archive/publishedDependency.cjs');
const { inspectFile } = require('../publish-archive/verify.cjs');
export const hash = (bytes, algorithm = 'sha256', encoding = 'hex') =>
  createHash(algorithm).update(bytes).digest(encoding);
export const write = (file, bytes) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
};
export const json = (file, value) => write(file, JSON.stringify(value));
export const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
export const inertCode = 'exports.fixture = true;\n';

export function publishedFixture(t, hooks = {}) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'af-published-ports-unit-')));
  const sourceRoot = join(base, 'source'),
    evidenceRoot = join(base, 'evidence');
  mkdirSync(sourceRoot);
  mkdirSync(evidenceRoot);
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    rmSync(base, { recursive: true, force: true });
  });
  write(join(base, 'keep-parent.txt'), 'keep parent');
  write(join(sourceRoot, 'keep-source.txt'), 'keep source');
  const versions = { footprintjs: '14.0.0-rc.0', foottrace: '2.1.0', contextfootprint: '0.1.1' };
  const archives = {},
    payloads = {},
    selected = {};
  for (const [name, version] of Object.entries(versions)) {
    const manifest = {
      name,
      version,
      main: 'dist/index.js',
      ...(name === 'footprintjs' ? { peerDependencies: { foottrace: '^2.1.0' } } : {}),
    };
    const bytes = archiveBytes(manifest);
    const integrity = 'sha512-' + hash(bytes, 'sha512', 'base64');
    archives[name] = inspectPublishedDependency(bytes, { name, version, integrity });
    payloads[name] = { manifest, bytes };
    selected['node_modules/' + name] = {
      version,
      resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`,
      integrity,
      ...(name === 'footprintjs' ? { dev: true, peerDependencies: { foottrace: '^2.1.0' } } : {}),
    };
  }
  const agentFiles = {};
  const exports = {};
  for (const [door, stem] of [
    ['.', 'index'],
    ['./providers', 'providers'],
    ['./observe', 'observe'],
  ]) {
    exports[door] = {
      import: { types: `./dist/esm/${stem}.d.ts`, default: `./dist/esm/${stem}.js` },
      require: { types: `./dist/types/${stem}.d.ts`, default: `./dist/${stem}.js` },
    };
    agentFiles[`dist/${stem}.js`] = inertCode;
    agentFiles[`dist/esm/${stem}.js`] = 'export const fixture = true;\n';
    agentFiles[`dist/esm/${stem}.d.ts`] = 'export declare const fixture: true;\n';
    agentFiles[`dist/types/${stem}.d.ts`] = 'export declare const fixture: true;\n';
  }
  agentFiles['dist/esm/package.json'] = '{"type":"module"}';
  const manifest = {
    name: 'agentfootprint',
    version: '15.0.0-rc.0',
    main: 'dist/index.js',
    type: 'commonjs',
    exports,
    dependencies: { foottrace: '^2.1.0', contextfootprint: '0.1.1' },
    peerDependencies: { footprintjs: '^14.0.0-rc.0' },
    devDependencies: { footprintjs: '^14.0.0-rc.0', typescript: '~5.4.5' },
  };
  const compilerRecord = { version: '5.4.5', resolved: 'https://registry.npmjs.org/typescript/-/typescript-5.4.5.tgz', integrity: 'sha512-' + Buffer.alloc(64, 4).toString('base64'), dev: true };
  const lock = {
    name: manifest.name,
    version: manifest.version,
    lockfileVersion: 3,
    packages: { '': structuredClone(manifest), ...selected, 'node_modules/typescript': compilerRecord },
  };
  const originalManifestText = JSON.stringify(manifest),
    originalLockText = JSON.stringify(lock);
  write(join(sourceRoot, 'package.json'), originalManifestText);
  write(join(sourceRoot, 'package-lock.json'), originalLockText);
  for (const [path, bytes] of Object.entries(agentFiles)) write(join(sourceRoot, path), bytes);
  const inputs = getPublishedInputs(originalManifestText, originalLockText);
  const materialize = (root, includeAgent = false) => {
    for (const [name, payload] of Object.entries(payloads)) {
      json(join(root, 'node_modules', name, 'package.json'), payload.manifest);
      write(join(root, 'node_modules', name, 'dist/index.js'), inertCode);
    }
    if (includeAgent) {
      write(join(root, 'node_modules/agentfootprint/package.json'), originalManifestText);
      for (const [path, bytes] of Object.entries(agentFiles))
        write(join(root, 'node_modules/agentfootprint', path), bytes);
    }
  };
  materialize(sourceRoot);
  json(join(sourceRoot, 'node_modules/.package-lock.json'), {
    lockfileVersion: 3,
    packages: { ...selected, 'node_modules/typescript': compilerRecord },
  });
  json(join(sourceRoot, 'node_modules/typescript/package.json'), {
    name: 'typescript',
    version: '5.4.5',
  });
  write(
    join(sourceRoot, 'node_modules/typescript/lib/tsc.js'),
    '// inert compiler fixture; never executed\n',
  );
  write(join(sourceRoot, 'node_modules/typescript/bin/tsc'), '// inert compiler entry; never executed\n');
  const git = (...args) =>
    childProcess.execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
  git('init', '-q');
  git('add', 'package.json', 'package-lock.json', 'keep-source.txt');
  git(
    '-c',
    'user.name=fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'inert port fixture',
  );
  const source = {
    head: git('rev-parse', 'HEAD'),
    tree: git('rev-parse', 'HEAD^{tree}'),
    manifestSha256: hash(originalManifestText),
    lockSha256: hash(originalLockText),
  };
  const bytes = archiveBytes(manifest, {
    extra: Object.entries(agentFiles)
      .filter(([path]) => path !== 'dist/index.js')
      .map(([path, value]) => ['package/' + path, value]),
  });
  const artifact = {
    path: join(base, 'agent.tgz'),
    sha256: hash(bytes),
    sourceVersion: manifest.version,
  };
  write(artifact.path, bytes);
  const agent = inspectFile(artifact.path, manifest, manifest.version).report;
  const caches = { source: join(base, 'source-cache'), consumer: join(base, 'consumer-cache') };
  Object.values(caches).forEach((path) => mkdirSync(path));
  const calls = [],
    events = [];
  const f = {
    base,
    sourceRoot,
    evidenceRoot,
    source,
    inputs,
    archives,
    payloads,
    manifest,
    lock,
    artifact,
    agent,
    caches,
    calls,
    events,
    git,
    originalManifestText,
    originalLockText,
    materialize,
  };
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    assert.equal(
      command,
      process.platform === 'win32' ? 'npm.cmd' : 'npm',
      'no other subprocess may execute',
    );
    assert(options.cwd.startsWith(base + sep), 'no external root');
    const root = options.cwd;
    const cache = args.find((arg) => arg.startsWith('--cache=')).slice('--cache='.length);
    const call = {
      command,
      args: [...args],
      options: { ...options, env: { ...options.env } },
      hadModules: existsSync(join(root, 'node_modules')),
      hadLock: existsSync(join(root, 'package-lock.json')),
    };
    calls.push(call);
    if (hooks.result) {
      const result = hooks.result(call, f);
      if (result) return result;
    }
    const metadata = readJson(join(root, 'package.json'));
    if (args[0] === 'install') {
      assert(!call.hadModules && !call.hadLock, 'metadata is the first operation in the root');
      const packages = Object.fromEntries(
        Object.entries(selected).map(([key, row]) => {
          const { dev: _dev, ...production } = row;
          return [key, production];
        }),
      );
      if (metadata.dependencies.agentfootprint)
        packages['node_modules/agentfootprint'] = {
          version: manifest.version,
          integrity: agent.integrity,
          resolved: artifact.path,
        };
      const temporary = {
        name: metadata.name,
        version: metadata.version,
        lockfileVersion: 3,
        packages: { '': metadata, ...packages },
      };
      hooks.metadata?.(temporary, root, f);
      json(join(root, 'package-lock.json'), temporary);
      write(join(cache, 'inert-fixture-cache'), 'unit cache only');
      events.push({ kind: 'first-lock', root, offline: args.includes('--offline') });
    } else {
      assert.equal(args[0], 'ci');
      assert(call.hadLock && !call.hadModules, 'ci follows the first lock');
      if (args.includes('--offline'))
        assert(existsSync(join(cache, 'inert-fixture-cache')), 'offline fixture needs same cache');
      if (!hooks.skipInstall) {
        materialize(root, !!metadata.dependencies.agentfootprint);
        const temporary = readJson(join(root, 'package-lock.json'));
        const { '': _root, ...packages } = temporary.packages;
        json(join(root, 'node_modules/.package-lock.json'), { lockfileVersion: 3, packages });
      }
      hooks.ci?.(root, f);
      events.push({ kind: 'ci', root, offline: args.includes('--offline') });
    }
    return { status: 0, signal: null, stdout: 'inert unit npm response', stderr: '' };
  });
  syncBuiltinESMExports();
  f.createPorts = () =>
    createPublishedContextPorts({ sourceRoot, source, inputs, archives, evidenceRoot });
  f.request = (caseId, suffix = '') => {
    const rootRealPath = join(base, caseId + suffix);
    mkdirSync(rootRealPath);
    const family = caseId.startsWith('source-') ? 'source' : 'consumer';
    return {
      protocol: PROTOCOL,
      source,
      caseId,
      rootRealPath,
      originalManifestText,
      originalLockText,
      policy: {
        omitDev: true,
        scripts: false,
        peers: 'strict',
        offline: caseId.endsWith('-offline'),
      },
      cache: { family, realPath: caches[family] },
      contextArtifact: family === 'source' ? null : artifact,
      probes: family === 'source' ? [] : renderContextProbes(rootRealPath),
    };
  };
  f.boundary = (request, command, phase, probes = []) => ({
    protocol: PROTOCOL,
    source,
    caseId: request.caseId,
    rootRealPath: request.rootRealPath,
    command,
    phase,
    execution: phase === 'after-command' ? { exitCode: 0, signal: null } : null,
    probes,
  });
  return f;
}
