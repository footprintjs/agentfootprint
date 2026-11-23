import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { it } from 'vitest';

it('documents independent answer warning stages in chart order', () => {
  const generator = fileURLToPath(
    new URL('../../scripts/generate-answer-warning-readme.mjs', import.meta.url),
  );
  execFileSync(process.execPath, [generator, '--check'], { stdio: 'pipe' });
});
