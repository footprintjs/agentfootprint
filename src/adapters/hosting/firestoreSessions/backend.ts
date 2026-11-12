import { lazyRequire } from '../../../lib/lazyRequire.js';
import { ADAPTER } from './constants.js';
import type { FirestoreSdkModule, FirestoreLike, FirestoreSessionsOptions } from './types.js';
/**
 * Load the peer dep, or refuse by name with the install line.
 *
 * `lazyRequire` keeps the specifier away from bundler static analysis, so
 * importing `agentfootprint/hosting` costs nothing for the consumers — the vast
 * majority — who never construct one of these.
 */
export function loadFirestoreSdk(): FirestoreSdkModule {
  let mod: FirestoreSdkModule;
  try {
    mod = lazyRequire<FirestoreSdkModule>('@google-cloud/firestore');
  } catch {
    throw new Error(
      `[hosting] ${ADAPTER} requires the \`@google-cloud/firestore\` package.\n` +
        `  Install:  npm install @google-cloud/firestore\n` +
        `  It is an OPTIONAL peer dependency, loaded only when you construct this store — ` +
        `memorySessions() and sqliteSessions() need nothing installed.`,
    );
  }
  if (typeof mod.Firestore !== 'function' || typeof mod.FieldPath?.documentId !== 'function') {
    throw new Error(
      `[hosting] ${ADAPTER}: \`@google-cloud/firestore\` is installed but does not export ` +
        `both \`Firestore\` and \`FieldPath.documentId\`. This adapter is built against the ` +
        `9.x client — update the package, or pass \`firestore\` with a pre-built client.`,
    );
  }
  return mod;
}

/**
 * Build the client.
 *
 * Only the settings this adapter has an opinion about are forwarded, and each is
 * omitted rather than passed as `undefined`: the client treats an explicit
 * `undefined` and an absent key the same way today, and relying on that is how a
 * connection ends up configured by an SDK upgrade.
 */
export function buildClient(
  sdk: FirestoreSdkModule,
  options: FirestoreSessionsOptions,
): FirestoreLike {
  return new sdk.Firestore({
    ...(options.project !== undefined && { projectId: options.project }),
    ...(options.database !== undefined && { databaseId: options.database }),
  });
}
