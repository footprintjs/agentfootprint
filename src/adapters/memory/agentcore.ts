/**
 * AgentCoreStore — AWS Bedrock **AgentCore Memory** adapter
 * (peer-dep `@aws-sdk/client-bedrock-agentcore`).
 *
 *   import { AgentCoreStore } from 'agentfootprint/memory';
 *
 *   const store = new AgentCoreStore({
 *     memoryId: 'arn:aws:bedrock-agentcore:us-west-2:...:memory/my-mem',
 *     region: 'us-west-2',
 *   });
 *
 * Pattern: Adapter (GoF) — maps the `MemoryStore` interface onto AgentCore Memory's
 *          data-plane **event** model (`CreateEvent` / `GetEvent` / `ListEvents` /
 *          `DeleteEvent`, `@aws-sdk/client-bedrock-agentcore`):
 *            MemoryIdentity.{tenant,principal}  ↔  AgentCore `actorId`
 *            MemoryIdentity.conversationId      ↔  AgentCore `sessionId`
 *            MemoryEntry                        ↔  one event whose canonical `blob`
 *                                                  retains the entry, optionally beside
 *                                                  an explicit conversational item
 *
 * **AgentCore Memory is an append-only event log, not a key-value store.** The server
 * assigns each event's `eventId` on `CreateEvent` (you cannot choose it), and there is no
 * "delete the whole session" call. This shapes the adapter:
 *
 *   • `put`  → `CreateEvent` (append; `actorId` + `eventTimestamp` are required).  O(1)
 *     Its write options become CreateEvent's own fields: `extraction: 'skip'` →
 *     `extractionMode: 'SKIP'`, `namespaceScope` → `extractionConfig.namespaceVariables`.
 *   • `list` → `ListEvents` (paginated, `includePayloads`).  ← window / episodic memory.  O(page)
 *   • `get(id)` / `delete(id)` → list-then-find by the entry id stored in the blob, since
 *     AgentCore's ids are server-assigned.  **O(events in session)** — fine for typical
 *     window sizes; if you need O(1) keyed access at scale, use RedisStore.
 *   • `forget` → `ListEvents` + `DeleteEvent` per event (no `DeleteSession` on AgentCore).
 *   • `search` → `RetrieveMemoryRecords`, **text-in**. AgentCore embeds and ranks on its
 *     own side, so it takes a natural-language query; the port's `search()` takes a
 *     vector. Pass `options.text` and this store serves the query; omit it and it refuses
 *     by name rather than ranking an empty set. See `search()` below for the whole story.
 *   • `putIfVersion` / `seen` / `feedback` → in-process emulation (AgentCore has no native
 *     CAS / dedup / feedback primitive; these don't survive process restart).
 *   • no `stream()` — AgentCore Memory has no streaming data-plane operation, and the
 *     `MemoryStore` port has no streaming method to implement. Inventing one for a single
 *     backend is how a port stops being a port.
 *
 * Role:    Outer ring. Lazy-requires the AWS SDK; zero runtime cost when another adapter is
 *          in use.  Emits: N/A (storage adapters don't emit).
 */

export { AgentCoreStore } from './agentcore/store.js';
export { agentCoreNamespaceValue } from './agentcore/namespace.js';
export { UnreadableMemoryEntryError } from './agentcore/storedEntry.js';
export type {
  AgentCoreEvent,
  AgentCoreLikeClient,
  AgentCoreMemoryRecord,
  AgentCoreStoreOptions,
  BedrockAgentCoreSdkModule,
  AgentCoreEventPayloadChoice,
  AgentCoreEventPayloadSelector,
} from './agentcore/contract.js';
