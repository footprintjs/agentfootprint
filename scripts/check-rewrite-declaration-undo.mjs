import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Behavioral undo controls: transform only the targeted helper in memory.
// Product files, the normal config and the original baseline stay untouched.
const root = process.cwd();
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const output = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
if (output !== undefined) await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'af-declaration-undo-'));
const target = '/src/core/agent/assessment/results/coverage/declarations.ts';
const baseline = 'test/core/agent/assessment/native-rewrite-declarations.test.ts';
const ownerBaseline = 'test/answer-account/rewrite-final-owner.test.ts';
const ownerSuite = 'final rewrite ownership across unavailable decisions';
const ownerCases = {
  intact: `${ownerSuite} credits the intact final rule and its original decision pointer`,
  opaque: `${ownerSuite} withholds attribution after scoped whole-row redaction of the final decision`,
  keyOnly: `${ownerSuite} withholds attribution after scoped key-only redaction of the final decision`,
  absent: `${ownerSuite} an imported absent final occurrence key cannot credit an earlier rule`,
  malformed: `${ownerSuite} an imported malformed final occurrence key cannot credit an earlier rule`,
  later: `${ownerSuite} a retained final owner remains attributable after an earlier unplaced decision`,
};
const controls = [
  {
    name: 'admission',
    function: 'declaredResultAdmitted',
    body: 'export function declaredResultAdmitted(row, address, proof) { return proof.native(row, address); }',
    failed: 14,
    witness: 'keeps original coverage, absence and period',
  },
  {
    name: 'union',
    function: 'hasOwnDeclarationWitness',
    body: 'export function hasOwnDeclarationWitness(delivery, nativeHasReason) { return !nativeHasReason; }',
    failed: 2,
    witness: 'keeps distinct native and replacement witnesses',
  },
  {
    name: 'unresolved-owner-index',
    target: '/src/core/agent/recordedCalls/resultRewriteIndex.ts',
    baseline: ownerBaseline,
    before: '      byOccurrence.clear();\n',
    after: '',
    total: 6,
    failed: 4,
    witness: 'an imported absent final occurrence key cannot credit an earlier rule',
    failedTests: [ownerCases.opaque, ownerCases.keyOnly, ownerCases.absent, ownerCases.malformed],
    passedTests: [ownerCases.intact, ownerCases.later],
  },
  {
    name: 'unfiltered-inspector-ledger',
    target: '/src/trace-toolpack/traceToolpack/toolCallJournal.ts',
    baseline: ownerBaseline,
    before: 'indexResultRewrites(ledger())',
    after: "indexResultRewrites(ledger().filter((row) => row !== null && typeof row === 'object'))",
    total: 6,
    failed: 1,
    witness: 'withholds attribution after scoped whole-row redaction of the final decision',
    failedTests: [ownerCases.opaque],
    passedTests: [
      ownerCases.intact,
      ownerCases.keyOnly,
      ownerCases.absent,
      ownerCases.malformed,
      ownerCases.later,
    ],
  },
  {
    name: 'unavailable-decision-scan',
    target: '/src/trace-toolpack/traceToolpack/toolCallOccurrence.ts',
    baseline: 'test/trace-toolpack/inspectToolCall.occurrence.test.ts',
    before:
      "    row !== null &&\n    typeof row === 'object' &&\n    Object.getOwnPropertyDescriptor(row, 'toolCallId')?.value === toolCallId &&\n",
    after: '    (row as Record<string, unknown>).toolCallId === toolCallId &&\n',
    total: 14,
    failed: 2,
    witness: 'an unavailable null row cannot leave an earlier trace owner',
    failedTests: [
      'inspect_tool_call from keyed saved recordings an unavailable null row cannot leave an earlier trace owner',
      'inspect_tool_call from keyed saved recordings a later bound trace owner survives an earlier null decision',
    ],
    passedTests: [
      'inspect_tool_call from keyed saved recordings keeps the same text for one complete call with or without a key',
      'inspect_tool_call from keyed saved recordings an unavailable opaque row cannot leave an earlier trace owner',
    ],
  },
];
const results = [];
const protectedPaths = new Set([
  'vitest.config.ts',
  'scripts/check-rewrite-declaration-undo.mjs',
  ...controls.flatMap((control) => [
    (control.target ?? target).replace(/^\//, ''),
    control.baseline ?? baseline,
  ]),
]);
const originals = new Map(
  await Promise.all(
    [...protectedPaths].map(async (path) => [path, await readFile(resolve(root, path))]),
  ),
);
try {
  for (const control of controls) {
    const selectedTarget = control.target ?? target;
    const selectedBaseline = control.baseline ?? baseline;
    const total = control.total ?? 25;
    const pattern =
      control.before === undefined
        ? `export function ${control.function}\\([\\s\\S]*?\\n}\\n`
        : escapeRegex(control.before);
    const replacement = control.after ?? control.body + '\n';
    const source = await readFile(resolve(root, selectedTarget.slice(1)), 'utf8');
    assert.equal(
      [...source.matchAll(new RegExp(pattern, 'g'))].length,
      1,
      'Undo target changed; inspect the control.',
    );
    const config = join(temporary, `${control.name}.mts`);
    const report = join(temporary, `${control.name}.json`);
    await writeFile(
      config,
      `
import { mergeConfig } from ${JSON.stringify(
        pathToFileURL(resolve(root, 'node_modules/vitest/dist/config.js')).href,
      )};
import original from ${JSON.stringify(pathToFileURL(resolve(root, 'vitest.config.ts')).href)};
export default mergeConfig(original, { plugins: [{ name: 'declaration-undo', enforce: 'pre',
  transform(code, id) {
    if (!id.replaceAll('\\\\', '/').endsWith(${JSON.stringify(selectedTarget)})) return;
    const pattern = new RegExp(${JSON.stringify(pattern)}, 'g');
    if ([...code.matchAll(pattern)].length !== 1) throw new Error('Undo target changed.');
    return { code: code.replace(pattern, ${JSON.stringify(replacement)}), map: null };
  }
}] });
`,
    );
    const child = spawnSync(
      process.execPath,
      [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        selectedBaseline,
        '--config',
        config,
        '--reporter=verbose',
        '--reporter=json',
        '--outputFile',
        report,
      ],
      { cwd: root, encoding: 'utf8' },
    );
    if (child.error !== undefined) throw child.error;
    const raw = child.stdout + child.stderr;
    if (output !== undefined)
      await writeFile(join(output, `${control.name}.log`), raw, { flag: 'wx' });
    const text = raw.replace(/\u001b\[[0-9;]*m/g, '');
    const match = text.match(
      new RegExp(`Tests\\s+(\\d+) failed\\s*\\|\\s*(\\d+) passed\\s*\\(${total}\\)`),
    );
    assert.equal(child.status, 1, `${control.name}: expected behavioral failure`);
    assert.ok(
      match,
      `${control.name}: expected executed baseline tests, not an import/setup failure`,
    );
    assert.equal(Number(match[1]), control.failed, `${control.name}: wrong behavioral failures`);
    assert.equal(
      Number(match[2]),
      total - control.failed,
      `${control.name}: preservation controls changed`,
    );
    assert.ok(
      text.includes(control.witness),
      `${control.name}: intended assertion was not exercised`,
    );
    const measured = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(measured.numTotalTests, total, `${control.name}: wrong test count`);
    assert.equal(measured.numFailedTests, control.failed, `${control.name}: wrong failed count`);
    assert.equal(
      measured.numPassedTests,
      total - control.failed,
      `${control.name}: wrong controls`,
    );
    const cases = measured.testResults.flatMap((file) => file.assertionResults);
    for (const [names, status] of [
      [control.failedTests ?? [], 'failed'],
      [control.passedTests ?? [], 'passed'],
    ]) {
      for (const name of names) {
        const matches = cases.filter((test) => test.fullName === name);
        assert.equal(matches.length, 1, `${control.name}: missing or duplicate ${name}`);
        assert.equal(matches[0].status, status, `${control.name}: wrong result for ${name}`);
      }
    }
    if (output !== undefined)
      await writeFile(join(output, `${control.name}.json`), JSON.stringify(measured), {
        flag: 'wx',
      });
    results.push({
      control: control.name,
      source: selectedTarget,
      baseline: selectedBaseline,
      exitCode: child.status,
      failed: Number(match[1]),
      passed: Number(match[2]),
    });
  }
} finally {
  await rm(temporary, { recursive: true });
  for (const [path, before] of originals) {
    assert.ok(before.equals(await readFile(resolve(root, path))), `${path}: source changed`);
  }
}
const proof = { controls: results, sourceUnchanged: true, temporaryConfigsRemoved: true };
if (output !== undefined)
  await writeFile(join(output, 'proof.json'), JSON.stringify(proof, null, 2) + '\n', {
    flag: 'wx',
  });
console.log(JSON.stringify(proof));
