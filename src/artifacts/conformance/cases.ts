/**
 * artifacts/conformance/cases — the battery itself.
 *
 * Each case holds ONE law of the port and says which one in its `law` field,
 * so a failure reads as a broken promise rather than as a broken assertion.
 * Nothing here imports a test framework: a case throws to fail, which is the
 * one convention every runner in every language already agrees on.
 *
 * The laws come from the port's own constitution (`artifacts/types.ts`): scope
 * is always the first argument and a ref alone opens nothing; `get`/`head`
 * answer `null` for missing OR expired; reads page; `head` describes without
 * the payload; refs are MINTED, never content-addressed; `parentRefs` are
 * proven at mint; `get` verifies a digest and `getStream` deliberately does
 * not.
 */

import { isArtifactRef } from '../naming.js';
import {
  ArtifactIntegrityError,
  InvalidArtifactError,
  UnknownParentRefError,
  type ArtifactListResult,
  type ArtifactScope,
  type ArtifactStore,
} from '../types.js';
import type { ArtifactConformanceKit, ArtifactStoreCase } from './types.js';

// ─── The little assertion kit ────────────────────────────────────────

/** Fail this case, naming what was expected. */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * The error a call failed with, or `undefined` when it succeeded.
 *
 * Takes a THUNK, so a store that throws synchronously where the port promises
 * a promise is still measured on its semantics rather than blowing the case up
 * on its calling convention.
 */
async function attempt(work: () => unknown): Promise<unknown> {
  try {
    await work();
    return undefined;
  } catch (err) {
    return err;
  }
}

/** Both halves of a call that may answer OR throw, for the cases where the
 *  distinction is itself the law under test. */
async function settle<T>(work: () => Promise<T>): Promise<{ value?: T; error?: unknown }> {
  try {
    return { value: await work() };
  } catch (err) {
    return { error: err };
  }
}

/** `name: message` for an error, for the refusal checks. */
function textOf(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/** Is this the refusal the port names for this problem? */
function isRefusal(err: unknown, kind: 'invalid' | 'unknown-parent' | 'integrity'): boolean {
  // Instance checks first, then the `code` — an adapter may carry its own
  // subclass, and a store in another package that re-created the class
  // (bundlers duplicate modules) is judged on the code it publishes rather
  // than on identity it cannot control.
  const code = (err as { code?: unknown } | undefined)?.code;
  if (kind === 'invalid')
    return err instanceof InvalidArtifactError || code === 'ERR_INVALID_ARTIFACT';
  if (kind === 'unknown-parent') {
    return err instanceof UnknownParentRefError || code === 'ERR_UNKNOWN_PARENT_REF';
  }
  return err instanceof ArtifactIntegrityError || code === 'ERR_ARTIFACT_INTEGRITY';
}

/** Read every page of a listing, so a paging bug shows up as a wrong SET. */
async function allPages(
  store: ArtifactStore,
  scope: ArtifactScope,
  limit: number,
): Promise<{ refs: string[]; pages: ArtifactListResult[] }> {
  const refs: string[] = [];
  const pages: ArtifactListResult[] = [];
  let cursor: string | undefined;
  // A bound, not a `while (true)`: a store whose cursor never terminates
  // should fail this case, not hang the suite that was checking it.
  for (let page = 0; page < 50; page++) {
    const result = await store.list(scope, { limit, ...(cursor !== undefined && { cursor }) });
    pages.push(result);
    for (const row of result.artifacts) refs.push(row.ref);
    cursor = result.cursor;
    if (cursor === undefined) return { refs, pages };
  }
  throw new Error(
    `list() never stopped: 50 pages of ${limit} and the cursor is still present. A cursor is ` +
      `promised only when MORE rows exist, so a listing that keeps handing one back is a pane ` +
      `that scrolls forever.`,
  );
}

/** Everything a stream handed over, as text. */
async function drain(body: ReadableStream<Uint8Array>): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) chunks.push(value);
  }
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const whole = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(whole);
}

/** One chunked payload, as the port's stream shape. */
function streamOf(chunks: readonly string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

/** The payload as a comparable value — binary compared byte for byte. */
function sameValue(left: unknown, right: unknown): boolean {
  if (left instanceof Uint8Array || right instanceof Uint8Array) {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array)) return false;
    return left.byteLength === right.byteLength && left.every((byte, at) => byte === right[at]);
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

// ─── The battery ─────────────────────────────────────────────────────

const putHeadGet: ArtifactStoreCase = {
  name: 'put-mints-a-ticket-head-describes-get-redeems',
  law: 'put mints a ticket and reports what it swept; head describes the artifact WITHOUT its payload; get redeems both.',
  async run(store, kit) {
    const scope = kit.scope('round-trip');
    const data = { rows: [1, 2, 3] };
    const { meta, swept } = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'application/json',
      data,
      label: 'Q3 rows',
    });

    check(
      Array.isArray(swept) && swept.length === 0,
      `put into an EMPTY scope reported ${JSON.stringify(swept)} swept. A sweep is a fact the ` +
        `caller puts on the record, so inventing one describes an eviction that never happened.`,
    );
    check(
      isArtifactRef(meta.ref),
      `put minted ${JSON.stringify(meta.ref)}, which is not a ref of this port's grammar ` +
        `('art_' + 22 base62). The model speaks these strings; a store that mints its own ` +
        `spelling makes every consumer parse two.`,
    );
    check(
      meta.kind === 'dataset/rows' && meta.label === 'Q3 rows',
      `the ticket came back as kind=${JSON.stringify(meta.kind)} label=${JSON.stringify(
        meta.label,
      )}. ` +
        `kind is the consumer vocabulary a redeemer decides from — a store may not rewrite it.`,
    );
    check(
      meta.bytes === JSON.stringify(data).length,
      `meta.bytes = ${String(meta.bytes)} for a payload of ${JSON.stringify(data).length} bytes. ` +
        `bytes is what a consumer decides from without paying for the payload; a wrong count is ` +
        `a wrong decision every time.`,
    );
    check(
      typeof meta.createdAt === 'number' && Number.isFinite(meta.createdAt),
      `meta.createdAt = ${String(meta.createdAt)} is not a unix-ms timestamp.`,
    );

    const described = await store.head(scope, meta.ref);
    check(described !== null, 'head() answered null for an artifact that was just stored.');
    check(
      described.ref === meta.ref && described.kind === 'dataset/rows',
      `head() described a different artifact (${JSON.stringify(described.ref)}).`,
    );
    check(
      !('data' in (described as object)) && !('payload' in (described as object)),
      `head() carried the payload. head IS the render-by-ref decision — a consumer picks what ` +
        `to do from kind and bytes WITHOUT paying for the bytes, and a head that ships them ` +
        `costs exactly what the claim check was built to avoid.`,
    );

    const got = await store.get(scope, meta.ref);
    check(got !== null, 'get() answered null for an artifact that was just stored.');
    check(got.meta.ref === meta.ref, 'get() answered a record whose ticket is a different ref.');
    check(
      sameValue(got.data, data),
      `get() answered ${JSON.stringify(got.data)} for a payload of ${JSON.stringify(data)}. ` +
        `The one thing a claim check must never do is honor a ticket with somebody else's parcel.`,
    );
  },
};

