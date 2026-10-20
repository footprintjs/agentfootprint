/** Print a review proposal, never update the accepted manifest or contact a service. */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closureHash, kitHashes, payloadHash } from './identity.mjs';
import { readFileSync } from 'node:fs';
if (process.argv.length !== 3)
  throw new Error('Usage: node bench/cache/pilot/inspect.mjs <installed-consumer>');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
console.log(
  JSON.stringify(
    {
      consumerClosureSha256: closureHash(resolve(process.argv[2], 'node_modules')),
      kit: kitHashes(root),
      payloadSha256: payloadHash(
        JSON.parse(readFileSync(resolve(root, 'bench/cache/pilot/manifest.json'))).order,
      ),
    },
    null,
    2,
  ),
);
