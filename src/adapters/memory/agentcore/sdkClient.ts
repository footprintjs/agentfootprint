import { lazyRequire } from '../../../lib/lazyRequire.js';
import type {
  AgentCoreLikeClient,
  AgentCoreEvent,
  AgentCoreMemoryRecord,
  BedrockAgentCoreSdkModule,
} from './contract.js';
import { entryFromPayload } from './storedEntry.js';
import { eventPayloadItems, sdkModelsEventPayload } from './eventPayload.js';
/**
 * Does the installed SDK model CreateEvent's `extractionMode` and
 * `extractionConfig`? Its serializer drops a field it does not model, without a
 * word, so an older SDK would accept the write options and send neither.
 *
 * Read off the SDK's own schema of the input (`CreateEventInput$`, whose member
 * names include both since 3.1114.0). The SDK changelog first adds
 * `extractionConfig` in that version (it adds `extractionMode` in 3.1074.0):
 * https://github.com/aws/aws-sdk-js-v3/blob/v3.1114.0/clients/client-bedrock-agentcore/CHANGELOG.md
 * Anything that cannot be read that way counts
 * as "no" — the options are then refused by name, never sent into a drop.
 */
export function sdkModelsExtraction(mod: BedrockAgentCoreSdkModule): boolean {
  try {
    const schema = mod.CreateEventInput$;
    if (!Array.isArray(schema)) return false;
    const members = schema.find(
      (part): part is unknown[] => Array.isArray(part) && part.includes('memoryId'),
    );
    return (
      members !== undefined &&
      members.includes('extractionMode') &&
      members.includes('extractionConfig')
    );
  } catch {
    return false;
  }
}

/** SDK barrels may use export getters. Capture each model once for both declarations. */
function sdkModels(
  mod: BedrockAgentCoreSdkModule,
  eventPayloadEnabled: boolean,
): BedrockAgentCoreSdkModule {
  const names = eventPayloadEnabled
    ? (['CreateEventInput$', 'PayloadType$', 'Conversational$', 'Content$'] as const)
    : (['CreateEventInput$'] as const);
  return Object.fromEntries(
    names.map((name) => {
      try {
        return [name, mod[name]];
      } catch {
        // An unreadable optional schema grants no forwarding capability.
        return [name, undefined];
      }
    }),
  );
}

/**
 * Map the entry-semantic `AgentCoreLikeClient` onto the real AgentCore SDK commands.
 * If AWS renames commands, only this function changes.
 */
