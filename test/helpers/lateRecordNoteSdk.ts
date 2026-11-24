import { vi } from 'vitest';
import { openai, type OpenAIProviderOptions } from '../../src/adapters/llm/OpenAIProvider.js';
import { Agent, coverage, defineTool, type AgentOptions } from '../../src/index.js';
import * as sdkLoader from '../../src/lib/lazyRequire.js';

/** Replace only the module loaded by the SDK constructor path. */
export function ownedLateNoteOpenAI(
  client: NonNullable<OpenAIProviderOptions['_client']>,
  route: { readonly configured?: string; readonly resolved?: string } = {},
) {
  class ScriptedOpenAI {
    readonly baseURL = route.resolved ?? 'https://api.openai.com/v1';
    readonly chat = client.chat;
  }
  const load = vi.spyOn(sdkLoader, 'lazyRequire').mockImplementation((specifier) => {
    if (specifier !== 'openai') throw new Error('Unexpected SDK dependency');
    return { default: ScriptedOpenAI };
  });
  try {
    return openai({ apiKey: 'fixture-key', baseURL: route.configured });
  } finally {
    load.mockRestore();
  }
}

/** A local SDK fixture with a tool call and a final streaming response. */
export const lateNoteModel = 'gpt-4o-mini';

type WireRequest = Readonly<{
  stream?: boolean;
  messages: readonly Readonly<{ role: string; content: string | null }>[];
}>;

export function scriptedLateNoteSdk(failFollowUp = false, proposedArgs = '{}') {
  const requests: WireRequest[] = [];
  const client = {
    chat: {
      completions: {
        create(body: WireRequest) {
          if (!body.stream || requests.length > 1) throw new Error('Unexpected SDK request');
          requests.push(body);
          const toolCall = requests.length === 1;
          if (!toolCall && failFollowUp) throw new Error('Scripted OpenAI transport failure');
          return (async function* () {
            yield {
              id: toolCall ? 'provider-call' : 'provider-answer',
              model: lateNoteModel,
              choices: [
                {
                  index: 0,
                  delta: toolCall
                    ? {
                        tool_calls: [
                          {
                            index: 0,
                            id: 'lookup-1',
                            function: { name: 'lookup', arguments: proposedArgs },
                          },
                        ],
                      }
                    : { content: 'The active index is available.' },
                  finish_reason: toolCall ? 'tool_calls' : 'stop',
                },
              ],
            };
          })();
        },
      },
    },
  };
  return { client, requests };
}

export const lateNoteWhy = 'The archive said "awaiting export".\nIt is outside the checked tier.';

export const lateNoteLookupTool = (reason: string) =>
  defineTool({
    name: 'lookup',
    displayName: 'Attachment lookup',
    description: 'Read the attachment index.',
    inputSchema: { type: 'object', properties: {} },
    execute: () =>
      coverage('The active index is available.', {
        checked: ['active index'],
        notChecked: [{ what: 'archived attachment', why: reason }],
      }),
  });

export type LateNoteSnapshotState = {
  readonly history?: readonly Readonly<{ role: string; content: string }>[];
  readonly lateRecordNoteReceipt?: readonly unknown[];
  readonly recordNoteWireProof?: unknown;
  readonly coverageDeclared?: unknown;
};

export async function recordedLateNoteRun(
  options: Pick<AgentOptions, 'reactMode' | 'observerDelivery' | 'commitValues'>,
  lateRecordNotes: boolean,
  reason = lateNoteWhy,
  redact?: AgentOptions['redact'],
  message = 'Read the attachment index.',
) {
  const { client, requests } = scriptedLateNoteSdk();
  const agent = Agent.create({
    ...options,
    provider: ownedLateNoteOpenAI(client),
    model: lateNoteModel,
    ...(lateRecordNotes && { lateRecordNotes: true }),
    ...(redact === undefined ? {} : { redact }),
  })
    .tool(lateNoteLookupTool(reason))
    .build();
  try {
    const answer = await agent.run({ message });
    const snapshot = agent.getLastSnapshot();
    if (snapshot === undefined) throw new Error('Fixture expected a native snapshot');
    const state = snapshot.sharedState as LateNoteSnapshotState;
    return { requests, answer, snapshot, state };
  } finally {
    await agent.shutdown();
  }
}
