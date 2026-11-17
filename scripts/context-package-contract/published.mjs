/** Code-owned strict installers for the fixed published cohort; never a plan interpreter. */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, realpathSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PROTOCOL } from './protocol.mjs';
import { digest, inspectPublishedGraph, inventory, readRegular, assertLockedInputs } from './publishedGraph.mjs';
import { sourceProductionManifest, consumerProductionManifest } from './publishedSetup.mjs';
const require = createRequire(import.meta.url);
const { inspectFile } = require('../publish-archive/verify.cjs');

export function createPublishedContextPorts({ sourceRoot, source, inputs, archives, evidenceRoot }) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const git = (...args) => execFileSync('git', args, { cwd: sourceRoot, encoding: 'utf8' }).trim();
  const testedHead = git('rev-parse', 'HEAD');
  const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|SYSTEMROOT|WINDIR|TMP|TEMP|TMPDIR)$/i.test(key)));
  const config = join(evidenceRoot, 'empty-user.npmrc');
  const globalConfig = join(evidenceRoot, 'empty-global.npmrc');
  writeFileSync(config, '', { flag: 'wx' });
  writeFileSync(globalConfig, '', { flag: 'wx' });
  let serial = 0;
  const families = new Map();
  const persist = (id, value) => {
    const text = JSON.stringify(value, null, 2) + '\n';
    writeFileSync(join(evidenceRoot, id + '.json'), text, { flag: 'wx' });
    return { id, sha256: digest(text) };
  };
  const setup = (root) => ({ manifestSha256: digest(readRegular(join(root, 'package.json'))), lockSha256: digest(readRegular(join(root, 'package-lock.json'))) });
  function assertSource() {
    assert.equal(git('rev-parse', 'HEAD'), testedHead);
    assert.equal(git('rev-parse', 'HEAD^{tree}'), source.tree);
    assert.equal(git('rev-parse', source.head + '^{tree}'), source.tree);
    git('diff', '--cached', '--quiet', 'HEAD', '--');
    git('diff', '--quiet', 'HEAD', '--');
    assert.deepEqual(setup(sourceRoot), { manifestSha256: source.manifestSha256, lockSha256: source.lockSha256 });
  }
  assertSource();
  function compilerInput() {
    const key = 'node_modules/typescript';
    const original = JSON.parse(readRegular(join(sourceRoot, 'package-lock.json'))).packages[key];
    const installed = JSON.parse(readRegular(join(sourceRoot, 'node_modules/.package-lock.json'))).packages[key];
    assert(original && installed, 'producer compiler requires its original toolchain lock');
    for (const field of ['version', 'resolved', 'integrity']) {
      assert.equal(typeof original[field], 'string', 'missing compiler input');
      assert.equal(installed[field], original[field], 'producer compiler input changed');
    }
    const root = join(sourceRoot, key);
    assert.equal(realpathSync(root), root, 'producer compiler must not be an alias');
    const manifest = readRegular(join(root, 'package.json'));
    const metadata = JSON.parse(manifest);
    assert.equal(metadata.name, 'typescript');
    assert.equal(metadata.version, original.version);
    return { originalLockSha256: source.lockSha256, version: original.version, resolved: original.resolved, integrity: original.integrity, manifestSha256: digest(manifest), entrySha256: digest(readRegular(join(root, 'bin/tsc'))) };
  }
  const producerGraph = inspectPublishedGraph(sourceRoot, inputs, archives);
  const buildIdentity = () => ({ dist: inventory(join(sourceRoot, 'dist')), compiler: inventory(join(sourceRoot, 'node_modules/typescript')), compilerInput: compilerInput() });
  const producerBuild = buildIdentity();
  const producerProofRefs = {
    source: persist('source', { source, testedHead, policy: inputs.policy }),
    install: persist('producer-install', { kind: 'observed-locked-producer-image-after-native-build', source, installedLockSha256: digest(readRegular(join(sourceRoot, 'node_modules/.package-lock.json'))), graph: producerGraph }),
    inputs: persist('producer-inputs', { source, selected: inputs.selected, archives }),
    graph: persist('producer-graph', producerGraph),
    build: persist('producer-build', { source, ...producerBuild, node: process.version }),
  };
  function unchangedProducer() {
    assertSource();
    assert.deepEqual(inspectPublishedGraph(sourceRoot, inputs, archives), producerGraph);
    assert.deepEqual(buildIdentity(), producerBuild, 'producer build/compiler changed');
  }
  async function verifySource(boundary) {
    unchangedProducer();
    assert.equal(boundary.rootRealPath, sourceRoot);
    assert.equal(boundary.caseId, null);
    assert.equal(boundary.command, 'source-pack');
    assert.deepEqual(boundary.source, source);
    assert.deepEqual(boundary.probes, []);
    persist('producer-boundary-' + ++serial, { boundary, checkedSource: source, producerProofRefs });
    return { boundary, setup: setup(sourceRoot), proofRefs: producerProofRefs };
  }
  function npmRun(request, command) {
    const args = [command, '--omit=dev', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--fund=false', '--registry=https://registry.npmjs.org', '--userconfig=' + config, '--globalconfig=' + globalConfig, '--cache=' + request.cache.realPath, ...(command === 'install' ? ['--package-lock-only'] : []), ...(request.policy.offline ? ['--offline'] : [])];
    const result = spawnSync(npm, args, { cwd: request.rootRealPath, env: environment, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
    const record = { command: npm, argv: args, cwd: request.rootRealPath, exitCode: result.status, signal: result.signal, error: result.error ? String(result.error.message) : null, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
    const ref = persist(request.caseId + '-' + command + '-' + ++serial, record);
    assert(!result.error && result.status === 0 && result.signal === null, 'strict native npm ' + command + ' failed; retained ' + ref.id);
    return ref;
  }
  async function install(request, consumer) {
    unchangedProducer();
    assert.deepEqual(request.source, source);
    assert.equal(request.policy.scripts, false);
    assert.equal(request.policy.omitDev, true);
    assert.equal(request.policy.peers, 'strict');
    const root = realpathSync(request.rootRealPath);
    assert.equal(root, request.rootRealPath);
    assert.deepEqual(readdirSync(root), []);
    let agent = null;
    if (consumer) {
      assert.equal(digest(readRegular(request.contextArtifact.path, 32 * 1024 * 1024)), request.contextArtifact.sha256);
      agent = inspectFile(request.contextArtifact.path, inputs.manifest, inputs.source.version).report;
      for (const member of agent.files) {
        const bytes = readRegular(join(sourceRoot, member.path.slice('package/'.length)), 32 * 1024 * 1024);
        assert(bytes.length === member.size && digest(bytes) === member.sha256, 'packed source member changed');
      }
    }
    const family = request.cache.family;
    let held;
    if (request.policy.offline) {
      held = families.get(family);
      assert(held && held.cache === request.cache.realPath, 'offline requires the admitted same-family cache');
    } else {
      assert(!families.has(family));
      assert.deepEqual(readdirSync(request.cache.realPath), []);
      const manifest = consumer ? consumerProductionManifest(inputs, request.contextArtifact) : sourceProductionManifest(inputs);
      writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
      npmRun(request, 'install');
      assert.deepEqual(JSON.parse(readRegular(join(root, 'package.json'))), manifest, 'metadata resolution changed the projected manifest');
      held = { manifest: readRegular(join(root, 'package.json')).toString(), lock: readRegular(join(root, 'package-lock.json')).toString(), cache: request.cache.realPath };
      families.set(family, held);
    }
    if (request.policy.offline) {
      writeFileSync(join(root, 'package.json'), held.manifest, { flag: 'wx' });
      writeFileSync(join(root, 'package-lock.json'), held.lock, { flag: 'wx' });
    }
    assert(!existsSync(join(root, 'node_modules')), 'first lock must precede any installed packages');
    assertLockedInputs(JSON.parse(readRegular(join(root, 'package-lock.json'))), inputs, agent, true);
    const identity = setup(root);
    const inputRef = persist(request.caseId + '-inputs', { original: source, projection: inputs.policy, manifest: held.manifest, lock: held.lock, setup: identity, contextArtifact: request.contextArtifact, cache: request.cache, archives: Object.fromEntries(Object.entries(archives).map(([name, row]) => [name, { sha256: row.sha256, integrity: row.integrity }])) });
    const installRef = npmRun(request, 'ci');
    assert.deepEqual(setup(root), identity, 'first strict installation changed its setup');
    const graph = inspectPublishedGraph(root, inputs, archives, agent);
    const proofRefs = { source: producerProofRefs.source, install: installRef, inputs: inputRef, graph: persist(request.caseId + '-graph', graph) };
    const receipt = { protocol: PROTOCOL, source, caseId: request.caseId, rootRealPath: root, setup: identity, policy: request.policy, cache: request.cache, installExitCode: 0, contextArtifact: request.contextArtifact, proofRefs };
    persist(request.caseId + '-receipt', receipt);
    return {
      receipt,
      async verify(boundary) {
        unchangedProducer();
        assert.equal(boundary.rootRealPath, root);
        assert.equal(boundary.caseId, request.caseId);
        assert.deepEqual(boundary.source, source);
        assert.deepEqual(setup(root), identity);
        const expected = boundary.phase === 'after-cleanup' ? [] : request.probes.filter((probe) => boundary.command === 'packed-types' || probe.phase === 'runtime-and-types');
        assert.deepEqual(boundary.probes, expected);
        if (consumer) assert.equal(digest(readRegular(request.contextArtifact.path, 32 * 1024 * 1024)), request.contextArtifact.sha256);
        assert.deepEqual(inspectPublishedGraph(root, inputs, archives, agent, boundary.probes), graph);
        persist(request.caseId + '-boundary-' + ++serial, { boundary, checkedGraph: proofRefs.graph, checkedProducer: producerProofRefs });
        return { boundary, setup: identity, proofRefs };
      },
    };
  }
  return { producerProofRefs, verifySource, installSourceRoot: (request) => install(request, false), installPackedConsumer: (request) => install(request, true) };
}