const payloadShapes: ArtifactStoreCase = {
  name: 'payloads-round-trip-as-the-value-they-were-given',
  law: 'JSON, text and binary payloads come back as the values they went in as — never an approximation.',
  async run(store, kit) {
    const scope = kit.scope('shapes');
    const shapes: ReadonlyArray<[string, unknown, string]> = [
      ['json', { a: [1, 2], b: 'x' }, 'application/json'],
      ['text', 'plain, with an em-dash — and a ünicode name', 'text/plain'],
      // 0 and 255 included on purpose: a store that round-trips bytes through
      // a string encoding loses exactly these.
      ['binary', new Uint8Array([0, 1, 2, 250, 255]), 'application/octet-stream'],
    ];
    for (const [kind, data, mediaType] of shapes) {
      const { meta } = await store.put(scope, { kind, mediaType, data });
      const got = await store.get(scope, meta.ref);
      check(
        got !== null && sameValue(got.data, data),
        `a ${kind} payload came back as ${JSON.stringify(got?.data)}. A store may re-encode a ` +
          `payload for its own storage; it may not hand back a different value.`,
      );
      check(
        got.meta.mediaType === mediaType,
        `the mediaType came back as ${JSON.stringify(got.meta.mediaType)} and ` +
          `${JSON.stringify(mediaType)} went in — a consumer decodes from that field.`,
      );
    }
  },
};

const refsAreMinted: ArtifactStoreCase = {
  name: 'refs-are-minted-never-derived-from-the-payload',
  law: 'A ref is MINTED and opaque: identical bytes stored twice are two artifacts with two refs, and neither ref describes its payload.',
  async run(store, kit) {
    const scope = kit.scope('minted');
    const data = { the: 'same', bytes: [1, 2, 3] };
    const first = await store.put(scope, { kind: 'k', mediaType: 'application/json', data });
    const second = await store.put(scope, { kind: 'k', mediaType: 'application/json', data });

    check(
      first.meta.ref !== second.meta.ref,
      `storing identical bytes twice returned ONE ref (${first.meta.ref}). Content addressing ` +
        `looks like a saving and is a defect here: it folds two tenants' identical payloads ` +
        `into one object, and it can never name two generations of "the current dataset".`,
    );
    // Both are real, and deleting one leaves the other — the practical half of
    // the same law, and the half a de-duplicating store silently breaks.
    await store.delete(scope, first.meta.ref);
    check(
      (await store.get(scope, first.meta.ref)) === null,
      'delete() left the first artifact readable.',
    );
    const survivor = await store.get(scope, second.meta.ref);
    check(
      survivor !== null && sameValue(survivor.data, data),
      'deleting one artifact took its identical twin with it — which is what a store that ' +
        'keyed on the payload would do, and it means one caller can delete another’s data by ' +
        'storing the same bytes.',
    );

    // Opaque, and cheap to check: the ref is not the digest wearing a prefix,
    // which is the shape a content-addressed store arrives in.
    const digested = await store.put(scope, {
      kind: 'k',
      mediaType: 'application/json',
      data,
      digest: 'sha-256',
    });
    check(
      !(digested.meta.digest ?? '').includes(digested.meta.ref.slice(4, 14)),
      `the ref ${JSON.stringify(digested.meta.ref)} is derived from the payload's digest. The ` +
        `digest is METADATA, never the key: content as key collides two tenants' identical ` +
        `bytes into one object and can never name two generations of "the current dataset".`,
    );
  },
};

