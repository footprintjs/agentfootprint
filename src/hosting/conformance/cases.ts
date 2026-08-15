/**
 * hosting/conformance/cases — the battery itself.
 *
 * Each case holds ONE law of the port and says which one in its `law` field,
 * so a failure reads as a broken promise rather than as a broken assertion.
 * Nothing here imports a test framework: a case throws to fail, which is the
 * one convention every runner in every language already agrees on.
 */

import { envelopeOwner } from '../envelope.js';
import type { CheckpointEnvelope, SessionLifecycle, SessionListPage } from '../types.js';
import type { ConformanceKit, SessionLifecycleCase } from './types.js';

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
 * on its calling convention. That style is its own small defect — a caller
 * then needs two error handlers, and the one they forget is the one that fires
 * at 3am — but it is not the law any of these cases is about.
 */
async function attempt(work: () => unknown): Promise<unknown> {
  try {
    await work();
    return undefined;
  } catch (err) {
    return err;
  }
}

/** The text of the conversation inside an envelope, for round-trip checks. */
function textOf(envelope: CheckpointEnvelope | undefined): string | undefined {
  const data = envelope?.data as { history?: unknown; conversation?: { history?: unknown } };
  const history = envelope?.format === 'flowchart-v1' ? data.conversation?.history : data.history;
  if (!Array.isArray(history)) return undefined;
  const first = history[0] as { content?: unknown } | undefined;
  return typeof first?.content === 'string' ? first.content : undefined;
}

/** Read every page of a listing, so a paging bug shows up as a wrong SET. */
async function allPages(
  store: SessionLifecycle,
  userId: string,
  limit: number,
): Promise<{ ids: string[]; pages: SessionListPage[] }> {
  const ids: string[] = [];
  const pages: SessionListPage[] = [];
  let cursor: string | undefined;
  // A bound, not a `while (true)`: a store whose cursor never terminates
  // should fail this case, not hang the suite that was checking it.
  for (let page = 0; page < 50; page++) {
    const result = await store.listByUser!(userId, { limit, ...(cursor && { cursor }) });
    pages.push(result);
    for (const row of result.sessions) ids.push(row.sessionId);
    cursor = result.cursor;
    if (cursor === undefined) return { ids, pages };
  }
  throw new Error(
    `listByUser never stopped: 50 pages of ${limit} and the cursor is still present. ` +
      `A cursor is promised only when MORE rows exist, so a listing that keeps handing one ` +
      `back is a sidebar that scrolls forever.`,
  );
}

// ─── The battery ─────────────────────────────────────────────────────

const absentHydratesUndefined: SessionLifecycleCase = {
  name: 'absent-session-hydrates-undefined',
  law: 'Only a session that was never written hydrates as `undefined`.',
  async run(store, kit) {
    const stored = await store.hydrate(kit.id('never-written'));
    check(
      stored === undefined,
      `hydrate() of a session that was never written answered ${JSON.stringify(stored)}. ` +
        `An empty store has to say "nothing here" — anything else and the composer starts a ` +
        `conversation on top of a value it did not understand.`,
    );
  },
};

const roundTrip: SessionLifecycleCase = {
  name: 'persist-hydrate-round-trip',
  law: 'What persist stored is what hydrate answers, and the last write wins.',
  async run(store, kit) {
    const id = kit.id('round-trip');
    const first = kit.envelope('turn one', 'alice');
    await store.persist(id, first);

    const back = await store.hydrate(id);
    check(back !== undefined, 'hydrate() answered undefined for a session that was just written.');
    check(
      back.format === first.format && back.savedAt === first.savedAt,
      `hydrate() answered format='${String(back.format)}' savedAt=${String(back.savedAt)}, ` +
        `and '${first.format}'/${first.savedAt} went in. A store that rewrites either one ` +
        `breaks the reader that branches on format and the listing that sorts on savedAt.`,
    );
    check(
      textOf(back) === 'turn one',
      `the stored conversation came back as ${JSON.stringify(textOf(back))}. ` +
        `A store may re-encode an envelope; it may not change what was said.`,
    );
    check(
      envelopeOwner(back) === 'alice',
      'the identity the conversation was signed with did not survive the round trip — ' +
        'which is the fact every ownership check in this package is derived from.',
    );

    // Last write wins for the PAYLOAD. This is the half the ownership rule
    // deliberately does not touch: turn two replaces turn one.
    await store.persist(id, kit.envelope('turn two', 'alice'));
    check(
      textOf(await store.hydrate(id)) === 'turn two',
      'a second persist did not replace the stored conversation. Every turn after the ' +
        'first is a second persist, so a store that keeps the first one stops the ' +
        'conversation at one exchange.',
    );
  },
};

