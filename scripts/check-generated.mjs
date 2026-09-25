#!/usr/bin/env node
/**
 * After `npm run docs:regen`, the tree must be exactly what was committed.
 * Any difference means a generated file (API mirror, docs-truth report, examples
 * README, AI-instruction copies, canonical notes) was not regenerated with the
 * change that made it stale. Run by `npm run docs:check` and CI's `generated` job.
 */
import { execFileSync } from 'node:child_process';

const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (dirty.length === 0) {
  console.log('generated files are up to date ✓');
} else {
  console.error('These files change when regenerated — the commit left them stale:\n');
  for (const line of dirty.slice(0, 40)) console.error(`  ${line}`);
  if (dirty.length > 40) console.error(`  … and ${dirty.length - 40} more`);
  console.error('\nFix: npm run docs:regen, then commit the result.');
  process.exitCode = 1;
}
