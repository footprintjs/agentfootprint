import type { CredentialProvider } from '../../../../../../identity/types.js';

/** Explicit callback contract for existing credentials operations. */
export interface ToolCredentialsOperations {
  readonly credentialsIn: (scope: object, service: string | undefined) => CredentialProvider;
}
