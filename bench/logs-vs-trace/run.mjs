import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MODE, runValidation } from './harness.mjs';

export function parseArgs(args) {
  const options = { mode: MODE, seed: 1729 };
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i];
    if (
      !['--seed', '--out'].includes(flag) ||
      args[i + 1] === undefined ||
      args[i + 1].startsWith('--')
    ) {
      throw new Error(
        'Only --seed <uint32> and --out <new-file> are accepted; model/provider runs are disabled',
      );
    }
    if (Object.hasOwn(options, flag === '--seed' ? 'seedGiven' : 'out'))
      throw new Error('Duplicate option');
    if (flag === '--seed') {
      if (!/^\d+$/.test(args[i + 1])) throw new Error('Seed must be a uint32');
      options.seed = Number(args[i + 1]);
      options.seedGiven = true;
    } else options.out = resolve(args[i + 1]);
  }
  return options;
}

export async function main(args = process.argv.slice(2)) {
  const { out, seedGiven, ...options } = parseArgs(args);
  const result = await runValidation({
    ...options,
    loadDoors: () => import('agentfootprint/observe'),
  });
  const json = `${JSON.stringify(result, null, 2)}\n`;
  if (out !== undefined) {
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, json, { flag: 'wx' });
  }
  process.stdout.write(json);
  return result;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((error) => {
    process.stderr.write(`logs/trace harness: ${error.message}\n`);
    process.exitCode = 1;
  });
}
