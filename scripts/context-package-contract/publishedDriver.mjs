/** Owns the fixed strict-native CLI workflow behind the import-only contract facade. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { getPublishedInputs } from './publishedSetup.mjs';
import { admitPublishedInputs } from './publishedInputs.mjs';
import { createPublishedContextPorts } from './published.mjs';
import { readRegular } from './publishedGraph.mjs';
import { assertPublicProducerReports } from './publicProducerResult.mjs';

export async function runStrictNativeContract(ownerRoot, argv, runPairedContextPackageContract) {
  assert.equal(argv.length, 4, 'Supply one new evidence directory and the exact source head');
  const evidenceRoot = resolve(argv[2]);
  const head = argv[3];
  assert.match(head, /^[a-f0-9]{40}$/);
  const sourceRoot = realpathSync(ownerRoot);
  const delta = relative(sourceRoot, evidenceRoot);
  assert(delta && (isAbsolute(delta) || delta === '..' || delta.startsWith('..' + sep)), 'evidence must be outside the source');
  mkdirSync(evidenceRoot, { mode: 0o700 });
  assert.equal(realpathSync(evidenceRoot), evidenceRoot, 'evidence root must not be an alias');
  const ownedWorkRoot = realpathSync(mkdtempSync(join(tmpdir(), 'af-strict-context-')));
  const save = (name, value) => writeFileSync(join(evidenceRoot, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  let status = 1;
  try {
    const manifest = readRegular(join(sourceRoot, 'package.json')).toString();
    const lock = readRegular(join(sourceRoot, 'package-lock.json')).toString();
    const inputs = getPublishedInputs(manifest, lock);
    const tree = execFileSync('git', ['rev-parse', head + '^{tree}'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
    const source = { head, tree, manifestSha256: inputs.source.manifestSha256, lockSha256: inputs.source.lockSha256 };
    const directory = join(evidenceRoot, 'archives');
    mkdirSync(directory, { mode: 0o700 });
    const archives = await admitPublishedInputs(inputs, directory);
    const ports = createPublishedContextPorts({ sourceRoot, source, inputs, archives, evidenceRoot });
    const evidence = await runPairedContextPackageContract({ sourceRoot, ownedWorkRoot, source, ...ports });
    assert.equal(evidence.complete, true);
    const graphs = Object.fromEntries(['consumer-online', 'consumer-offline'].map((caseId) => [caseId, JSON.parse(readRegular(join(evidenceRoot, caseId + '-graph.json')))]));
    const publicProducers = assertPublicProducerReports(evidence, inputs, graphs);
    save('native-result.json', { complete: true, source, selected: inputs.selected, evidence, publicProducers, qualification: 'original four-root strict native context gate plus admitted public producer runs; not full CI or publication' });
    status = 0;
    console.log('Four strict native context roots and public CJS/ESM producer identities passed.');
  } catch (error) {
    save('native-failure.json', { complete: false, error: String(error?.stack ?? error), evidence: error?.contextPackageEvidence ?? null });
    console.error('Strict native context gate failed; original partial evidence retained.');
  } finally {
    try { rmSync(ownedWorkRoot, { recursive: true, force: true }); }
    catch (error) { status = 1; save('cleanup-failure.json', { error: String(error) }); }
  }
  return status;
}