const unreadableIsNotAbsent: SessionLifecycleCase = {
  name: 'unreadable-is-not-absent',
  law: 'A stored conversation this runtime cannot read is never answered as absent.',
  harnessNeeds: ['corrupt'],
  async run(store, kit) {
    const id = kit.id('corrupted');
    await store.persist(id, kit.envelope('something real', 'alice'));
    await kit.harness.corrupt!(store, id);

    // Either answer holds the law. A store that decodes (a file, a document)
    // refuses BY NAME, so the message points at the store that produced the
    // bytes; a store that hands its value straight back leaves the refusal to
    // the composer's readers. What NEITHER may do is answer `undefined` — that
    // is a fresh start on top of a conversation that exists, and it is
    // invisible from the outside until somebody's history is gone.
    let answered: unknown;
    const err = await attempt(async () => {
      answered = await store.hydrate(id);
    });
    check(
      err !== undefined || answered !== undefined,
      `hydrate() answered \`undefined\` for a session whose stored bytes are not a readable ` +
        `envelope. Absent and unreadable are different facts, and only one of them is safe ` +
        `to answer with a fresh start.`,
    );
  },
};

const forgetRemoves: SessionLifecycleCase = {
  name: 'forget-removes-the-conversation',
  law: 'A store that can forget a session forgets it completely, and forgetting twice is not an error.',
  members: ['forget'],
  async run(store, kit) {
    const forget = (store as SessionLifecycle & { forget(id: string): Promise<void> }).forget.bind(
      store,
    );
    const id = kit.id('forgettable');
    await store.persist(id, kit.envelope('delete me', 'alice'));
    await forget(id);
    check(
      (await store.hydrate(id)) === undefined,
      'forget() left the conversation readable. A deletion that does not delete is the ' +
        'kind of thing a person finds out about from a regulator.',
    );
    if (store.ownerOf !== undefined) {
      check(
        (await store.ownerOf(id)) === undefined,
        'forget() removed the conversation and left the owner index naming somebody. ' +
          'A listing built on that index then points at a session nobody can open.',
      );
    }
    // Idempotent: a retry, a double-click and a cleanup job all do this.
    await forget(id);
  },
};

const ownershipDerived: SessionLifecycleCase = {
  name: 'ownership-is-derived-from-the-envelope',
  law: 'The owner is DERIVED from the stored conversation, never declared by whoever called persist.',
  members: ['ownerOf'],
  async run(store, kit) {
    const signed = kit.id('signed');
    await store.persist(signed, kit.envelope('mine', 'alice'));
    check(
      (await store.ownerOf!(signed)) === 'alice',
      'a conversation signed by somebody came back owned by nobody. The owner is the ' +
        '`principal` on the stored conversation — the composer wrote it there.',
    );

    // A caller cannot state an owner, because there is nowhere to state one:
    // the port takes a session id and an envelope. So the only way to try is
    // to plant the word somewhere and see whether a store reads it. A store
    // that does has built its permission system out of a request field.
    const decoy = kit.id('decoy');
    const envelope = kit.envelope('not mine', 'alice');
    await store.persist(decoy, {
      ...envelope,
      // Two shapes a hopeful caller might try, neither of which is where the
      // identity lives. `unknown` first because the envelope union has no such
      // fields — which is the point: they are not part of the contract, and a
      // store that reads one has invented an API nobody offered.
      owner: 'mallory',
      userId: 'mallory',
    } as unknown as CheckpointEnvelope);
    const owner = await store.ownerOf!(decoy);
    check(
      owner === 'alice',
      `a planted 'owner' field on the envelope was read as the owner (got ` +
        `${JSON.stringify(owner)}). Owning somebody's session must not be a matter of ` +
        `asking for it.`,
    );
  },
};

const ownershipFillsIn: SessionLifecycleCase = {
  name: 'ownership-fills-in-on-a-later-signed-turn',
  law: 'A conversation that ran anonymously and is then signed for gains that owner.',
  members: ['ownerOf'],
  async run(store, kit) {
    const id = kit.id('gains-an-owner');
    await store.persist(id, kit.envelope('who am i'));
    check(
      (await store.ownerOf!(id)) === undefined,
      'an anonymous conversation came back owned by somebody. Inventing an owner is ' +
        'inventing an entitlement.',
    );
    await store.persist(id, kit.envelope('now signed in', 'alice'));
    check(
      (await store.ownerOf!(id)) === 'alice',
      'the FIRST turn that signs for a conversation owns it, and this one did not. ' +
        'A session that gained an identity on turn two must appear in that person’s list.',
    );
  },
};

