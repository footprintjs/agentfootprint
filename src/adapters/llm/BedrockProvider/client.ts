/** SDK command registry and the existing transport/error boundary. */
import { lazyRequire } from '../../../lib/lazyRequire.js';
import { abortErrorOf } from '../../../lib/abort.js';
import { asContextWindowExceeded } from '../../../provider-contract/contextWindow.js';
import { isProviderInterventionError } from '../../../provider-contract/intervention.js';
import { retryAfterMsFromError } from '../retryAfter.js';
import type {
  BedrockClient,
  BedrockConverseCommand,
  BedrockConverseSdkModule,
  BedrockProviderOptions,
} from './types.js';

/** `client.send(cmd)`, with the request's signal when it has one. */
export function sendUnder(
  client: BedrockClient,
  cmd: unknown,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  return signal ? client.send(cmd, { abortSignal: signal }) : client.send(cmd);
}

export function resolveClient(options: BedrockProviderOptions): {
  client: BedrockClient;
  Commands: {
    Converse: new (input: BedrockConverseCommand) => unknown;
    ConverseStream: new (input: BedrockConverseCommand) => unknown;
  };
} {
  let mod: BedrockConverseSdkModule;
  if (options._sdk) {
    mod = options._sdk;
  } else if (options._client && options._commands) {
    return { client: options._client, Commands: options._commands };
  } else {
    try {
      mod = lazyRequire<BedrockConverseSdkModule>('@aws-sdk/client-bedrock-runtime');
    } catch {
      throw new Error(
        'BedrockProvider requires `@aws-sdk/client-bedrock-runtime`.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-runtime\n' +
          '  Or pass `_client` + `_commands` for test injection.',
      );
    }
  }
  // Named one at a time so a missing one is reported BY NAME. `Converse` and
  // `ConverseStream` are the two operations this provider has; an SDK missing
  // either is a different problem to an SDK that is not installed.
  for (const name of ['ConverseCommand', 'ConverseStreamCommand'] as const) {
    if (typeof mod[name] !== 'function') {
      throw new Error(
        `BedrockProvider: \`@aws-sdk/client-bedrock-runtime\` is missing ${name}. ` +
          'Upgrade the SDK, or pass `_client` + `_commands` with your own mapping.',
      );
    }
  }
  const client =
    options._client ??
    (() => {
      if (typeof mod.BedrockRuntimeClient !== 'function') {
        throw new Error(
          'BedrockProvider: `@aws-sdk/client-bedrock-runtime` is installed but ' +
            '`BedrockRuntimeClient` was not found. Update the SDK.',
        );
      }
      return new mod.BedrockRuntimeClient({ region: options.region });
    })();
  return {
    client,
    // Both checked by name directly above.
    /* eslint-disable @typescript-eslint/no-non-null-assertion */
    Commands: { Converse: mod.ConverseCommand!, ConverseStream: mod.ConverseStreamCommand! },
    /* eslint-enable @typescript-eslint/no-non-null-assertion */
  };
}

export function wrapError(err: unknown, signal?: AbortSignal): Error {
  // A cancelled call fails AS the cancellation, whatever the SDK threw for it
  // — never as a provider error that a retry would re-send (lib/abort.ts).
  if (signal?.aborted) return abortErrorOf(signal);
  // Admission refusals and private-buffer limits are already terminal typed
  // errors. Wrapping them as an availability failure would permit a resend.
  if (isProviderInterventionError(err)) return err;
  // Already ours (the typed tool-use conditions above) — re-wrapping would
  // drop `code` / `toolName` / `toolUseId` and double-prefix the message.
  if (err instanceof Error && err.name === 'BedrockProviderError') return err;
  // A `ValidationException` reading "Input is too long for requested model"
  // is the same failure OpenAI spells `context_length_exceeded`; it leaves
  // here typed, with the fixes, rather than as a generic validation error.
  const tooBig = asContextWindowExceeded(err, { provider: 'bedrock' });
  if (tooBig) return tooBig;
  if (err instanceof Error) {
    // A Retry-After on the raw response (`$response.headers`), declared for
    // withRetry — absent when none, so the error shape is unchanged.
    const retryAfterMs = retryAfterMsFromError(err);
    return Object.assign(new Error(`[bedrock] ${err.message}`), {
      name: 'BedrockProviderError',
      cause: err,
      status:
        (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode ??
        (err as { status?: number }).status,
      ...(retryAfterMs !== undefined && { retryAfterMs }),
    });
  }
  return new Error(`[bedrock] ${String(err)}`);
}
