import { ADAPTER, GRPC_STATUS } from './constants.js';
/**
 * The gRPC status of a failed call, as a NAME, wherever the client put it.
 *
 * Two spellings are accepted because two layers report it differently: the gax
 * layer sets a numeric `code`, and some wrappers carry the name as a string. A
 * classifier that read only one of them would quietly stop classifying the day
 * the client is upgraded.
 */
export function grpcStatusOf(err: unknown): string | undefined {
  const e = err as { code?: unknown; status?: unknown } | null | undefined;
  if (e === null || typeof e !== 'object') return undefined;
  for (const candidate of [e.code, e.status]) {
    if (typeof candidate === 'number' && GRPC_STATUS[candidate] !== undefined) {
      return GRPC_STATUS[candidate];
    }
    if (typeof candidate === 'string' && Object.values(GRPC_STATUS).includes(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Is this the service saying "that query has no index"? */
export function isFailedPrecondition(err: unknown): boolean {
  return grpcStatusOf(err) === 'FAILED_PRECONDITION';
}

/**
 * Re-raise a failed Firestore call **without its text** — the same law the AWS
 * and Vertex columns follow, re-aimed at a gRPC error.
 *
 * What comes through is the part that is both safe and actionable: which
 * operation failed, which collection it was on, and the gRPC status name. What
 * does not is the SDK's message, because a Firestore error restates the failing
 * request — a document path, a filter value, a field — and those carry a user id
 * and a whole conversation's state. An error thrown from an adapter reaches the
 * model as a tool result AND rides the event stream to every sink attached to
 * the agent.
 *
 * No credential is ever named. **The original is deliberately not attached as
 * `cause`** — a cause travels with the error into every serializer that walks
 * own properties, which would undo all of this in one `JSON.stringify`.
 */
export function firestoreFailure(operation: string, collection: string, err: unknown): Error {
  const status = grpcStatusOf(err);
  const failure = new Error(
    `[hosting] ${ADAPTER}: ${operation} in collection '${collection}' failed` +
      (status === undefined ? '' : ` (${status})`) +
      `.\n  The SDK's own message is withheld: a Firestore error restates the failing ` +
      `request, and these requests carry a user id and a whole conversation's state. ` +
      `Check Cloud Logging for the full error.`,
  );
  failure.name = 'FirestoreApiError';
  return failure;
}