const refAloneOpensNothing: ArtifactStoreCase = {
  name: 'a-ref-alone-opens-nothing',
  law: 'A ref is not an authorization: under any other scope it heads, gets, lists and deletes as if it never existed.',
  async run(store, kit) {
    const owner = kit.scope('owner');
    const { meta } = await store.put(owner, {
      kind: 'dataset/rows',
      mediaType: 'text/plain',
      data: 'confidential to the owning scope',
    });

    // Every neighbour a scope tuple has: another conversation, another tenant,
    // another principal. Each one holds the ref and must get nothing.
    const neighbours: ReadonlyArray<[string, ArtifactScope]> = [
      ['another conversation', kit.scope('neighbour')],
      ['another tenant', { ...owner, tenant: `${kit.token}-t2` }],
      ['another principal', { ...owner, principal: `${kit.token}-p2` }],
    ];
    for (const [what, neighbour] of neighbours) {
      check(
        (await store.get(neighbour, meta.ref)) === null,
        `get() from ${what} answered the artifact. Scope is the first argument of every verb ` +
          `precisely so a ref that leaks — into a log, a transcript, a screenshot — is not a ` +
          `key to somebody else's data.`,
      );
      check(
        (await store.head(neighbour, meta.ref)) === null,
        `head() from ${what} described the artifact. A description is a disclosure: kind, ` +
          `label and bytes are exactly what an attacker holding a ref wants.`,
      );
      check(
        (await store.list(neighbour)).artifacts.length === 0,
        `list() from ${what} carried the owner's rows.`,
      );
      // And a neighbour must not be able to DELETE it either — the verb that
      // leaves no trace to notice afterwards.
      await store.delete(neighbour, meta.ref);
    }

    const still = await store.get(owner, meta.ref);
    check(
      still !== null && still.data === 'confidential to the owning scope',
      'the owning scope lost the artifact — either a neighbour deleted it, or the store ' +
        'answers the wrong scope. Both are the same defect from the other side.',
    );
  },
};

const confusableScopes: ArtifactStoreCase = {
  name: 'confusable-scopes-are-not-one-scope',
  law: 'Two DIFFERENT scope tuples that a naive encoder spells identically stay two scopes.',
  async run(store, kit) {
    // The scope tuple IS the isolation boundary, so the way it becomes an
    // address has to be injective. Each pair below is two DIFFERENT tuples a
    // naive encoder folds into one: the separator donated by a value (a JWT
    // `sub` is routinely a URI), the absence marker worn by a real name, and a
    // value that already looks escaped.
    //
    // The unique token goes in the field the pair holds EQUAL — putting it in
    // a field the pair varies would pull the two spellings apart and quietly
    // make the case unfalsifiable.
    const t = kit.token;
    const pairs: ReadonlyArray<[string, ArtifactScope, ArtifactScope]> = [
      [
        'a slash inside a tenant vs. the same slash inside a principal',
        { tenant: 'acme/hr', principal: 'alice', conversationId: t },
        { tenant: 'acme', principal: 'hr/alice', conversationId: t },
      ],
      [
        'a slash inside a principal vs. the same slash inside a conversation',
        { tenant: t, principal: 'alice/c1', conversationId: 'x' },
        { tenant: t, principal: 'alice', conversationId: 'c1/x' },
      ],
      [
        'no tenant vs. a tenant literally named _',
        { conversationId: t },
        { tenant: '_', principal: '_', conversationId: t },
      ],
      [
        'a value that already looks escaped vs. the value it would decode to',
        { tenant: 'a%2Fb', conversationId: t },
        { tenant: 'a/b', conversationId: t },
      ],
      // Case, in all three fields. A scope encoding can be injective as a
      // STRING and still put two tenants in one directory, because macOS and
      // Windows are case-insensitive by default — so the name the filesystem
      // actually distinguishes is the one that has to differ. This battery ran
      // green for months with that leak live, for want of these three rows.
      [
        'a tenant differing only in case',
        { tenant: 'Acme', principal: 'alice', conversationId: t },
        { tenant: 'acme', principal: 'alice', conversationId: t },
      ],
      [
        'a principal differing only in case',
        { tenant: t, principal: 'Alice', conversationId: 'c1' },
        { tenant: t, principal: 'alice', conversationId: 'c1' },
      ],
      [
        'a conversation differing only in case',
        { tenant: t, principal: 'alice', conversationId: 'C1' },
        { tenant: t, principal: 'alice', conversationId: 'c1' },
      ],
    ];

    for (const [what, left, right] of pairs) {
      const { meta } = await store.put(left, {
        kind: 'note',
        mediaType: 'text/plain',
        data: 'confidential to the left scope',
      });
      check(
        (await store.get(right, meta.ref)) === null &&
          (await store.head(right, meta.ref)) === null &&
          (await store.list(right)).artifacts.length === 0,
        `two scopes collided when ${what}. Whatever mapping a store uses to make a tuple legal ` +
          `for its backend must be INJECTIVE — a leak closed in one store and left open in ` +
          `another is still a leak, and this one is reachable by choosing a value.`,
      );
      await store.delete(right, meta.ref);
      const owner = await store.get(left, meta.ref);
      check(
        owner !== null && owner.data === 'confidential to the left scope',
        `the neighbour's delete removed the left scope's artifact when ${what}.`,
      );
    }
  },
};