const leanerTurnKeepsOwner: SessionLifecycleCase = {
  name: 'ownership-survives-a-leaner-turn',
  law: 'A later turn carrying a LEANER identity is stored, and does not erase the owner.',
  members: ['ownerOf'],
  async run(store, kit) {
    const id = kit.id('leaner-turn');
    await store.persist(id, kit.envelope('turn one', 'alice'));

    // The blessed flow, and the reason this suite refuses an absence rather
    // than treating it as a conflict: a turn with no identity claims NOBODY,
    // so it contradicts nobody. Refusing it would break a flow the contract
    // describes as intended, to protect against a claim that was never made.
    const err = await attempt(() => store.persist(id, kit.envelope('turn two')));
    check(
      err === undefined,
      `persisting a turn with no identity onto an owned session was REFUSED (${String(err)}). ` +
        `An absent identity is not a contradiction, and the port blesses this write in as ` +
        `many words. A store that refuses it fails turns that have always worked.`,
    );
    check(
      (await store.ownerOf!(id)) === 'alice',
      'a leaner turn erased the owner. The session would silently drop out of its ' +
        "owner's list, which looks to them exactly like losing the conversation.",
    );
    check(
      textOf(await store.hydrate(id)) === 'turn two',
      'the leaner turn was accepted and then not stored. Keeping the owner is not a ' +
        'reason to drop the conversation.',
    );
    if (store.listByUser !== undefined) {
      const { ids } = await allPages(store, 'alice', 10);
      check(
        ids.includes(id),
        'the owner kept the session and the listing lost it. An index and a listing that ' +
          'disagree is a sidebar missing a conversation nobody can explain.',
      );
    }
  },
};

const differentSignerRefused: SessionLifecycleCase = {
  name: 'ownership-is-not-taken-by-a-different-signer',
  law: 'A turn signed by somebody else is refused WHOLE — the owner index and the stored conversation both.',
  members: ['ownerOf'],
  async run(store, kit) {
    const id = kit.id('contested');
    await store.persist(id, kit.envelope('alice speaking', 'alice'));

    const err = await attempt(() => store.persist(id, kit.envelope('bob speaking', 'bob')));
    check(
      err !== undefined,
      `persisting a conversation signed by a DIFFERENT person onto an owned session was ` +
        `accepted. This is the defect the suite was written for: the write-once rule keeps ` +
        `the first writer in the owner index and stores the second writer's entire ` +
        `conversation, so the owner lists the session, opens it, and reads somebody else's.`,
    );

    // A refusal is read by whoever provoked it. It must teach, and it must
    // not be a way to find out who is signed in or what they said.
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    for (const leak of ['alice', 'bob', 'alice speaking', 'bob speaking']) {
      check(
        !text.toLowerCase().includes(leak),
        `the refusal names '${leak}'. An ownership refusal must carry no principal, no ` +
          `owner and no conversation text — otherwise provoking one is how you find out ` +
          `who owns a session id.`,
      );
    }

    // And the half that matters: refused means NOTHING moved.
    check(
      (await store.ownerOf!(id)) === 'alice',
      'the refusal fired and the owner changed anyway.',
    );
    const back = await store.hydrate(id);
    check(
      textOf(back) === 'alice speaking' && envelopeOwner(back) === 'alice',
      `the refusal fired and the CONVERSATION was replaced anyway (stored: ` +
        `${JSON.stringify(textOf(back))} signed by ${JSON.stringify(envelopeOwner(back))}). ` +
        `Refusing only the index column is the original defect wearing a thrown error.`,
    );
  },
};

const contestedWrite: SessionLifecycleCase = {
  name: 'contested-write-leaves-no-split-brain',
  law: 'However two concurrent writers interleave, the owner index and the stored conversation never name different people.',
  members: ['ownerOf'],
  async run(store, kit) {
    const id = kit.id('race');
    // Both writers, on one FRESH session, started without awaiting the first —
    // the shape a live trial reproduced against a real backend, where both
    // calls fulfilled and the second was genuinely retried.
    const settled = await Promise.all([
      attempt(() => store.persist(id, kit.envelope('alice speaking', 'alice'))),
      attempt(() => store.persist(id, kit.envelope('bob speaking', 'bob'))),
    ]);
    check(
      settled.some((err) => err === undefined),
      `both writers were refused, so nothing was stored at all. One of them was first and ` +
        `is entitled to its conversation; refusing both turns a contested write into an ` +
        `outage.`,
    );

    const owner = await store.ownerOf!(id);
    const signer = envelopeOwner(await store.hydrate(id));
    // The invariant, one-directional on purpose. An index that names somebody
    // over a conversation that names nobody is the leaner-turn state, and it
    // only ever refuses. An index and a conversation naming DIFFERENT people
    // is the split brain: the index decides who may list and read it, the
    // conversation decides what they read, and they disagree.
    check(
      owner === undefined || signer === undefined || owner === signer,
      `SPLIT BRAIN: ownerOf() and the stored conversation name different people. ` +
        `The person the index names lists this session, opens it, and reads the other ` +
        `one's conversation.`,
    );
    // And the conversation that survived is a WHOLE one. A store that let both
    // writes land field by field would satisfy the check above by accident
    // while holding a document nobody wrote.
    check(
      ['alice speaking', 'bob speaking'].includes(textOf(await store.hydrate(id)) ?? ''),
      'the stored conversation is neither writer’s. A contested write may lose one turn; ' +
        'it may not invent a third.',
    );
  },
};

