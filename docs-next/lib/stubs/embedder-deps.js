// Browser stub for the local-embedder model packages (`@huggingface/transformers`
// via `@yarflam/potion-base-8m`, and their `fs/promises` weight loading). The
// "Try it" demos import `agentfootprint/providers` for the mock provider; that
// barrel also carries localEmbedder/staticEmbedder, whose model deps load at
// CALL time and are never reached by a browser mock agent. Same pattern as
// node-module.js: a throwing stub keeps the bundler honest and the LIBRARY untouched.
function refuse() {
  throw new Error(
    'local embedder model packages are Node-only — they cannot load in the browser demos.',
  );
}
export default refuse;
export const pipeline = refuse;
export const env = {};
export const readFile = refuse;
export const open = refuse;
export const stat = refuse;