const oneAbsence: ArtifactStoreCase = {
  name: 'missing-expired-and-foreign-scope-are-one-absence',
  law: 'Missing, expired and foreign-scope are ONE indistinguishable answer — `null`, never an error and never a different shape.',
  harnessNeeds: ['advanceTime'],
  async run(store, kit) {
    const scope = kit.scope('absence');
    const elsewhere = kit.scope('elsewhere');

    // Three ways to have nothing, which a caller must not be able to tell
    // apart: distinguishing them is an oracle for another scope's contents.
    const never = 'art_' + 'a'.repeat(22);
    const { meta: expiring } = await store.put(scope, {
      kind: 'k',
      mediaType: 'text/plain',
      data: 'briefly here',
      // Relative to the STORE's clock, not this process's: a store on an
      // injected clock and a store on the wall clock are both entitled to
      // their own idea of now, and the battery reads it the one way the port
      // exposes it (the `createdAt` a store stamps).
      expiresAt: (await kit.now(store)) + 60_000,
    });
    const { meta: foreign } = await store.put(elsewhere, {
      kind: 'k',
      mediaType: 'text/plain',
      data: "somebody else's",
    });
    check(
      (await store.get(scope, expiring.ref)) !== null,
      'the artifact was gone before its stated expiry.',
    );
    await kit.advance(store, 60_001);

    for (const [what, ref] of [
      ['a ref that was never minted here', never],
      ['an EXPIRED artifact', expiring.ref],
      ["another scope's artifact", foreign.ref],
    ] as const) {
      for (const verb of ['get', 'head'] as const) {
        const { value, error } = await settle<unknown>(() =>
          verb === 'get' ? store.get(scope, ref) : store.head(scope, ref),
        );
        check(
          error === undefined,
          `${verb}() of ${what} THREW ${textOf(error)}. An absence is answered, not thrown — a ` +
            `caller that must catch to find out whether data exists has an error channel that ` +
            `means two different things.`,
        );
        check(
          value === null,
          `${verb}() of ${what} answered ${JSON.stringify(value)} instead of null. "No data" is ` +
            `the only actionable fact, and telling the three apart lets a caller reason about a ` +
            `scope it is not allowed to read.`,
        );
      }
    }

    // A malformed ref is the same absence, not a validation error: the model
    // speaks these strings, and a hallucinated one must read as "no data".
    check(
      (await store.get(scope, 'not-a-ref')) === null &&
        (await store.head(scope, 'not-a-ref')) === null,
      'a ref that is not of this grammar was not answered as absent. A model can say anything; ' +
        'the honest answer to a ref that resolves to nothing is always the same one.',
    );
  },
};

const expiryIsStated: ArtifactStoreCase = {
  name: 'expiry-is-stated-at-mint-never-sprung',
  law: 'Expiry is STATED on the ticket at mint — the store may only TIGHTEN a caller’s time — and an artifact born expired is refused.',
  async run(store, kit) {
    const scope = kit.scope('expiry');
    // The store's own clock (see `missing-expired-…` for why it is read this
    // way and not from this process).
    const storeNow = await kit.now(store);
    const stated = storeNow + 60_000;
    const { meta } = await store.put(scope, {
      kind: 'k',
      mediaType: 'text/plain',
      data: 'x',
      expiresAt: stated,
    });
    check(
      meta.expiresAt !== undefined,
      'a put that STATED an expiry came back with no expiresAt on the ticket. Expiry a ' +
        'consumer cannot read is expiry sprung on them — the ref simply stops resolving one ' +
        'day and nothing in the ticket ever said it would.',
    );
    check(
      meta.expiresAt <= stated,
      `the ticket says the artifact expires at ${String(meta.expiresAt)}, LATER than the ` +
        `${String(stated)} the caller stated. A store's own retention may only tighten a ` +
        `caller's promise; extending it keeps data somebody asked to have dropped.`,
    );
    // The same fact from head, because head is what a later consumer reads.
    const described = await store.head(scope, meta.ref);
    check(
      described?.expiresAt === meta.expiresAt,
      `head() reports expiresAt=${String(described?.expiresAt)} and the mint said ` +
        `${String(meta.expiresAt)}. One artifact, one expiry.`,
    );

    const born = await attempt(() =>
      store.put(scope, {
        kind: 'k',
        mediaType: 'text/plain',
        data: 'x',
        expiresAt: storeNow - 60_000,
      }),
    );
    check(
      isRefusal(born, 'invalid'),
      `a put whose expiry is already in the past was answered with ${textOf(born)}. An artifact ` +
        `born expired resolves for nobody; storing one hands back a ticket that was never ` +
        `redeemable.`,
    );
  },
};

const deleteIsAgreement: ArtifactStoreCase = {
  name: 'delete-removes-and-deleting-an-absence-is-agreement',
  law: 'delete removes the artifact, and deleting what is not there is agreement rather than an error.',
  async run(store, kit) {
    const scope = kit.scope('delete');
    const { meta } = await store.put(scope, { kind: 'k', mediaType: 'text/plain', data: 'x' });
    await store.delete(scope, meta.ref);
    check(
      (await store.get(scope, meta.ref)) === null && (await store.head(scope, meta.ref)) === null,
      'delete() left the artifact readable. A deletion that does not delete is the kind of ' +
        'thing a person finds out about from a regulator.',
    );
    check(
      (await store.list(scope)).artifacts.length === 0,
      'delete() removed the payload and left the ticket in the listing — a pane then offers a ' +
        'row nobody can open.',
    );

    // A retry, a double-click and a cleanup job all do this. So does a caller
    // holding a ref the model invented.
    for (const [what, ref] of [
      ['the same ref twice', meta.ref],
      ['a ref that never existed', 'art_' + 'b'.repeat(22)],
      ['a string that is not a ref at all', 'not-a-ref'],
    ] as const) {
      const err = await attempt(() => store.delete(scope, ref));
      check(
        err === undefined,
        `delete() of ${what} threw ${textOf(err)}. Deleting an absence is not an error, it is ` +
          `agreement — and a cleanup path that throws is a cleanup path somebody wraps in an ` +
          `empty catch.`,
      );
    }
  },
};