const ownerOfAmbiguity: SessionLifecycleCase = {
  name: 'owner-of-is-undefined-for-missing-and-unowned',
  law: '`ownerOf` answers `undefined` for BOTH a session that does not exist and one nobody signed for.',
  members: ['ownerOf'],
  async run(store, kit) {
    const missing = await store.ownerOf!(kit.id('no-such-session'));
    check(
      missing === undefined,
      `ownerOf() of a session that does not exist answered ${JSON.stringify(missing)}.`,
    );
    const unowned = kit.id('unowned');
    await store.persist(unowned, kit.envelope('nobody signed this'));
    const owner = await store.ownerOf!(unowned);
    check(
      owner === undefined,
      `ownerOf() of a session nobody signed for answered ${JSON.stringify(owner)}. ` +
        `The two answers must be indistinguishable, or a caller has an oracle for which ` +
        `session ids are real.`,
    );
  },
};

const listPages: SessionLifecycleCase = {
  name: 'list-by-user-pages-with-a-stable-tie-break',
  law: 'Paging a listing shows every owned session exactly once, nobody else’s ever, and hands back a cursor only when more rows exist.',
  members: ['listByUser'],
  async run(store, kit) {
    // Five for Alice sharing ONE savedAt, so the tie-break is what carries the
    // paging rather than the timestamp. A cursor that only orders by time
    // repeats or skips a row exactly here, and only here.
    const tied = 1_700_000_000_000;
    const alices: string[] = [];
    for (let n = 0; n < 5; n++) {
      const id = kit.id(`tied-${n}`);
      alices.push(id);
      await store.persist(id, kit.envelope(`alice ${n}`, 'alice', tied));
    }
    const bob = kit.id('bobs');
    await store.persist(bob, kit.envelope('bob', 'bob', tied));

    const { ids, pages } = await allPages(store, 'alice', 2);
    check(
      !ids.includes(bob),
      "another user's session appeared in this listing. A listing IS the permission " +
        'check for everything downstream of it.',
    );
    check(
      new Set(ids).size === ids.length,
      `paging repeated a session (${ids.join(', ')}). With equal timestamps a cursor needs ` +
        `a second, total ordering — usually the session id — or a row lands on both sides ` +
        `of a page boundary.`,
    );
    check(
      alices.every((id) => ids.includes(id)),
      `paging LOST a session. Seen: ${ids.join(', ')}. Written: ${alices.join(', ')}.`,
    );
    const last = pages[pages.length - 1];
    check(
      last?.cursor === undefined,
      'the final page still carried a cursor. A cursor promises MORE, so one on the last ' +
        'page is a sidebar with a "load more" that loads nothing.',
    );
    for (const page of pages.slice(0, -1)) {
      check(
        page.cursor !== undefined,
        'a non-final page carried no cursor, so the rows after it are unreachable.',
      );
    }
  },
};

/**
 * Split out of the paging case deliberately.
 *
 * That case holds three separate laws — nobody else's rows, complete paging
 * with an honest cursor, and newest-first order — and one store can hold two of
 * them while genuinely being unable to hold the third. Declaring a case is
 * all-or-nothing, so a combined case forces a store with ONE real ceiling to
 * forfeit checks it passes, including the cross-user leak check, which is the
 * single most valuable assertion in the battery. One case, one law.
 */
