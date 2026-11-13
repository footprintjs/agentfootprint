import { EXPIRES_AT_FIELD } from './constants.js';
/**
 * The one step that turns the TTL policy on, with this store's own collection
 * and database already in it.
 *
 * One spelling, shared by the retention answer and the documentation that
 * quotes it, for the same reason the missing-index refusal prints the whole
 * `gcloud` line: the person reading it can fix this in sixty seconds, and only
 * if nobody makes them go and look up the flags first.
 *
 * `--database` is always printed, including for `(default)`, where gcloud
 * would have assumed it — a project may hold several databases, and a policy
 * created on the wrong one leaves conversations living forever with nothing to
 * suggest why. Single-quoted, because `(default)` is bare parentheses and a
 * syntax error in every shell this will be pasted into.
 */
export function ttlPolicyCommand(collection: string, database?: string): string {
  const flagValue = `'${database ?? '<the database your Firestore client was built for>'}'`;
  return (
    `gcloud firestore fields ttls update ${EXPIRES_AT_FIELD} ` +
    `--collection-group=${collection} --enable-ttl --database=${flagValue}` +
    (database === undefined
      ? ` (this store did not build the Firestore client, so it cannot name the database — ` +
        `fill that flag in from wherever the client was constructed)`
      : ``)
  );
}
