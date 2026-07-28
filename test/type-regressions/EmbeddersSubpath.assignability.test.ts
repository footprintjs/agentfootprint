/**
 * Compile-level regression test — `agentfootprint/embedders` must export the
 * TYPE its own factories return.
 *
 * Before 7.9 the barrel imported `Embedder` from `../memory/embedding/types.js`
 * and never re-exported it, so a consumer of the subpath got
 *
 *   error TS2459: Module '"agentfootprint/embedders"' declares 'Embedder'
 *   locally, but it is not exported.
 *
 * and had to reach into a SECOND subpath (`agentfootprint/memory`) just to name
 * the return type of `staticEmbedder()`. A subpath that produces a value must
 * be able to name it.
 *
 * The `backend` option types belong to the same contract: they are what a
 * bundled/browser consumer has to write down to inject an already-imported
 * peer dep, so they are exported too.
 *
 * Lives under its own tsconfig (run via `npm run test:types`) so the REAL
 * TypeScript compiler checks the assignments, while its `.test.ts` name also
 * lets vitest exercise the runtime assertions.
 */
import { describe, expect, it } from 'vitest';
import {
  localEmbedder,
  staticEmbedder,
  openaiEmbedder,
  type Embedder,
  type Model2VecBackend,
  type TransformersBackend,
} from '../../src/embedders/index';

describe('agentfootprint/embedders exports the type its factories return', () => {
  it('names Embedder without reaching into another subpath', () => {
    const local: Embedder = localEmbedder();
    const stat: Embedder = staticEmbedder();
    const hosted: Embedder = openaiEmbedder({ apiKey: 'sk-test' });
    expect([local.dimensions, stat.dimensions, hosted.dimensions]).toEqual([384, 256, 1536]);
  });

  it('the same Embedder as agentfootprint/memory declares — one type, not two', () => {
    // Structural identity: assignable in both directions.
    type FromEmbedders = Embedder;
    const roundTrip: FromEmbedders = staticEmbedder() satisfies Embedder;
    expect(typeof roundTrip.embed).toBe('function');
  });

  it('the backend option types are nameable by a bundled consumer', async () => {
    const transformers: TransformersBackend = {
      env: {},
      pipeline: async () => async () => ({ data: [1, 2], tolist: () => [[1, 2]] }),
    };
    const potion: Model2VecBackend = { embed: (texts) => texts.map(() => [1, 2]) };

    const a: Embedder = localEmbedder({ backend: transformers, dimensions: 2 });
    const b: Embedder = staticEmbedder({ backend: potion, dimensions: 2 });
    expect(await a.embed({ text: 'x' })).toEqual([1, 2]);
    expect(await b.embed({ text: 'x' })).toEqual([1, 2]);
  });
});