const listPages: ArtifactStoreCase = {
  name: 'list-pages-newest-first-and-carries-no-payload',
  law: 'list pages this scope only, newest first, every row exactly once, with a cursor ONLY when more rows exist — and never a payload.',
  harnessNeeds: ['advanceTime'],
  async run(store, kit) {
    const scope = kit.scope('listing');
    const neighbour = kit.scope('not-listed');
    const order: string[] = [];
    for (let n = 0; n < 5; n++) {
      const { meta } = await store.put(scope, {
        kind: `k${n}`,
        mediaType: 'text/plain',
        data: `v${n}`,
      });
      order.unshift(meta.ref); // newest first, as the listing must answer
      // A store whose order is a timestamp needs the timestamps to differ; one
      // whose order is insertion does not care. Both are held to the same
      // answer, which is the point of asking through the port.
      await kit.advance(store, 10);
    }
    await store.put(neighbour, { kind: 'theirs', mediaType: 'text/plain', data: 'x' });

    const { refs, pages } = await allPages(store, scope, 2);
    check(
      new Set(refs).size === refs.length,
      `paging repeated a row (${refs.join(', ')}). A cursor over equal timestamps needs a ` +
        `second, total ordering or a row lands on both sides of a page boundary.`,
    );
    check(
      refs.length === 5,
      `paging saw ${refs.length} of 5 rows. A listing that loses a row is a pane missing an ` +
        `artifact nobody can explain.`,
    );
    check(
      refs.join(',') === order.join(','),
      `the listing was not newest-first. Got ${refs.join(', ')}; expected ${order.join(', ')}. ` +
        `Newest-first is the order every listing in this package promises.`,
    );
    const last = pages[pages.length - 1];
    check(
      last?.cursor === undefined,
      'the final page still carried a cursor. A cursor promises MORE, so one on the last page ' +
        'is a "load more" that loads nothing.',
    );
    for (const page of pages.slice(0, -1)) {
      check(
        page.cursor !== undefined,
        'a non-final page carried no cursor, so the rows after it are unreachable.',
      );
    }
    for (const row of pages[0]!.artifacts) {
      check(
        !('data' in (row as object)),
        `a listing row carried its payload. A listing is tickets — bytes never ride one, or ` +
          `drawing a pane costs what the claim check was built to avoid.`,
      );
    }
    const theirs = await store.list(neighbour);
    check(
      theirs.artifacts.length === 1,
      `the neighbouring scope listed ${theirs.artifacts.length} rows instead of its own one. ` +
        `A listing IS the permission check for everything downstream of it.`,
    );
  },
};

const awkwardScopes: ArtifactStoreCase = {
  name: 'awkward-scope-values-are-names-not-paths',
  law: 'A scope value is opaque DATA: slashes, dots, unicode and long values address one scope and never a place the store did not intend.',
  async run(store, kit) {
    // Every one of these is a value a real identity system hands over: a `sub`
    // that is a URI, a tenant named after a path, a display name with an
    // emoji. They arrive as data and must land as literals.
    //
    // Each entry takes the run token and decides WHERE to put it, because the
    // namespacing must not land on the field whose spelling is under test —
    // prefixing an "empty conversation id" would quietly make it non-empty and
    // the case would prove nothing.
    const awkward: ReadonlyArray<[string, (token: string) => ArtifactScope]> = [
      [
        'slashes in every field',
        (t) => ({ tenant: 'a/b', principal: 'c/d', conversationId: `${t}/e/f` }),
      ],
      [
        'parent-directory hops',
        (t) => ({ tenant: '..', principal: '.', conversationId: `${t}/../..` }),
      ],
      ['unicode and an emoji', (t) => ({ tenant: 'ünïcødé-😀', conversationId: `${t}-😀` })],
      ['a backslash and a quote', (t) => ({ tenant: 'a\\b', principal: `q'"`, conversationId: t })],
      [
        'a value that reads as SQL',
        (t) => ({ conversationId: `${t}'; DROP TABLE af_artifacts; --` }),
      ],
      ['an empty conversation id', (t) => ({ tenant: t, conversationId: '' })],
      // 200 rather than 1000: a store whose scope becomes a DIRECTORY has a
      // 255-byte component ceiling it cannot argue with, and a battery that
      // demanded more would be testing the filesystem rather than the port.
      // The law is "long values are not truncated INTO EACH OTHER", checked
      // below, and 200 shows that on every column.
      ['a very long tenant', (t) => ({ tenant: 'x'.repeat(200), conversationId: t })],
    ];

    for (const [what, build] of awkward) {
      const scope = build(kit.token);
      const { meta } = await store.put(scope, {
        kind: 'k',
        mediaType: 'text/plain',
        data: `stored under ${what}`,
      });
      const got = await store.get(scope, meta.ref);
      check(
        got !== null && got.data === `stored under ${what}`,
        `a scope with ${what} did not round-trip: get() answered ${JSON.stringify(got?.data)}. ` +
          `A scope value is somebody's opaque string; a store that mangles it hands them a ` +
          `different scope's data or none of their own.`,
      );
      check(
        (await store.list(scope)).artifacts.length === 1,
        `a scope with ${what} stored an artifact its own listing cannot see.`,
      );
    }

    // Two long values that a truncating store folds together — the failure
    // mode a length ceiling introduces if it is met by cutting rather than by
    // refusing.
    const long = 'y'.repeat(190);
    const left: ArtifactScope = { tenant: `${long}-left`, conversationId: kit.token };
    const right: ArtifactScope = { tenant: `${long}-right`, conversationId: kit.token };
    const { meta } = await store.put(left, { kind: 'k', mediaType: 'text/plain', data: 'left' });
    check(
      (await store.get(right, meta.ref)) === null,
      'two long tenants that differ only in their last characters became ONE scope. A store ' +
        'that truncates a name to fit its backend has turned a ceiling into a leak.',
    );
  },
};

