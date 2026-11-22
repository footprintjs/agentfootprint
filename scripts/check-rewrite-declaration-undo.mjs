import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Behavioral undo controls: transform only the targeted helper in memory.
// Product files, the normal config and the original baseline stay untouched.
const root = process.cwd();
const output = process.argv[2] === undefined ? undefined : resolve(process.argv[2]);
if (output !== undefined) await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'af-declaration-undo-'));
const target = '/src/core/agent/assessment/results/coverage/declarations.ts';
const baseline = 'test/core/agent/assessment/native-rewrite-declarations.test.ts';
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
];
try {
  const results = [];
  for (const control of controls) {
    const pattern = `export function ${control.function}\\([\\s\\S]*?\\n}\\n`;
    const source = await readFile(resolve(root, target.slice(1)), 'utf8');
    assert.equal(
      [...source.matchAll(new RegExp(pattern, 'g'))].length,
      1,
      'Undo target changed; inspect the control.',
    );
    const config = join(temporary, `${control.name}.mts`);
    await writeFile(
      config,
      `
import { mergeConfig } from ${JSON.stringify(
        pathToFileURL(resolve(root, 'node_modules/vitest/dist/config.js')).href,
      )};
import original from ${JSON.stringify(pathToFileURL(resolve(root, 'vitest.config.ts')).href)};
export default mergeConfig(original, { plugins: [{ name: 'declaration-undo', enforce: 'pre',
  transform(code, id) {
    if (!id.replaceAll('\\\\', '/').endsWith(${JSON.stringify(target)})) return;
    const pattern = new RegExp(${JSON.stringify(pattern)}, 'g');
    if ([...code.matchAll(pattern)].length !== 1) throw new Error('Undo target changed.');
    return { code: code.replace(pattern, ${JSON.stringify(control.body + '\n')}), map: null };
  }
}] });
`,
    );
    const child = spawnSync(
      process.execPath,
      [
        resolve(root, 'node_modules/vitest/vitest.mjs'),
        'run',
        baseline,
        '--config',
        config,
        '--reporter=verbose',
      ],
      { cwd: root, encoding: 'utf8' },
    );
    if (child.error !== undefined) throw child.error;
    const raw = child.stdout + child.stderr;
    if (output !== undefined)
      await writeFile(join(output, `${control.name}.log`), raw, { flag: 'wx' });
    const text = raw.replace(/\u001b\[[0-9;]*m/g, '');
    const match = text.match(/Tests\s+(\d+) failed\s*\|\s*(\d+) passed\s*\(25\)/);
    assert.equal(child.status, 1, `${control.name}: expected behavioral failure`);
    assert.ok(
      match,
      `${control.name}: expected executed baseline tests, not an import/setup failure`,
    );
    assert.equal(Number(match[1]), control.failed, `${control.name}: wrong behavioral failures`);
    assert.equal(
      Number(match[2]),
      25 - control.failed,
      `${control.name}: preservation controls changed`,
    );
    assert.ok(
      text.includes(control.witness),
      `${control.name}: intended assertion was not exercised`,
    );
    results.push({
      control: control.name,
      exitCode: child.status,
      failed: Number(match[1]),
      passed: Number(match[2]),
    });
  }
  console.log(JSON.stringify({ controls: results }));
} finally {
  await rm(temporary, { recursive: true });
}
