#!/usr/bin/env node
/**
 * Author-side undo evidence, not an independent review or a replacement for green gates.
 * Usage: node scripts/prove-bedrock-guardrail-undo.mjs /absolute/evidence/directory
 *
 * Each focused Vitest process sees one in-memory undo in a guarded pre-transform.
 * No source file is rewritten. Promise-handshake tests establish stream ordering;
 * this driver introduces no timer, retry, SDK request, browser or model call.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const admission = 'src/core/providerIntervention.ts';
const classification = 'src/adapters/llm/BedrockProvider/guardrailClassify.ts';
const guardedStream = 'src/adapters/llm/BedrockProvider/guardedStream.ts';
const coreTests = 'test/core/provider-intervention.test.ts';
const classificationTests = 'test/adapters/unit/BedrockProvider.guardrailClassification.test.ts';
const streamTests = 'test/adapters/unit/BedrockProvider.guardrailStream.test.ts';
const coreSuite = 'provider intervention at the admitted native response';
const classificationSuite = (mode) => `Bedrock guardrails classification — ${mode}`;
const streamSuite = 'Bedrock guardrail stream admission boundary';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const assertion = (file, suite, title, status, failurePattern) => ({
  file,
  fullName: `${suite} ${title}`,
  status,
  ...(failurePattern === undefined ? {} : { failurePattern }),
});
const coreCases = (failurePattern) =>
  ['classic', 'dynamic', 'dynamic-grouped'].flatMap((mode) =>
    ['masked', 'blocked', 'unknown'].map((outcome) =>
      assertion(
        coreTests,
        coreSuite,
        `${mode}: ${outcome} has its own terminal and memory behavior`,
        outcome === 'masked' ? 'passed' : 'failed',
        outcome === 'masked' ? undefined : failurePattern,
      ),
    ),
  );

const admissionStart = `export function admitProviderIntervention<T extends object>(
  scope: TypedScope<T>,
  response: unknown,
  beforeBreak?: () => void,
): boolean {
`;
const blockFirst = `    if (this.blocked) return { outcome: 'blocked', code, filters: this.descriptors };
    if (this.masked && this.reads.complete && code !== 'content_filtered')
      return { outcome: 'masked', code, filters: this.descriptors };`;
const maskFirst = `    if (this.masked && this.reads.complete && code !== 'content_filtered')
      return { outcome: 'masked', code, filters: this.descriptors };
    if (this.blocked) return { outcome: 'blocked', code, filters: this.descriptors };`;
const probes = [
  {
    id: 'admission-undo',
    purpose: 'Bypass accepted-response admission entirely; masked responses remain usable.',
    source: admission,
    before: admissionStart,
    after: `${admissionStart}  return false; // Undo: skip all accepted-response admission work.\n`,
    assertions: coreCases('promise resolved[\\s\\S]*instead of rejecting'),
  },
  {
    id: 'block-dominance-undo',
    purpose: 'Prefer complete masking evidence over a separately proved block.',
    source: classification,
    before: blockFirst,
    after: maskFirst,
    assertions: ['complete', 'stream'].flatMap((mode) => [
      ...[
        'mask input then block output',
        'block input then mask output',
        'mask policy followed by content blocker',
      ].map((title) =>
        assertion(
          classificationTests,
          classificationSuite(mode),
          title,
          'failed',
          "expected 'masked' to be 'blocked'",
        ),
      ),
      ...['blocked-only input assessment', 'masked-only output assessment'].map((title) =>
        assertion(classificationTests, classificationSuite(mode), title, 'passed'),
      ),
    ]),
  },
  {
    id: 'final-memory-routing-undo',
    purpose: 'Retain the admitted terminal carrier and notifications, suppress only its native break.',
    source: admission,
    before: "  scope.$break('Provider intervention withheld the response.');",
    after: '  // Undo: keep the terminal carrier but let routing enter the final/memory branch.',
    // Rejection must still pass: only the later zero-memory assertion may kill this undo.
    assertions: coreCases('to have a length of \\+?0'),
  },
  {
    id: 'stream-withholding-undo',
    purpose: 'Release a held text prefix before post-stop assessment metadata and natural end.',
    source: guardedStream,
    before: '        if (delta.valid && delta.present) held.acceptDelta(delta.value);',
    after: `        if (delta.valid && delta.present) {
          held.acceptDelta(delta.value);
          const prefix = held.chunks()[0];
          if (!stopped && prefix !== undefined)
            yield { tokenIndex: 0, content: prefix.slice(0, 1), done: false };
        }`,
    assertions: [
      ...['ANONYMIZED', 'BLOCKED'].map((action) =>
        assertion(
          streamTests,
          streamSuite,
          `${action}: releases no content until post-stop metadata and natural end`,
          'failed',
          'to deeply equal \\[\\]',
        ),
      ),
      assertion(
        streamTests,
        streamSuite,
        'no metadata is an unknown outcome with no released content and one send',
        'failed',
        'to deeply equal \\[\\]',
      ),
      assertion(
        streamTests,
        streamSuite,
        'a missing stream never sends a fallback Converse request',
        'passed',
      ),
      ...['complete', 'stream'].map((mode) =>
        assertion(
          classificationTests,
          classificationSuite(mode),
          'normal response with no guardrail preserves content, usage and no intervention',
          'passed',
        ),
      ),
      assertion(
        classificationTests,
        classificationSuite('complete'),
        'configured normal response remains usable after complete terminal framing',
        'passed',
      ),
    ],
  },
];

function configText(probe, paths, scratch, originalHash) {
  const files = [...new Set(probe.assertions.map((entry) => entry.file))];
  const pattern = probe.assertions
    .map((entry) => `(?:^| )${escapeRegex(entry.fullName)}$`)
    .join('|');
  // Inside this repo, normal package resolution finds the installed Vitest.
  // The real config is merged, preserving its zod dedupe and all other settings.
  return `import { mergeConfig } from 'vitest/config';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import base from ${JSON.stringify(join(root, 'vitest.config.ts'))};
const target = ${JSON.stringify(join(root, probe.source))};
const before = ${JSON.stringify(probe.before)};
const after = ${JSON.stringify(probe.after)};
const sha = (code) => createHash('sha256').update(code).digest('hex');
const config = mergeConfig(base, {
  root: ${JSON.stringify(root)},
  cacheDir: ${JSON.stringify(join(scratch, 'vite-cache'))},
  plugins: [{
    name: ${JSON.stringify(`guarded-${probe.id}`)},
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0] !== target) return null;
      if (sha(code) !== ${JSON.stringify(originalHash)})
        throw new Error('Undo refused: pre-transform input differs from the raw source snapshot.');
      const matches = code.split(before).length - 1;
      if (matches !== 1) throw new Error('Undo refused: expected one exact source match, got ' + matches);
      const changed = code.replace(before, after);
      if (changed === code) throw new Error('Undo refused: replacement changed nothing.');
      appendFileSync(${JSON.stringify(paths.transforms)}, JSON.stringify({
        source: target, matches, originalSha256: sha(code), mutatedSha256: sha(changed),
      }) + '\\n');
      return { code: changed, map: null };
    },
  }],
  test: {
    watch: false,
    fileParallelism: false,
    maxWorkers: 1,
    retry: 0,
    cache: false,
    coverage: { enabled: false },
    reporters: ['json'],
    outputFile: ${JSON.stringify(paths.report)},
    testNamePattern: new RegExp(${JSON.stringify(pattern)}),
  },
});
// Assign after merge: array merging must never broaden this focused file set.
config.test.include = ${JSON.stringify(files)};
export default config;
`;
}

function inspectProbe(probe, paths, child, originalHash) {
  const errors = [];
  if (child.error) errors.push(`Vitest spawn failed: ${child.error.message}`);
  if (child.signal) errors.push(`Vitest was terminated by ${child.signal}`);
  if (child.status !== 1) errors.push(`Expected Vitest assertion-failure exit 1, got ${child.status}`);
  let report;
  let transforms = [];
  try {
    report = JSON.parse(readFileSync(paths.report, 'utf8'));
  } catch (error) {
    errors.push(`Missing or invalid fresh Vitest report: ${error.message}`);
  }
  try {
    transforms = readFileSync(paths.transforms, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    if (transforms.length === 0) errors.push('The undo never reached the source transform.');
    for (const hit of transforms) {
      if (
        hit.source !== join(root, probe.source) ||
        hit.matches !== 1 ||
        hit.originalSha256 !== originalHash ||
        hit.mutatedSha256 === originalHash
      )
        errors.push('Invalid exact-match transform evidence.');
    }
  } catch (error) {
    errors.push(`Missing or invalid transform evidence: ${error.message}`);
  }
  const results = [];
  for (const file of report?.testResults ?? []) {
    if (file.message) errors.push(`Suite-level error in ${file.name}: ${file.message}`);
    for (const entry of file.assertionResults ?? [])
      results.push({ ...entry, file: relative(root, file.name) });
  }
  const observed = probe.assertions.map((expected) => {
    const found = results.filter(
      (entry) =>
        entry.file === expected.file &&
        (entry.fullName === expected.fullName || entry.fullName.endsWith(` ${expected.fullName}`)),
    );
    if (found.length !== 1) {
      errors.push(`Expected one assertion record for ${expected.fullName}, got ${found.length}`);
      return { ...expected, observedStatus: 'missing-or-ambiguous' };
    }
    const actual = found[0];
    if (actual.status !== expected.status)
      errors.push(`${expected.fullName}: expected ${expected.status}, got ${actual.status}`);
    if (
      expected.failurePattern !== undefined &&
      !new RegExp(expected.failurePattern).test((actual.failureMessages ?? []).join('\n'))
    )
      errors.push(`${expected.fullName}: failed outside the required behavior assertion`);
    return { ...expected, observedStatus: actual.status, failureMessages: actual.failureMessages };
  });
  const executed = results.filter((entry) => entry.status === 'passed' || entry.status === 'failed');
  if (executed.length !== probe.assertions.length)
    errors.push(`Executed ${executed.length} assertions; selected ${probe.assertions.length}`);
  if (report?.success !== false) errors.push('Report did not record the expected failing undo run.');
  return {
    id: probe.id,
    purpose: probe.purpose,
    source: probe.source,
    before: probe.before,
    after: probe.after,
    killed: errors.length === 0,
    childExitCode: child.status,
    reports: paths,
    transforms,
    observed,
    measured: {
      passed: executed.filter((entry) => entry.status === 'passed').length,
      failed: executed.filter((entry) => entry.status === 'failed').length,
    },
    errors,
  };
}

function main() {
  const supplied = process.argv[2];
  if (process.argv.length !== 3 || !supplied || !isAbsolute(supplied))
    throw new Error('Usage: node scripts/prove-bedrock-guardrail-undo.mjs /absolute/evidence/directory');
  mkdirSync(supplied, { recursive: true });
  const output = realpathSync(supplied);
  const protectedPaths = [
    admission,
    classification,
    guardedStream,
    coreTests,
    classificationTests,
    streamTests,
    'vitest.config.ts',
    'scripts/prove-bedrock-guardrail-undo.mjs',
  ];
  const originals = new Map(protectedPaths.map((file) => [file, readFileSync(join(root, file))]));
  const pathsFor = (id) => ({
    report: join(output, `${id}.report.json`),
    transforms: join(output, `${id}.transforms.ndjson`),
    log: join(output, `${id}.log.txt`),
  });
  const proofPath = join(output, 'proof.json');
  for (const file of [proofPath, ...probes.flatMap((probe) => Object.values(pathsFor(probe.id)))])
    if (existsSync(file)) throw new Error(`Refusing to overwrite existing evidence: ${file}`);
  for (const probe of probes) {
    const matches = originals.get(probe.source).toString('utf8').split(probe.before).length - 1;
    if (matches !== 1) throw new Error(`${probe.id}: expected one raw source match, got ${matches}`);
  }
  const vitest = join(root, 'node_modules/vitest/vitest.mjs');
  if (!existsSync(vitest)) throw new Error(`Local Vitest is missing: ${vitest}`);
  const work = join(root, 'work');
  const madeWork = !existsSync(work);
  mkdirSync(work, { recursive: true });
  const scratch = mkdtempSync(join(work, 'bedrock-guardrail-undo-'));
  const proof = {
    kind: 'author-side-in-memory-undo-evidence',
    independentReview: false,
    root,
    output,
    complete: false,
    sourceUnchanged: false,
    protectedFiles: [],
    temporaryConfigsRemoved: false,
    probes: [],
    errors: [],
  };
  const unchanged = () =>
    [...originals].every(([file, before]) => before.equals(readFileSync(join(root, file))));
  const cleanup = () => {
    // This path was freshly allocated by this invocation; reports are elsewhere.
    rmSync(scratch, { recursive: true, force: true });
    if (madeWork) {
      try {
        rmdirSync(work);
      } catch (error) {
        if (error.code !== 'ENOTEMPTY' && error.code !== 'ENOENT') throw error;
      }
    }
  };
  process.once('exit', cleanup);
  try {
    for (const probe of probes) {
      if (!unchanged()) throw new Error('Protected source/test/config bytes changed; refusing another run.');
      const paths = pathsFor(probe.id);
      const config = join(scratch, `${probe.id}.config.mjs`);
      const originalHash = hash(originals.get(probe.source));
      writeFileSync(config, configText(probe, paths, scratch, originalHash), { flag: 'wx' });
      const files = [...new Set(probe.assertions.map((entry) => entry.file))];
      const child = spawnSync(process.execPath, [vitest, 'run', '--configLoader', 'runner', '--config', config, ...files], {
        cwd: root,
        encoding: 'utf8',
        shell: false,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
      });
      writeFileSync(paths.log, `${child.stdout ?? ''}${child.stderr ?? ''}`, { flag: 'wx' });
      const result = inspectProbe(probe, paths, child, originalHash);
      proof.probes.push(result);
      console.log(
        `${probe.id}: ${result.killed ? 'killed' : 'NOT PROVED'}; ` +
          `${result.measured.failed} failed, ${result.measured.passed} surviving controls`,
      );
      if (!unchanged()) throw new Error('Protected source/test/config bytes changed during the undo run.');
      if (result.measured.failed + result.measured.passed === 0) break;
    }
  } catch (error) {
    proof.errors.push(error.stack ?? String(error));
  } finally {
    for (const [file, before] of originals) {
      try {
        const after = readFileSync(join(root, file));
        proof.protectedFiles.push({
          file,
          beforeSha256: hash(before),
          afterSha256: hash(after),
          byteIdentical: before.equals(after),
        });
      } catch (error) {
        proof.errors.push(`Cannot verify ${file}: ${error.message}`);
      }
    }
    proof.sourceUnchanged =
      proof.protectedFiles.length === originals.size &&
      proof.protectedFiles.every((entry) => entry.byteIdentical);
    try {
      cleanup();
      proof.temporaryConfigsRemoved = !existsSync(scratch);
      process.removeListener('exit', cleanup);
    } catch (error) {
      proof.errors.push(`Temporary config cleanup failed at ${scratch}: ${error.message}`);
    }
    proof.complete =
      proof.errors.length === 0 &&
      proof.sourceUnchanged &&
      proof.temporaryConfigsRemoved &&
      proof.probes.length === probes.length &&
      proof.probes.every((probe) => probe.killed);
    writeFileSync(proofPath, `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
    console.log(`Author-side proof: ${proofPath}`);
    process.exitCode = proof.complete ? 0 : 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error.stack ?? String(error));
  process.exitCode = 1;
}