const oversizedRefused: ArtifactStoreCase = {
  name: 'oversized-payload-is-refused-before-the-write',
  law: 'A payload larger than the whole scope budget is refused BEFORE the write, and nothing partial lands.',
  harnessNeeds: ['boundedStore'],
  async run(_store, kit) {
    const bounded = await kit.bounded(64);
    const scope = kit.scope('ceiling');
    const { meta: kept } = await bounded.put(scope, {
      kind: 'keeper',
      mediaType: 'text/plain',
      data: 'small',
    });

    const err = await attempt(() =>
      bounded.put(scope, { kind: 'oversized', mediaType: 'text/plain', data: 'x'.repeat(500) }),
    );
    check(
      isRefusal(err, 'invalid'),
      `a payload larger than the entire scope budget was answered with ${textOf(err)}. Evicting ` +
        `a whole scope to admit one object that may not fit either trades everything for ` +
        `nothing — the honest answer is a refusal at the door.`,
    );

    // "Nothing partial lands" is the half that matters, and the half a store
    // that checks the budget AFTER writing gets wrong.
    const survivor = await bounded.get(scope, kept.ref);
    check(
      survivor !== null && survivor.data === 'small',
      'the refused put evicted what was already there. A put that cannot be honored must not ' +
        'be able to empty a scope on its way out.',
    );
    const listing = await bounded.list(scope);
    check(
      listing.artifacts.length === 1 && listing.artifacts[0]!.ref === kept.ref,
      `after the refusal the scope holds ${listing.artifacts.length} artifacts. A refused put ` +
        `leaves no ticket behind — a half-written artifact is a ref that resolves to bytes ` +
        `nobody vouched for.`,
    );
  },
};

const parentRefsProven: ArtifactStoreCase = {
  name: 'parent-refs-are-proven-at-mint',
  law: 'parentRefs are derivation FACTS proven at mint: a parent that does not resolve IN THE SAME SCOPE refuses the put and stores nothing.',
  async run(store, kit) {
    const scope = kit.scope('lineage');
    const elsewhere = kit.scope('other-lineage');
    const { meta: parent } = await store.put(scope, {
      kind: 'dataset/rows',
      mediaType: 'text/plain',
      data: 'the source',
    });
    const { meta: child } = await store.put(scope, {
      kind: 'chart/spec',
      mediaType: 'application/json',
      data: {},
      parentRefs: [parent.ref],
    });
    check(
      child.parentRefs?.length === 1 && child.parentRefs[0] === parent.ref,
      `the child's parentRefs came back as ${JSON.stringify(child.parentRefs)}. Derivation ` +
        `facts are the join a consumer folds over head() — a store that drops them drops the ` +
        `only record of where a number came from.`,
    );
    check(
      (await store.head(scope, child.ref))?.parentRefs?.[0] === parent.ref,
      'head() described the child without the parents its own mint accepted.',
    );

    const unknown = await attempt(() =>
      store.put(scope, {
        kind: 'k',
        mediaType: 'text/plain',
        data: 'x',
        parentRefs: ['art_' + 'c'.repeat(22)],
      }),
    );
    check(
      isRefusal(unknown, 'unknown-parent'),
      `a put naming a parent that does not exist was answered with ${textOf(unknown)}. A ` +
        `foreign key that dangles at birth is worse than no fact: every later consumer ` +
        `inherits the lie.`,
    );

    // A parent in ANOTHER scope does not resolve HERE, and must not — a store
    // that proves parents globally has made the ref a cross-scope oracle.
    const foreign = await attempt(() =>
      store.put(elsewhere, {
        kind: 'k',
        mediaType: 'text/plain',
        data: 'x',
        parentRefs: [parent.ref],
      }),
    );
    check(
      isRefusal(foreign, 'unknown-parent'),
      `a put naming a parent from ANOTHER scope was answered with ${textOf(foreign)}. Proving ` +
        `parents outside the scope tells the caller a ref exists somewhere, which is the one ` +
        `fact scope isolation exists to withhold.`,
    );
    check(
      (await store.list(elsewhere)).artifacts.length === 0,
      'a put refused for a dangling parent stored the artifact anyway.',
    );
  },
};

const malformedRefused: ArtifactStoreCase = {
  name: 'malformed-puts-are-refused-by-name',
  law: 'A put this store cannot honor AS STATED is refused by name, and stores nothing.',
  async run(store, kit) {
    const scope = kit.scope('malformed');
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const malformed: ReadonlyArray<[string, Record<string, unknown>]> = [
      ['a blank kind', { kind: '', mediaType: 'text/plain', data: 'x' }],
      ['a blank mediaType', { kind: 'k', mediaType: '   ', data: 'x' }],
      [
        'an unknown digest algorithm',
        { kind: 'k', mediaType: 'text/plain', data: 'x', digest: 'md5' },
      ],
      // A payload the durable columns cannot carry. Refused everywhere on
      // purpose: a store that accepts what only IT can hold breaks the port's
      // one promise — swap the adapter and nothing else changes.
      ['a payload JSON cannot carry', { kind: 'k', mediaType: 'application/json', data: cyclic }],
      ['a function as a payload', { kind: 'k', mediaType: 'application/json', data: () => 1 }],
    ];

    for (const [what, input] of malformed) {
      const err = await attempt(() => store.put(scope, input as never));
      check(
        isRefusal(err, 'invalid'),
        `a put with ${what} was answered with ${textOf(err)}. Storing an approximation of what ` +
          `a caller asked for is the accepted-and-silently-wrong failure — the one a caller ` +
          `finds out about from their own users.`,
      );
    }
    check(
      (await store.list(scope)).artifacts.length === 0,
      'a refused put left a ticket in the scope. A refusal that stores half an artifact is ' +
        'not a refusal.',
    );
  },
};