const listNewestFirst: SessionLifecycleCase = {
  name: 'list-by-user-is-newest-first',
  law: 'A listing is ordered newest first, by the conversation’s own timestamp rather than by the order rows happened to be written.',
  members: ['listByUser'],
  async run(store, kit) {
    const tied = 1_700_000_000_000;
    // Checked TWICE, with the two confounders inverted between the rounds.
    //
    // One round cannot hold this law. Ids from `kit.id` count up and writes are
    // ordered, so in any single arrangement the newest row is ALSO the
    // later-written row and the lexicographically larger id — three signals
    // pointing the same way. A store that never reads the timestamp and simply
    // sorts by insertion order, or by id, then lands on the right answer for
    // the wrong reason. Inverting both between the rounds means any such store
    // gets exactly one of them backwards.
    const rounds = [
      { user: 'carol', newestIsWrittenFirst: true },
      { user: 'dave', newestIsWrittenFirst: false },
    ];
    for (const { user, newestIsWrittenFirst } of rounds) {
      const written = [kit.id('ordered-a'), kit.id('ordered-b')] as const;
      const newest = newestIsWrittenFirst ? written[0] : written[1];
      for (const id of written) {
        const age = id === newest ? tied + 60_000 : tied - 60_000;
        await store.persist(id, kit.envelope(id === newest ? 'newer' : 'older', user, age));
      }
      const listed = await store.listByUser!(user, { limit: 10 });
      check(
        listed.sessions[0]?.sessionId === newest,
        `the listing did not put the newest conversation first (got ` +
          `${JSON.stringify(listed.sessions.map((s) => s.sessionId))}, newest is ` +
          `${JSON.stringify(newest)}, which was written ` +
          `${
            newestIsWrittenFirst ? 'FIRST and has the smaller id' : 'LAST and has the larger id'
          }). ` +
          `Newest-first is the order a sidebar draws in — and it has to come from the ` +
          `conversation's timestamp, not from the order rows happened to be inserted in. ` +
          `A store whose backend orders by its own write time cannot hold this and should ` +
          `DECLARE it rather than appear to pass.`,
      );
    }
  },
};

/**
 * Two session ids a store must keep apart, and the normalisation that folds
 * them together.
 *
 * Both halves are built from ONE base, so a pair differs only where its fold
 * is. That is the whole shape of the thing: this case once drew `kit.id('fold')`
 * separately for each half, and since `kit.id` counts up on every call the two
 * ids differed in their PREFIX as well — so a store that folded the part under
 * test went on passing. A collision case has to vary the fold-sensitive
 * characters and nothing else, or it cannot fail.
 *
 * `left`/`right` take the base rather than being suffixes because **a fold can
 * live anywhere in an id**. A store keying on the last path segment discards
 * the HEAD, and a suffix table cannot express a pair that differs there — which
 * is exactly how a suffix-only version of this table stayed blind to the single
 * most likely real mapping.
 */
interface FoldPair {
  /** The normalisation this pair exists to catch, named for the failure message. */
  readonly fold: string;
  readonly left: (base: string) => string;
  readonly right: (base: string) => string;
}

/** Long enough to cross any plausible key-length ceiling. */
const PAST_ANY_CEILING = 1000;

const FOLD_PAIRS: readonly FoldPair[] = [
  // ── characters rewritten or decoded ──
  { fold: 'percent-decoding', left: (b) => `${b}a/b`, right: (b) => `${b}a%2Fb` },
  {
    fold: 'every illegal character replaced by one filler',
    left: (b) => `${b}a/b`,
    right: (b) => `${b}a-b`,
  },
  {
    fold: 'a different illegal character, the same filler',
    left: (b) => `${b}a:b`,
    right: (b) => `${b}a-b`,
  },
  {
    fold: 'underscore and dash treated as the same character',
    left: (b) => `${b}a_b`,
    right: (b) => `${b}a-b`,
  },
  // ── case and Unicode ──
  // An id is bytes somebody chose. macOS stores NFD, a database column may
  // collate NFC, and two ids a person reads as identical swap places in
  // between — the classic silent id collision, and one no ASCII pair can see.
  { fold: 'case folding', left: (b) => `${b}AB`, right: (b) => `${b}ab` },
  {
    fold: 'Unicode normalisation (NFC against NFD)',
    left: (b) => `${b}café`,
    right: (b) => `${b}café`,
  },
  {
    fold: 'case folding applied outside ASCII',
    left: (b) => `${b}ÜSER`,
    right: (b) => `${b}üSER`,
  },
  {
    fold: 'compatibility normalisation (NFKC)',
    left: (b) => `${b}ａｂ`,
    right: (b) => `${b}ab`,
  },
  {
    fold: 'zero-width characters stripped',
    left: (b) => `${b}chat​1`,
    right: (b) => `${b}chat1`,
  },
  // ── position: which END of an id a store keeps ──
  {
    fold: 'truncation at a length ceiling',
    left: (b) => `${b}${'x'.repeat(PAST_ANY_CEILING)}A`,
    right: (b) => `${b}${'x'.repeat(PAST_ANY_CEILING)}B`,
  },
  // Both of the next two are PADDED past any window a store might keep. A pair
  // that differs near one end is invisible to a store that keeps the other end,
  // so the difference and the padding have to sit on opposite sides — without
  // the padding these two read correctly and catch nothing.
  {
    fold: 'anything that discards the HEAD, such as keying on a last path segment',
    left: (b) => `alice/${b}${'p'.repeat(PAST_ANY_CEILING)}`,
    right: (b) => `bob/${b}${'p'.repeat(PAST_ANY_CEILING)}`,
  },
  { fold: 'a stripped leading prefix', left: (b) => `session-${b}`, right: (b) => b },
  {
    fold: 'truncation from the FRONT',
    left: (b) => `A${'q'.repeat(PAST_ANY_CEILING)}${b}`,
    right: (b) => `B${'q'.repeat(PAST_ANY_CEILING)}${b}`,
  },
];

