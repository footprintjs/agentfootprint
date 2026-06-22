// Browser stub for `node:module`. agentfootprint's lazyRequire does a namespace
// import + a CALL-TIME `.createRequire` access that is only ever reached in Node
// (to load an optional peer dep — ioredis / @aws-sdk / @modelcontextprotocol).
// In the browser (mock agent) it is never called, so a throwing stub is safe and
// lets Turbopack bundle the agent runtime. Vite/webpack stub node: builtins
// automatically; Turbopack needs this alias. The LIBRARY is untouched.
export function createRequire() {
  throw new Error(
    'node:module.createRequire is Node-only — optional peer deps cannot load in the browser.',
  );
}
export default { createRequire };