const refusalsKeepSecrets: ArtifactStoreCase = {
  name: 'refusals-carry-no-payload-and-no-scope',
  law: 'A refusal teaches what to do without quoting the payload, the tenant or the principal.',
  async run(store, kit) {
    // A refusal is read by whoever provoked it, and often lands in a log the
    // caller does not own. It must not be a way to find out who is signed in,
    // which tenant a store holds, or what was inside somebody's dataset.
    const secrets = {
      tenant: `${kit.token}-acme-payroll`,
      principal: `${kit.token}-alice@example.com`,
      conversationId: `${kit.token}-c9`,
    };
    const payload = 'SALARY-BAND-7-CONFIDENTIAL';
    const storeNow = await kit.now(store);

    const provoked: unknown[] = [];
    provoked.push(
      await attempt(() =>
        store.put(secrets, {
          kind: 'k',
          mediaType: 'text/plain',
          data: payload,
          parentRefs: ['art_' + 'd'.repeat(22)],
        }),
      ),
    );
    provoked.push(
      await attempt(() => store.put(secrets, { kind: '', mediaType: 'text/plain', data: payload })),
    );
    provoked.push(
      await attempt(() =>
        store.put(secrets, {
          kind: 'k',
          mediaType: 'text/plain',
          data: payload,
          expiresAt: storeNow - 60_000,
        }),
      ),
    );

    for (const err of provoked) {
      check(err !== undefined, 'a put this battery expected to be refused was accepted.');
      const text = textOf(err);
      for (const [what, secret] of [
        ['the payload', payload],
        ['the tenant', secrets.tenant],
        ['the principal', secrets.principal],
      ] as const) {
        check(
          !text.includes(secret),
          `a refusal quotes ${what}. Provoking an error must not be a way to read one — the ` +
            `message travels into logs, transcripts and screenshots that the data's owner ` +
            `never sees.\n  message: ${text}`,
        );
      }
    }
  },
};

const digestRidesTheTicket: ArtifactStoreCase = {
  name: 'digest-is-minted-over-the-payload-and-rides-the-ticket',
  law: 'A requested digest is computed over the payload at put, rides every ticket, and is the SAME for the same bytes.',
  async run(store, kit) {
    const scope = kit.scope('digest');
    const { meta } = await store.put(scope, {
      kind: 'k',
      mediaType: 'application/json',
      data: { n: 7 },
      digest: 'sha-256',
    });
    check(
      /^sha-256:[0-9a-f]{64}$/.test(meta.digest ?? ''),
      `the minted digest is ${JSON.stringify(meta.digest)}. One algorithm, one spelling — a ` +
        `consumer comparing two stores' digests must not have to normalise them first.`,
    );
    const twin = await store.put(scope, {
      kind: 'k',
      mediaType: 'application/json',
      data: { n: 7 },
      digest: 'sha-256',
    });
    check(
      twin.meta.digest === meta.digest,
      `the same bytes digested to two values (${String(meta.digest)} / ` +
        `${String(twin.meta.digest)}). The digest is what makes an idempotent re-put ` +
        `detectable; a digest that is per-artifact is a random number with a hex format.`,
    );
    const other = await store.put(scope, {
      kind: 'k',
      mediaType: 'application/json',
      data: { n: 8 },
      digest: 'sha-256',
    });
    check(other.meta.digest !== meta.digest, 'two different payloads digested to the same value.');

    const got = await store.get(scope, meta.ref);
    check(
      got !== null && sameValue(got.data, { n: 7 }),
      'a whole, digested artifact did not read back. get() verifies the digest silently when ' +
        'the payload is intact; a refusal here means the store disagrees with its own mint.',
    );
    check(
      (await store.head(scope, meta.ref))?.digest === meta.digest,
      'head() described the artifact without the digest its own mint stamped — which is the ' +
        'value a streaming caller is told to check for itself.',
    );
    // Absent when not asked for: a digest nobody requested is a cost nobody
    // agreed to, and an absent field is a fact.
    const plain = await store.put(scope, { kind: 'k', mediaType: 'text/plain', data: 'x' });
    check(
      plain.meta.digest === undefined,
      `a put that did not ask for a digest came back with ${JSON.stringify(plain.meta.digest)}.`,
    );
  },
};

const getVerifiesDigest: ArtifactStoreCase = {
  name: 'get-refuses-a-payload-that-no-longer-matches-its-digest',
  law: 'get is the VERIFYING read: bytes that no longer match their minted digest are refused by name, never returned as if whole.',
  harnessNeeds: ['corrupt'],
  async run(store, kit) {
    const scope = kit.scope('integrity');
    const { meta } = await store.put(scope, {
      kind: 'report/csv',
      mediaType: 'text/plain',
      data: 'true bytes',
      digest: 'sha-256',
    });
    await kit.corrupt(store, scope, meta.ref);

    const err = await attempt(() => store.get(scope, meta.ref));
    check(
      isRefusal(err, 'integrity'),
      `get() of a payload that no longer matches its minted digest answered ${textOf(err)}. ` +
        `Corrupt data delivered as whole data is the one thing a claim check must never do: ` +
        `honor a ticket with somebody else's parcel.`,
    );
    // The ticket survives its parcel — a caller can still see WHAT it was, and
    // re-create it from its source.
    const described = await store.head(scope, meta.ref);
    check(
      described !== null && described.digest === meta.digest,
      'the integrity refusal took the ticket with it. head() is how a caller learns what was ' +
        'lost and where it came from; a store that hides the meta leaves them guessing.',
    );
  },
};