/**
 * The generic form of a collision a fold-pair table cannot express.
 *
 * A pair like `a_b` / `a-b` catches a store that folds punctuation. It cannot
 * catch a store whose mapping is IDEMPOTENT — one that rewrites an awkward id
 * into some composed form and then passes that composed form through unchanged.
 * There `x` and `f(x)` are two different ids addressing one conversation, and
 * the second is not something a table can guess, because only the store knows
 * what `f` is.
 *
 * So this case does not guess: it asks the store for an id, by reading the one
 * its own listing hands back, and then tries to use that as a second address.
 * A caller doing exactly this is the ordinary case, not an attack — a sidebar
 * lists conversations and opens the one that was clicked.
 */
const handedBackIdIsNotASecondAddress: SessionLifecycleCase = {
  name: 'an-id-the-store-hands-back-is-not-a-second-address',
  law: 'An id a store reports in a listing addresses THAT conversation and no other — it is never a second name for a different one.',
  members: ['listByUser'],
  async run(store, kit) {
    const chosen = `${kit.id('handed-back')}A_b.c`;
    await store.persist(chosen, kit.envelope('the original conversation', 'alice'));

    const listed = await store.listByUser!('alice', { limit: 50 });
    const reported =
      listed.sessions.find((row) => row.sessionId === chosen)?.sessionId ??
      listed.sessions[listed.sessions.length - 1]?.sessionId;
    check(
      reported !== undefined,
      'listByUser did not report a conversation that was just written for that user.',
    );

    // The reported id must round-trip: a listing a caller cannot open is not a
    // listing. This is the half stores usually get right.
    check(
      textOf(await store.hydrate(reported)) === 'the original conversation',
      `listByUser reported ${JSON.stringify(reported)} and hydrate() of that id did not ` +
        `return the conversation it was reported for. A sidebar lists conversations and ` +
        `opens the one that was clicked, so an id in a listing has to be openable.`,
    );

    // And it must not ALSO be a way to address something else. If the store
    // rewrote the caller's id into `reported`, and `reported` maps to itself,
    // then writing here lands on the first conversation.
    if (reported !== chosen) {
      await store.persist(reported, kit.envelope('a different conversation', 'alice'));
      check(
        textOf(await store.hydrate(chosen)) === 'the original conversation',
        `writing to the id this store REPORTED (${JSON.stringify(reported)}) overwrote the ` +
          `conversation stored under the id the caller CHOSE (${JSON.stringify(chosen)}). The ` +
          `store rewrote one into the other and then accepted the rewritten form as an id in ` +
          `its own right, so two different session ids now name one conversation — and the ` +
          `second one is a value this store published.`,
      );
    }
  },
};