export function createAgentCoreClient(
  region: string | undefined,
  injected?: BedrockAgentCoreSdkModule,
  eventPayloadEnabled = false,
): AgentCoreLikeClient {
  let mod: BedrockAgentCoreSdkModule;
  if (injected) {
    mod = injected;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCoreSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'AgentCoreStore requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `sdk` for a statically imported module, or `client` for a pre-built client.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'AgentCoreStore: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(region && { region }) });
  const models = sdkModels(mod, eventPayloadEnabled);

  const send = async (
    Ctor: (new (input: never) => unknown) | undefined,
    name: string,
    input: unknown,
  ) => {
    if (!Ctor) {
      throw new Error(
        `AgentCoreStore: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. Upgrade the SDK.`,
      );
    }
    // The public module keeps the SDK's narrower constructor input opaque.
    // This boundary supplies the wire shape owned by this adapter below.
    const Command = Ctor as new (input: unknown) => unknown;
    return sdk.send(new Command(input));
  };

  return {
    // The two extraction fields below are forwarded as they are — but only an
    // SDK that MODELS them sends them, so the declaration follows the SDK.
    ...(sdkModelsExtraction(models) && { forwardsWriteOptions: true as const }),
    ...(sdkModelsEventPayload(models) && { forwardsEventPayload: true as const }),
    async createEvent({
      memoryId,
      actorId,
      sessionId,
      entry,
      eventPayload,
      extractionMode,
      extractionConfig,
    }) {
      // The entry is stored as a single `blob` document (PayloadType.blob =
      // __DocumentType), and it goes in as JSON TEXT, not as the object.
      // Field-learned on the session store and true of every blob this service
      // holds: hand it an object and it stores its own host language's
      // `toString()` rendering — `{id=m-1, value={...}}` — and returns THAT
      // string, which is not JSON and cannot be turned back into an entry. A
      // `MemoryEntry` is defined as something a store can hold (the port's
      // stores round-trip it through JSON already), so the encoding is ours to
      // pick and the honest pick is the one whose bytes come back unchanged.
      await send(mod.CreateEventCommand, 'CreateEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventTimestamp: new Date(),
        payload: eventPayloadItems(JSON.stringify(entry), eventPayload),
        // `CreateEventInput`'s own names (`ExtractionMode.SKIP`,
        // `ExtractionConfig.namespaceVariables`), present only when asked —
        // an event without them is extracted exactly as before.
        ...(extractionMode !== undefined && { extractionMode }),
        ...(extractionConfig !== undefined && {
          extractionConfig: { namespaceVariables: { ...extractionConfig.namespaceVariables } },
        }),
      });
    },
    async listEvents({ memoryId, actorId, sessionId, maxResults, nextToken }) {
      const r = (await send(mod.ListEventsCommand, 'ListEventsCommand', {
        memoryId,
        actorId,
        sessionId,
        includePayloads: true,
        ...(maxResults !== undefined && { maxResults }),
        ...(nextToken !== undefined && { nextToken }),
      })) as {
        events?: ReadonlyArray<{ eventId?: string; payload?: unknown }>;
        nextToken?: string;
      } | null;
      const events: AgentCoreEvent[] = (r?.events ?? []).map((ev) => {
        const eventId = ev.eventId ?? '';
        // A page containing one unreadable entry fails the READ. Returning the
        // rest would be a list that is quietly one memory short, which is the
        // shape of the failure nobody notices.
        return { eventId, entry: entryFromPayload(ev.payload, { eventId, sessionId }) };
      });
      return r?.nextToken ? { events, nextToken: r.nextToken } : { events };
    },
    async deleteEvent({ memoryId, actorId, sessionId, eventId }) {
      await send(mod.DeleteEventCommand, 'DeleteEventCommand', {
        memoryId,
        actorId,
        sessionId,
        eventId,
      });
    },
    async retrieveRecords({ memoryId, namespace, searchQuery, maxResults, memoryStrategyId }) {
      // AgentCore nests the query under `searchCriteria`; the strategy id is the
      // metadata filter that reaches its side rather than being applied after.
      const r = (await send(mod.RetrieveMemoryRecordsCommand, 'RetrieveMemoryRecordsCommand', {
        memoryId,
        namespace,
        searchCriteria: {
          searchQuery,
          ...(maxResults !== undefined && { topK: maxResults }),
          ...(memoryStrategyId !== undefined && { memoryStrategyId }),
        },
        ...(maxResults !== undefined && { maxResults }),
      })) as {
        memoryRecordSummaries?: ReadonlyArray<{
          memoryRecordId?: string;
          content?: { text?: string } | string;
          score?: number;
          memoryStrategyId?: string;
          // `MemoryRecordSummary.namespaces` is the SDK's field; `namespace`
          // is read too, for a client that answers in that shape.
          namespaces?: readonly string[];
          namespace?: string | readonly string[];
          createdAt?: string | number | Date;
        }>;
      } | null;
      const records: AgentCoreMemoryRecord[] = (r?.memoryRecordSummaries ?? []).map((s) => {
        const content = typeof s.content === 'string' ? s.content : s.content?.text ?? '';
        const namespaces = (
          Array.isArray(s.namespaces)
            ? s.namespaces
            : Array.isArray(s.namespace)
            ? s.namespace
            : typeof s.namespace === 'string'
            ? [s.namespace]
            : []
        ).filter((n): n is string => typeof n === 'string');
        const namespaceValue = namespaces[0];
        const createdAt =
          s.createdAt === undefined ? undefined : new Date(s.createdAt as string).getTime();
        return {
          memoryRecordId: s.memoryRecordId ?? '',
          content,
          ...(typeof s.score === 'number' && { score: s.score }),
          ...(s.memoryStrategyId !== undefined && { memoryStrategyId: s.memoryStrategyId }),
          ...(typeof namespaceValue === 'string' && { namespace: namespaceValue }),
          ...(namespaces.length > 0 && { namespaces }),
          ...(createdAt !== undefined && Number.isFinite(createdAt) && { createdAt }),
        };
      });
      return { records };
    },
  };
}
