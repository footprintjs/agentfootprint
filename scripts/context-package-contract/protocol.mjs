/** Pure validation of the fixed internal paired-contract protocol; no IO or callbacks. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual, types } from 'node:util';

export const PROTOCOL = 'agentfootprint.context-package-contract.v1';
export const CASES = Object.freeze([
  'source-online',
  'source-offline',
  'consumer-online',
  'consumer-offline',
]);
export const COMMANDS = Object.freeze([
  'source-cjs',
  'source-pack',
  'packed-cjs',
  'packed-esm',
  'packed-types',
]);
const SOURCE_KEYS = ['head', 'tree', 'manifestSha256', 'lockSha256'];
const SETUP_KEYS = ['manifestSha256', 'lockSha256'];
const REF_KEYS = ['source', 'install', 'inputs', 'graph'];
const PRODUCER_KEYS = [...REF_KEYS, 'build'];
const PROBES = Object.freeze([
  Object.freeze(['runtime-cjs', '.context-smoke.cjs', 'runtime-and-types']),
  Object.freeze(['runtime-esm', '.context-smoke.mjs', 'runtime-and-types']),
  Object.freeze(['types-mts', '.context-types.mts', 'types-only']),
  Object.freeze(['types-cts', '.context-types.cts', 'types-only']),
]);
const fail = (label) => {
  throw new TypeError(`context-package: invalid ${label}`);
};
const requireThat = (condition, label) => {
  if (!condition) fail(label);
};

/** Refuse accessors/proxies before reading values; frozen ordinary records are valid. */
export function assertRecord(value, exactKeys, label) {
  requireThat(typeof value === 'object' && value !== null && !types.isProxy(value), label);
  requireThat(Object.getPrototypeOf(value) === Object.prototype, label);
  const keys = Reflect.ownKeys(value);
  requireThat(
    keys.length === exactKeys.length &&
      keys.every((key) => typeof key === 'string' && exactKeys.includes(key)),
    label,
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(
    keys.every((key) => Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable),
    label,
  );
  return value;
}

function text(value, max, label, pattern) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= max, label);
  if (pattern) requireThat(pattern.test(value), label);
}
const digest = (value, label) => text(value, 64, label, /^[a-f0-9]{64}$/);
const pathText = (value, label) => text(value, 4096, label);
const equal = (actual, expected, label) => requireThat(isDeepStrictEqual(actual, expected), label);
const callable = (value, label) =>
  requireThat(typeof value === 'function' && !types.isProxy(value), label);

function plainArray(value, size, label) {
  requireThat(typeof value === 'object' && value !== null && !types.isProxy(value), label);
  requireThat(Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype, label);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireThat(descriptors.length.value === size, label);
  const keys = Reflect.ownKeys(value);
  requireThat(
    keys.length === size + 1 &&
      keys.every(
        (key) =>
          key === 'length' ||
          (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < size),
      ),
    label,
  );
  for (let i = 0; i < size; i++) {
    const descriptor = descriptors[String(i)];
    requireThat(
      descriptor !== undefined && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
      label,
    );
  }
}

export function validateSource(source) {
  assertRecord(source, SOURCE_KEYS, 'source');
  text(source.head, 40, 'source head', /^[a-f0-9]{40}$/);
  text(source.tree, 40, 'source tree', /^[a-f0-9]{40}$/);
  digest(source.manifestSha256, 'source manifest digest');
  digest(source.lockSha256, 'source lock digest');
  return source;
}

function validateSetup(setup) {
  assertRecord(setup, SETUP_KEYS, 'setup');
  digest(setup.manifestSha256, 'setup manifest digest');
  digest(setup.lockSha256, 'setup lock digest');
}

