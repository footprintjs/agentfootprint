import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/time/instant.ts', import.meta.url), 'utf8');
const output = new URL('../src/llm-ledger/instantParser.ts', import.meta.url);
writeFileSync(output, '// Generated from src/time/instant.ts by scripts/gen-ledger-instant.mjs.\n' + source);
