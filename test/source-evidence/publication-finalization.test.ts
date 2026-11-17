/** Private membership-unit controls; public native capture/delivery tests own authority claims. */
import { describe, expect, it } from 'vitest';
import {
  bindArtifacts,
  inMemoryArtifacts,
  type ArtifactMeta,
  type ArtifactStore,
} from '../../src/index.js';
import {
  sourcePublicationSink,
  finalizeSourcePublications,
  closeSourcePublications,
} from '../../src/core/agent/sourceEvidence/publications.js';

const identity = { principal: 'fixture-owner', conversationId: 'one-native-publication' };
function capability(store: ArtifactStore = inMemoryArtifacts()) {
  let observe: ((meta: ArtifactMeta) => void) | undefined;
  const artifacts = bindArtifacts(store, identity, {
    origin: { toolCallId: 'reused-provider-id' },
    onEvent(fact) {
      if (fact.type === 'minted') observe?.(fact.meta);
    },
  });
  return {
    artifacts,
    attach() {
      observe = sourcePublicationSink(artifacts);
      return observe;
    },
  };
}
function fixture(store?: ArtifactStore) {
  const bound = capability(store);
  return { ...bound, observe: bound.attach() };
}
const put = (artifacts: ReturnType<typeof fixture>['artifacts']) =>
  artifacts.put({
    kind: 'dataset/rows',
    mediaType: 'application/json',
    data: [{ value: 0 }],
    digest: 'sha-256',
  });

describe('one capability owns one sealed native publication receipt', () => {
  it.each(['close', 'finalize'] as const)(
    'cannot reopen a capability first encountered at %s',
    async (ending) => {
      const { artifacts, attach } = capability();
      if (ending === 'close') closeSourcePublications(artifacts);
      else finalizeSourcePublications(artifacts);
      attach();
      const late = await put(artifacts);
      expect(finalizeSourcePublications(artifacts).get(late.ref)).toBeUndefined();
      closeSourcePublications(artifacts);
    },
  );

  it('gives both consumers the same immutable receipt without a destructive take', async () => {
    const { artifacts, observe } = fixture();
    const meta = await put(artifacts);
    const first = finalizeSourcePublications(artifacts);
    const second = finalizeSourcePublications(artifacts);
    expect(sourcePublicationSink(artifacts)).toBe(observe);
    expect(second).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.get(meta.ref)).toMatchObject({
      ref: meta.ref,
      kind: meta.kind,
      digest: meta.digest,
    });
    expect(Object.isFrozen(first.get(meta.ref))).toBe(true);
    expect(first).not.toHaveProperty('set');
    closeSourcePublications(artifacts);
    expect(finalizeSourcePublications(artifacts).get(meta.ref)).toBeUndefined();
    // A consumer already handed the snapshot never races a second destructive take.
    expect(second.get(meta.ref)?.ref).toBe(meta.ref);
  });

  it('does not admit a put that completes after actual-return finalization', async () => {
    const store = inMemoryArtifacts();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delayed: ArtifactStore = {
      ...store,
      async put(scope, input) {
        await gate;
        return store.put(scope, input);
      },
    };
    const { artifacts } = fixture(delayed);
    const pending = put(artifacts);
    const receipt = finalizeSourcePublications(artifacts);
    release();
    const late = await pending;
    expect(receipt.get(late.ref)).toBeUndefined();
    expect(finalizeSourcePublications(artifacts)).toBe(receipt);
    closeSourcePublications(artifacts);
  });

  it('closing before return prevents even the retained native observer from adding authority', async () => {
    const { artifacts, observe } = fixture();
    const meta = await put(artifacts);
    closeSourcePublications(artifacts);
    observe(meta);
    expect(sourcePublicationSink(artifacts)).toBe(observe);
    sourcePublicationSink(artifacts)(meta);
    expect(finalizeSourcePublications(artifacts).get(meta.ref)).toBeUndefined();
  });

  it('separates actual capabilities despite the same store, scope and claimed provider call id', async () => {
    const store = inMemoryArtifacts();
    const first = fixture(store),
      other = fixture(store);
    const meta = await put(first.artifacts);
    expect(finalizeSourcePublications(first.artifacts).get(meta.ref)).toBeDefined();
    expect(finalizeSourcePublications(other.artifacts).get(meta.ref)).toBeUndefined();
    closeSourcePublications(first.artifacts);
    closeSourcePublications(other.artifacts);
  });

  it('keeps the existing native maximum of 32 publications without retaining payload rows', async () => {
    const { artifacts } = fixture();
    const metas: ArtifactMeta[] = [];
    for (let index = 0; index < 33; index++) metas.push(await put(artifacts));
    const receipt = finalizeSourcePublications(artifacts);
    expect(metas.slice(0, 32).every((meta) => receipt.get(meta.ref) !== undefined)).toBe(true);
    expect(receipt.get(metas[32]!.ref)).toBeUndefined();
    expect(receipt.get(metas[0]!.ref)).not.toHaveProperty('data');
    closeSourcePublications(artifacts);
  });
});