export function validateProofRefs(refs, keys) {
  assertRecord(refs, keys, 'proof references');
  for (const key of keys) {
    const ref = refs[key];
    assertRecord(ref, ['id', 'sha256'], 'proof reference');
    text(ref.id, 128, 'proof reference id', /^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
    digest(ref.sha256, 'proof reference digest');
  }
  return refs;
}

export function validatePairedInput(input) {
  assertRecord(
    input,
    [
      'sourceRoot',
      'ownedWorkRoot',
      'source',
      'producerProofRefs',
      'installSourceRoot',
      'installPackedConsumer',
      'verifySource',
    ],
    'paired input',
  );
  pathText(input.sourceRoot, 'source root');
  pathText(input.ownedWorkRoot, 'owned work root');
  validateSource(input.source);
  validateProofRefs(input.producerProofRefs, PRODUCER_KEYS);
  for (const key of ['installSourceRoot', 'installPackedConsumer', 'verifySource'])
    callable(input[key], key);
  return input;
}

function validateCase(caseId) {
  requireThat(CASES.includes(caseId), 'case');
}

function validatePolicy(policy, caseId) {
  assertRecord(policy, ['omitDev', 'scripts', 'peers', 'offline'], 'install policy');
  requireThat(
    policy.omitDev === true && policy.scripts === false && policy.peers === 'strict',
    'install policy',
  );
  requireThat(policy.offline === caseId.endsWith('-offline'), 'offline policy');
}

function validateCache(cache, caseId) {
  assertRecord(cache, ['family', 'realPath'], 'cache');
  requireThat(
    cache.family === (caseId.startsWith('source-') ? 'source' : 'consumer'),
    'cache family',
  );
  pathText(cache.realPath, 'cache root');
}

function validateArtifact(artifact, caseId) {
  if (caseId.startsWith('source-')) {
    requireThat(artifact === null, 'source artifact');
    return;
  }
  assertRecord(artifact, ['path', 'sha256', 'sourceVersion'], 'context artifact');
  pathText(artifact.path, 'context artifact path');
  digest(artifact.sha256, 'context artifact digest');
  text(artifact.sourceVersion, 128, 'context artifact source version');
}

function validateProbes(probes, count) {
  plainArray(probes, count, 'probe list');
  for (let i = 0; i < count; i++) {
    const probe = probes[i];
    assertRecord(probe, ['id', 'relativePath', 'body', 'sha256', 'size', 'phase'], 'probe');
    const [id, relativePath, phase] = PROBES[i];
    requireThat(
      probe.id === id && probe.relativePath === relativePath && probe.phase === phase,
      'probe identity/lifetime',
    );
    text(probe.body, 65536, 'probe body');
    const bytes = Buffer.byteLength(probe.body, 'utf8');
    requireThat(
      bytes <= 65536 && Number.isInteger(probe.size) && probe.size === bytes,
      'probe size',
    );
    digest(probe.sha256, 'probe digest');
    requireThat(
      createHash('sha256').update(probe.body, 'utf8').digest('hex') === probe.sha256,
      'probe body digest',
    );
  }
}

function validateInstallIdentity(value) {
  requireThat(value.protocol === PROTOCOL, 'protocol');
  validateSource(value.source);
  validateCase(value.caseId);
  pathText(value.rootRealPath, 'install root');
  validatePolicy(value.policy, value.caseId);
  validateCache(value.cache, value.caseId);
  validateArtifact(value.contextArtifact, value.caseId);
}

export function validateHandle(handle, request) {
  assertRecord(
    request,
    [
      'protocol',
      'source',
      'caseId',
      'rootRealPath',
      'originalManifestText',
      'originalLockText',
      'policy',
      'cache',
      'contextArtifact',
      'probes',
    ],
    'install request',
  );
  validateInstallIdentity(request);
  requireThat(
    typeof request.originalManifestText === 'string' &&
      typeof request.originalLockText === 'string',
    'original source texts',
  );
  validateProbes(request.probes, request.caseId.startsWith('consumer-') ? 4 : 0);
  assertRecord(handle, ['receipt', 'verify'], 'install handle');
  callable(handle.verify, 'install guard');
  const receipt = handle.receipt;
  assertRecord(
    receipt,
    [
      'protocol',
      'source',
      'caseId',
      'rootRealPath',
      'setup',
      'policy',
      'cache',
      'installExitCode',
      'contextArtifact',
      'proofRefs',
    ],
    'install receipt',
  );
  validateInstallIdentity(receipt);
  validateSetup(receipt.setup);
  requireThat(receipt.installExitCode === 0, 'install exit');
  validateProofRefs(receipt.proofRefs, REF_KEYS);
  for (const key of [
    'protocol',
    'source',
    'caseId',
    'rootRealPath',
    'policy',
    'cache',
    'contextArtifact',
  ])
    equal(receipt[key], request[key], 'install receipt binding');
  return handle;
}

function validateExecution(execution) {
  assertRecord(execution, ['exitCode', 'signal'], 'command execution');
  requireThat(
    execution.exitCode === null ||
      (Number.isInteger(execution.exitCode) &&
        execution.exitCode >= 0 &&
        execution.exitCode <= 4294967295),
    'command exit',
  );
  if (execution.signal !== null) text(execution.signal, 32, 'command signal', /^[A-Z0-9]+$/);
}

function validateBoundary(boundary) {
  assertRecord(
    boundary,
    ['protocol', 'source', 'caseId', 'rootRealPath', 'command', 'phase', 'execution', 'probes'],
    'guard boundary',
  );
  requireThat(boundary.protocol === PROTOCOL, 'boundary protocol');
  validateSource(boundary.source);
  pathText(boundary.rootRealPath, 'boundary root');
  requireThat(
    ['before-command', 'after-command', 'after-cleanup'].includes(boundary.phase),
    'boundary phase',
  );
  if (boundary.phase === 'after-cleanup') {
    validateCase(boundary.caseId);
    requireThat(boundary.command === null && boundary.execution === null, 'cleanup boundary');
    validateProbes(boundary.probes, 0);
    return;
  }
  requireThat(COMMANDS.includes(boundary.command), 'boundary command');
  if (boundary.command === 'source-pack') {
    requireThat(boundary.caseId === null, 'producer boundary');
  } else {
    validateCase(boundary.caseId);
    requireThat(
      boundary.caseId.startsWith(boundary.command === 'source-cjs' ? 'source-' : 'consumer-'),
      'command case',
    );
  }
  if (boundary.phase === 'before-command')
    requireThat(boundary.execution === null, 'before-command execution');
  else validateExecution(boundary.execution);
  validateProbes(
    boundary.probes,
    boundary.command.startsWith('source-') ? 0 : boundary.command === 'packed-types' ? 4 : 2,
  );
}

export function validateGuardReceipt(receipt, boundary, expectedSetup, refKeys) {
  validateBoundary(boundary);
  validateSetup(expectedSetup);
  const keys = boundary.caseId === null ? PRODUCER_KEYS : REF_KEYS;
  plainArray(refKeys, keys.length, 'guard proof keys');
  requireThat(
    refKeys.every((key) => typeof key === 'string' && keys.includes(key)) &&
      new Set(refKeys).size === keys.length,
    'guard proof keys',
  );
  assertRecord(receipt, ['boundary', 'setup', 'proofRefs'], 'guard receipt');
  validateBoundary(receipt.boundary);
  validateSetup(receipt.setup);
  validateProofRefs(receipt.proofRefs, keys);
  equal(receipt.boundary, boundary, 'guard boundary binding');
  equal(receipt.setup, expectedSetup, 'guard setup binding');
  return receipt;
}