const awkwardIds: SessionLifecycleCase = {
  name: 'awkward-session-ids-round-trip',
  law: 'A session id is OPAQUE: whatever a caller chose comes back as its own conversation, and two different ids never collide.',
  async run(store, kit) {
    const awkward = [
      'has/slashes/inside',
      'has spaces',
      '..',
      './..',
      'ünïcødé-😀-id',
      `quote'and"double`,
      "'; DROP TABLE agent_sessions; --",
      '\u0000-ish-but-not-really',
      'a'.repeat(1000),
    ];
    // A store may REFUSE an id it cannot hold faithfully — a column has a width,
    // and refusing beats truncating, which is exactly how two ids become one. So
    // the law is not "every id round-trips"; it is "every id the store ACCEPTED
    // comes back as its own conversation". A write that never happened collides
    // with nothing, and a store with an honest ceiling should not have to choose
    // between declaring this whole case and looking non-conformant.
    const accepted = async (id: string, text: string): Promise<boolean> =>
      (await attempt(() => store.persist(id, kit.envelope(text, 'alice')))) === undefined;

    for (const [index, raw] of awkward.entries()) {
      const id = `${kit.id('awkward')}${raw}`;
      if (!(await accepted(id, `conversation ${index}`))) continue;
      const back = await store.hydrate(id);
      check(
        textOf(back) === `conversation ${index}`,
        `a session id the caller chose did not round-trip: ${JSON.stringify(raw)} came back ` +
          `as ${JSON.stringify(textOf(back))}. An id is somebody's opaque string, and a ` +
          `store that mangles it hands them a different conversation.`,
      );
    }
    for (const { fold, left, right } of FOLD_PAIRS) {
      const base = kit.id('fold');
      const [leftId, rightId] = [left(base), right(base)];
      const stored = [
        await accepted(leftId, `left ${fold}`),
        await accepted(rightId, `right ${fold}`),
      ];
      // Only the ids this store took are held to the law. If it refused one,
      // there is no second write to collide with the first.
      check(
        (!stored[0] || textOf(await store.hydrate(leftId)) === `left ${fold}`) &&
          (!stored[1] || textOf(await store.hydrate(rightId)) === `right ${fold}`),
        `two different session ids collided onto one conversation — ${fold}. The two ids ` +
          `differ only where that fold applies, and after this store mapped them they were ` +
          `the same key. Whatever mapping a store uses to make an id legal for its backend ` +
          `has to be injective, or one person’s turn lands in another’s conversation.`,
      );
    }
  },
};

const retentionHonesty: SessionLifecycleCase = {
  name: 'retention-says-who-deletes-and-deletes-only-the-old',
  law: 'A store that answers `retention()` says WHO deletes — and where that is the store itself, it forgets exactly the sessions older than the cutoff and nothing else.',
  members: ['retention'],
  async run(store, kit) {
    const policy = store.retention!();

    // The BACKEND arm. There is nothing to call, so what is checked is the
    // only thing that can be wrong: whether an operator could act on it. A
    // policy that names no field and no step is a store saying "somebody else
    // handles it" — which is what every deployment believes right up until
    // somebody asks how long conversations are kept.
    if (policy.deletedBy === 'the-backend') {
      check(
        typeof policy.expiresOn === 'string' && policy.expiresOn.length > 0,
        'a backend-enforced retention policy named no field or setting for the backend to ' +
          'act on. An operator configuring the policy has to know what it reads.',
      );
      check(
        typeof policy.enableWith === 'string' && policy.enableWith.length > 30,
        'a backend-enforced retention policy carries no step an operator can take. The ' +
          'store knows its own collection, database or resource; making somebody go and ' +
          'look that up is how retention stays switched off.',
      );
      check(
        typeof policy.active === 'boolean',
        '`active` is not a boolean. "There is an expiry mechanism" and "conversations are ' +
          'expiring" are different facts, and this is the one that says which.',
      );
      return;
    }

    // The SWEEP arm. Three sessions around one cutoff, so the boundary is
    // under test rather than assumed: strictly-before is what makes the same
    // cutoff safe to pass twice.
    const cutoff = 1_700_000_000_000;
    const old = kit.id('older-than-the-cutoff');
    const boundary = kit.id('exactly-at-the-cutoff');
    const fresh = kit.id('newer-than-the-cutoff');
    await store.persist(old, kit.envelope('last year', 'alice', cutoff - 60_000));
    await store.persist(boundary, kit.envelope('right on it', 'alice', cutoff));
    await store.persist(fresh, kit.envelope('this morning', 'alice', cutoff + 60_000));

    const swept = await policy.forgetOlderThan(cutoff);
    check(
      swept.forgotten === 1,
      `the sweep reported ${swept.forgotten} conversations forgotten and exactly one was ` +
        `older than the cutoff. A count a cleanup job cannot trust is a count it will log ` +
        `and nobody will read.`,
    );
    check(
      swept.more === false,
      'the sweep says more sessions remain older than the cutoff, and none do. `more` is ' +
        'what a caller loops on, so a store that always says `true` is an infinite loop.',
    );
    check(
      (await store.hydrate(old)) === undefined,
      'the sweep reported forgetting a conversation and it is still readable. A deletion ' +
        'that does not delete is the kind of thing a person finds out about from a regulator.',
    );
    check(
      textOf(await store.hydrate(boundary)) === 'right on it',
      'the sweep deleted the session saved EXACTLY at the cutoff. The bound is strictly ' +
        'before, so that passing one cutoff twice is stable and a conversation on the ' +
        'boundary survives — an off-by-one here deletes somebody who is still talking.',
    );
    check(
      textOf(await store.hydrate(fresh)) === 'this morning',
      'the sweep deleted a conversation NEWER than the cutoff. Whatever else a retention ' +
        'job gets wrong, it may not delete the conversation somebody is having.',
    );

    // The index has to go with the conversation, exactly as `forget` must —
    // a listing built on an index the sweep did not touch points at
    // conversations nobody can open.
    if (store.ownerOf !== undefined) {
      check(
        (await store.ownerOf(old)) === undefined,
        'the sweep forgot the conversation and left the owner index naming somebody for it.',
      );
    }
    if (store.listByUser !== undefined) {
      const { ids } = await allPages(store, 'alice', 10);
      check(
        !ids.includes(old) && ids.includes(fresh),
        `after the sweep the listing is ${ids.join(', ')} — it must have lost the swept ` +
          `session and kept the rest. A sidebar row that opens nothing is worse than a row ` +
          `that is gone.`,
      );
    }

    // Idempotent, and bounded. A cleanup job runs on a schedule; most of its
    // runs have nothing to do, and "nothing to do" is not an error.
    const again = await policy.forgetOlderThan(cutoff);
    check(
      again.forgotten === 0 && again.more === false,
      `sweeping the same cutoff twice forgot ${again.forgotten} more conversations. The ` +
        `second run of a nightly job must be a no-op, or the job is deleting on a moving ` +
        `target.`,
    );

    const limited = await policy.forgetOlderThan(cutoff + 120_000, { limit: 1 });
    check(
      limited.forgotten === 1 && limited.more === true,
      `a sweep limited to one conversation reported ${limited.forgotten} forgotten and ` +
        `more=${String(limited.more)}, with two eligible. The limit is what keeps the first ` +
        `sweep of a neglected store from becoming one enormous transaction, and \`more\` is ` +
        `how a caller knows to come back.`,
    );
  },
};

