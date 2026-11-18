import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { PROTOCOL } from './protocol.mjs';

const digest = 'a'.repeat(64);
const root = resolve('protocol-fixtures');
const refKeys = ['source', 'install', 'inputs', 'graph'];
const producerKeys = [...refKeys, 'build'];
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const source = () => ({
  head: 'b'.repeat(40),
  tree: 'c'.repeat(40),
  manifestSha256: digest,
  lockSha256: 'd'.repeat(64),
});
const refs = (keys = refKeys) => Object.fromEntries(keys.map((id) => [id, { id, sha256: digest }]));
const setup = () => ({ manifestSha256: digest, lockSha256: 'e'.repeat(64) });
function probes() {
  return [
    ['runtime-cjs', '.context-smoke.cjs', 'runtime-and-types'],
    ['runtime-esm', '.context-smoke.mjs', 'runtime-and-types'],
    ['types-mts', '.context-types.mts', 'types-only'],
    ['types-cts', '.context-types.cts', 'types-only'],
  ].map(([id, relativePath, phase]) => {
    const body = `// synthetic validation fixture: ${id} \u00e9\n`;
    return { id, relativePath, body, sha256: sha256(body), size: Buffer.byteLength(body), phase };
  });
}
function input() {
  return {
    sourceRoot: resolve(root, 'source'),
    ownedWorkRoot: resolve(root, 'work'),
    source: source(),
    producerProofRefs: refs(producerKeys),
    installSourceRoot: async () => {},
    installPackedConsumer: async () => {},
    verifySource: async () => {},
  };
}
function request(caseId = 'source-online') {
  const consumer = caseId.startsWith('consumer-');
  return {
    protocol: PROTOCOL,
    source: source(),
    caseId,
    rootRealPath: resolve(root, caseId),
    originalManifestText: '{}',
    originalLockText: '{}',
    policy: {
      omitDev: true,
      scripts: false,
      peers: 'strict',
      offline: caseId.endsWith('-offline'),
    },
    cache: {
      family: consumer ? 'consumer' : 'source',
      realPath: resolve(root, `${consumer ? 'consumer' : 'source'}-cache`),
    },
    contextArtifact: consumer
      ? { path: resolve(root, 'context.tgz'), sha256: digest, sourceVersion: '14.7.2' }
      : null,
    probes: consumer ? probes() : [],
  };
}
function handle(req = request()) {
  const { originalManifestText, originalLockText, probes: ignored, ...echo } = req;
  void [originalManifestText, originalLockText, ignored];
  return {
    receipt: { ...structuredClone(echo), setup: setup(), installExitCode: 0, proofRefs: refs() },
    verify: async () => {},
  };
}
function boundary(command = 'packed-cjs', caseId = 'consumer-online', phase = 'before-command') {
  return {
    protocol: PROTOCOL,
    source: source(),
    caseId,
    rootRealPath: resolve(root, caseId ?? 'producer'),
    command,
    phase,
    execution: phase === 'after-command' ? { exitCode: 0, signal: null } : null,
    probes:
      phase === 'after-cleanup' || command.startsWith('source-')
        ? []
        : command === 'packed-types'
        ? probes()
        : probes().slice(0, 2),
  };
}
const guard = (b) => ({
  boundary: structuredClone(b),
  setup: setup(),
  proofRefs: refs(b.caseId === null ? producerKeys : refKeys),
});
const refuses = (fn) => assert.throws(fn, TypeError);

export {
  digest,
  root,
  refKeys,
  producerKeys,
  sha256,
  source,
  refs,
  setup,
  probes,
  input,
  request,
  handle,
  boundary,
  guard,
  refuses,
};
