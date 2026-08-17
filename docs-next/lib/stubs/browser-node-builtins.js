// Browser-only stand-ins for Node built-ins that are reachable through broad
// agentfootprint barrels. Every real access is call-time-only and outside the
// docs demos; keeping named exports lets both Turbopack and webpack prove the
// browser graph without silently polyfilling a server capability.
function nodeOnly(name) {
  return () => {
    throw new Error(`${name} is Node-only and is not available in the browser demos.`);
  };
}

export const createRequire = nodeOnly('node:module.createRequire');
export const createServer = nodeOnly('node:http.createServer');
export const join = nodeOnly('node:path.join');
export const readdir = nodeOnly('node:fs/promises.readdir');
export const readFile = nodeOnly('node:fs/promises.readFile');
export const stat = nodeOnly('node:fs/promises.stat');

export default {
  createRequire,
  createServer,
  join,
  readdir,
  readFile,
  stat,
};