const getStreamDoesNotVerify: ArtifactStoreCase = {
  name: 'get-stream-does-not-verify-the-digest',
  law: 'getStream bounds memory, NOT integrity: it hands over the bytes it holds, unverified and unhidden, with the digest still on the ticket.',
  members: ['getStream'],
  harnessNeeds: ['corrupt'],
  async run(store, kit) {
    // The asymmetry is a PROMISE, pinned here so a store cannot quietly close
    // it either way. Verifying needs the whole payload — the exact cost this
    // member exists to avoid — so a store that "fixed" it would have bought
    // the guarantee with the memory a caller chose this member to save, while
    // a store that also dropped the digest from the ticket would leave the
    // caller no way to check for themselves.
    const scope = kit.scope('stream-integrity');
    const { meta } = await store.put(scope, {
      kind: 'report/csv',
      mediaType: 'text/plain',
      data: 'true bytes',
      digest: 'sha-256',
    });
    await kit.corrupt(store, scope, meta.ref);

    const streamed = await store.getStream!(scope, meta.ref);
    check(
      streamed !== null,
      'getStream() answered null for an artifact that is present. Its `null` means ' +
        'missing-or-expired, exactly like get() — a damaged payload is neither.',
    );
    const bytes = await drain(streamed.body);
    check(
      bytes !== 'true bytes',
      'the harness did not actually change the stored payload, so this case proved nothing. ' +
        'corrupt() must replace the bytes behind the store’s back.',
    );
    check(
      streamed.meta.digest === meta.digest,
      `the streamed ticket carries digest ${JSON.stringify(streamed.meta.digest)} and the mint ` +
        `stamped ${JSON.stringify(meta.digest)}. The digest rides ANYWAY so a caller who needs ` +
        `the guarantee can hash what it collected and compare — drop it and the loss stops ` +
        `being named and starts being hidden.`,
    );
    // And the verifying read still refuses, so the two members really are the
    // two different promises the port says they are.
    check(
      isRefusal(await attempt(() => store.get(scope, meta.ref)), 'integrity'),
      'getStream handed the bytes over unverified AND get accepted them. Then there is no ' +
        'verifying read at all, and the trade this case exists to pin was never made.',
    );
  },
};

const streamedPut: ArtifactStoreCase = {
  name: 'streamed-put-round-trips-and-declares-its-bytes',
  law: 'A streamed put stores what it streamed under a ticket the other five verbs answer for, and a payload that contradicts its DECLARED bytes is refused.',
  members: ['putStream'],
  async run(store, kit) {
    const scope = kit.scope('streamed');
    const chunks = ['col_a,col_b\n', '1,2\n', '3,4\n'];
    const whole = chunks.join('');
    const { meta, swept } = await store.putStream!(
      scope,
      { kind: 'report/csv', mediaType: 'text/csv', bytes: whole.length, label: 'Q3 export' },
      streamOf(chunks),
    );
    check(
      isArtifactRef(meta.ref) && meta.bytes === whole.length && meta.label === 'Q3 export',
      `a streamed put minted ${JSON.stringify(meta.ref)} with bytes=${String(meta.bytes)} ` +
        `(declared ${whole.length}). bytes is STAMPED from the declaration here, because ` +
        `retention has to plan before the payload arrives.`,
    );
    check(Array.isArray(swept), 'a streamed put did not report what retention swept.');

    // The other five verbs do not know how the payload arrived.
    check(
      (await store.head(scope, meta.ref))?.kind === 'report/csv',
      'head() did not describe a streamed artifact.',
    );
    const got = await store.get(scope, meta.ref);
    const read = got?.data instanceof Uint8Array ? new TextDecoder().decode(got.data) : got?.data;
    check(
      read === whole,
      `get() of a streamed artifact answered ${JSON.stringify(read)}. A payload that arrived in ` +
        `chunks is one payload; how it got there is the adapter's business.`,
    );
    check(
      (await store.list(scope)).artifacts.some((row) => row.ref === meta.ref),
      'a streamed artifact is missing from its own scope’s listing.',
    );

    // A declaration the payload contradicts is refused — a meta that lies
    // about its own payload is worse than no artifact, because retention
    // planned against it and every consumer reads it.
    const lying = await attempt(() =>
      store.putStream!(
        scope,
        { kind: 'report/csv', mediaType: 'text/csv', bytes: 9_999 },
        streamOf(chunks),
      ),
    );
    check(
      lying !== undefined,
      'a streamed put whose payload did not match its declared bytes was accepted. The ticket ' +
        'then misdescribes the artifact for every later consumer, and retention planned ' +
        'against a number that was never true.',
    );
    check(
      (await store.list(scope)).artifacts.length === 1,
      'the refused streamed put left an artifact behind.',
    );
  },
};

const streamingFeatureDetected: ArtifactStoreCase = {
  name: 'streaming-members-are-feature-detected',
  law: 'The optional members are present as functions or ABSENT — never something a caller has to guess about, and never faked over bytes already held whole.',
  async run(store, kit) {
    for (const member of ['putStream', 'getStream'] as const) {
      const value = store[member];
      check(
        value === undefined || typeof value === 'function',
        `'${member}' is present as ${typeof value}. Feature detection reads ` +
          `\`typeof store.${member} === 'function'\`, so a member that is present-but-not-a-` +
          `function is detected as available and then fails at the door.`,
      );
    }
    if (store.getStream !== undefined) {
      // `null` means missing-or-expired here too, so a caller can branch on one
      // rule for both readers.
      const scope = kit.scope('stream-absence');
      check(
        (await store.getStream(scope, 'art_' + 'e'.repeat(22))) === null &&
          (await store.getStream(scope, 'not-a-ref')) === null,
        'getStream() did not answer null for a ref that resolves to nothing. It answers the ' +
          'same absence get() does, or a caller needs two rules for one fact.',
      );
    }
  },
};

/**
 * The battery, in the order a store fails it most usefully: the round trip
 * before the isolation built on it, isolation before the refusals, refusals
 * before integrity, and the optional streaming leg last.
 */
export const artifactStoreConformance: readonly ArtifactStoreCase[] = [
  putHeadGet,
  payloadShapes,
  refsAreMinted,
  refAloneOpensNothing,
  confusableScopes,
  oneAbsence,
  expiryIsStated,
  deleteIsAgreement,
  listPages,
  awkwardScopes,
  oversizedRefused,
  parentRefsProven,
  malformedRefused,
  refusalsKeepSecrets,
  digestRidesTheTicket,
  getVerifiesDigest,
  getStreamDoesNotVerify,
  streamedPut,
  streamingFeatureDetected,
];

export type { ArtifactConformanceKit, ArtifactStoreCase };