const featureDetected: SessionLifecycleCase = {
  name: 'optional-members-are-feature-detected',
  law: 'The optional members are present as functions or absent — never something a caller has to guess about.',
  async run(store) {
    for (const member of ['onWake', 'listByUser', 'ownerOf', 'retention'] as const) {
      const value = store[member];
      check(
        value === undefined || typeof value === 'function',
        `'${member}' is present as ${typeof value}. Feature detection reads ` +
          `\`typeof store.${member} === 'function'\`, so a member that is present-but-not-a-` +
          `function is detected as available and then fails at the door.`,
      );
    }
    check(
      store.listByUser === undefined || store.ownerOf !== undefined,
      'this store can LIST a user’s sessions and cannot check ownership of one. ' +
        'A door built on it hands somebody a list and then refuses to open any of it — ' +
        'implement `ownerOf` beside `listByUser`.',
    );
    // Retention is DESCRIBED synchronously — the answer is configuration, not
    // a round trip — and a store that made a caller await a description would
    // make an incident-time question ("what expires these?") cost a network
    // call on a store that may already be closed.
    if (store.retention !== undefined) {
      const policy: unknown = store.retention();
      const deletedBy = (policy as { deletedBy?: unknown } | null)?.deletedBy;
      check(
        deletedBy === 'this-store' || deletedBy === 'the-backend',
        `retention() answered ${JSON.stringify(deletedBy)} for \`deletedBy\`. That field is ` +
          `the discriminant a caller branches on — one arm hands you something to CALL and ` +
          `the other something to CONFIGURE — so a third value is a branch nobody wrote.`,
      );
      if (deletedBy === 'this-store') {
        check(
          typeof (policy as { forgetOlderThan?: unknown }).forgetOlderThan === 'function',
          'retention() says this store does the deleting and gave nothing to call. ' +
            'The sweep IS the arm — without it the answer is a claim, not a mechanism.',
        );
      }
    }
  },
};

/**
 * The battery, in the order a store fails it most usefully: reading before
 * writing, writing before ownership, ownership before the listing built on it,
 * and the listing before the retention that deletes out from under it.
 */
export const sessionLifecycleConformance: readonly SessionLifecycleCase[] = [
  absentHydratesUndefined,
  roundTrip,
  unreadableIsNotAbsent,
  forgetRemoves,
  ownershipDerived,
  ownershipFillsIn,
  leanerTurnKeepsOwner,
  differentSignerRefused,
  contestedWrite,
  ownerOfAmbiguity,
  listPages,
  listNewestFirst,
  handedBackIdIsNotASecondAddress,
  awkwardIds,
  retentionHonesty,
  featureDetected,
];

export type { ConformanceKit, SessionLifecycleCase };
