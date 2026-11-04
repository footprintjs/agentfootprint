import type { CredentialProvider } from '../../../../../identity/types.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import { bindRequest } from '../../../../../identity/requestContext.js';
import type { ToolCredentialsOperations } from '../contracts/operations/credentials.js';

interface ToolCredentialsOperationsLinks {
  readonly baseCredentials: CredentialProvider;
}

/** Compose the existing credentials callbacks once for this handler. */
export function buildToolCredentialsOperations(
  deps: Pick<ToolCallsHandlerDeps, 'currentRequest'>,
  links: ToolCredentialsOperationsLinks,
): ToolCredentialsOperations {
  // The provider a call in `scope` is handed: bound to THAT run's request
  // (or to none), whatever the call itself presents — and only for the one
  // service the tool DECLARES. A tool reaches a request credential through its
  // own `needs`, never another service's through the pull path.
  const credentialsIn = (scope: object, service: string | undefined): CredentialProvider =>
    bindRequest(links.baseCredentials, deps.currentRequest?.(scope), service);

  return { credentialsIn };
}
