import type { ArtifactMeta } from '../../../../../artifacts/types.js';
import type { Credential } from '../../../../../identity/types.js';

/** Invocation-local phase cells; never checkpoint state or a run registry. */

export interface CallArtifactInputs {
  wantedMeta: Readonly<Record<string, ArtifactMeta>> | undefined;
  wantsBlocked: boolean;
}

export interface CallCredentialInput {
  resolvedCredential: Credential | undefined;
  credentialBlocked: boolean;
}
