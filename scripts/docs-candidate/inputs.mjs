/** Fixed original artifacts admitted for this native docs cohort, never registry substitutes. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { githubInputReader } from './github.mjs';
import { collectOriginalInputs } from './intake.mjs';
import { failureDetails } from './failures.mjs';

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child);
  return Object.freeze(value);
}

export const DOCS_INPUTS = freeze(JSON.parse(readFileSync(new URL('./pins.json', import.meta.url), 'utf8')));

export function fetchDocsInputs(destination) {
  const reader = githubInputReader();
  try {
    return collectOriginalInputs(DOCS_INPUTS, destination,
      fileURLToPath(new URL('../../', import.meta.url)), reader);
  } finally { reader.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 4 && process.argv[2] === '--out', 'docs-input-arguments');
    const receipt = fetchDocsInputs(process.argv[3]);
    console.log(JSON.stringify({ protocol: receipt.protocol, inputTableSha256: receipt.inputTableSha256 }));
  } catch (error) {
    // Do not echo provider output, authentication details or caller-supplied text.
    console.error(JSON.stringify(failureDetails(error)));
    process.exitCode = 1;
  }
}
