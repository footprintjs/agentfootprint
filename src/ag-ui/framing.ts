/**
 * framing — AG-UI events → Server-Sent Events frames: the second framing
 * strategy beside `toSSE`'s own (`hosting/stream.ts` · `agentfootprintSse`).
 *
 * The frames are written by the official encoder, `@ag-ui/encoder`'s
 * `EventEncoder.encodeSSE` — a `data:` line holding the event's JSON, nothing
 * else — so a frame here is byte for byte what an AG-UI SDK writes and an AG-UI
 * client reads. The encoder is an OPTIONAL peer: it loads when a framing is
 * built (never when this module is imported), and a missing package is refused
 * at that moment by name, with the install line. A runtime whose loader cannot
 * reach it (a browser or edge bundle) passes the module it imported instead.
 *
 * Every value inside an event already passed the wire rule
 * (`lib/wireJson.ts`): the serializer renders an `Error` as its name, message
 * and code before an event is built, so the encoder's own `JSON.stringify`
 * never meets one.
 */

import { lazyRequire } from '../lib/lazyRequire.js';
import type { SseFraming } from '../hosting/stream.js';
import { sdkLoadFailure } from '../mcp/sdkLoadFailure.js';
import type { AgUiEvent } from './types.js';

/** What this framing needs from `@ag-ui/encoder` — its `EventEncoder`, structurally. */
export interface AgUiEncoderModule {
  readonly EventEncoder: new () => { encodeSSE(event: never): string };
}

/** Options for {@link agUiSse}. */
export interface AgUiSseOptions {
  /**
   * `@ag-ui/encoder`, imported by you — for a runtime where this package cannot
   * load it with its Node loader (a browser or edge bundle):
   * `import * as encoder from '@ag-ui/encoder'; agUiSse({ encoder })`.
   * Absent, the package is loaded here, once per framing.
   */
  readonly encoder?: AgUiEncoderModule;
}

/** The refusal for a missing `@ag-ui/encoder` — stated once, so every site says the same. */
export const AG_UI_ENCODER_MISSING =
  'AG-UI framing needs the `@ag-ui/encoder` peer dependency (AG-UI protocol 1.0).\n' +
  '  Install:  npm install @ag-ui/core @ag-ui/encoder\n' +
  '  Or pass the module you imported:  agUiSse({ encoder })';

/**
 * The AG-UI framing strategy: each AG-UI event → one `data: <json>` frame, as
 * `@ag-ui/encoder` writes it, under `text/event-stream`.
 *
 * @throws Error when `@ag-ui/encoder` is not installed (or cannot be loaded
 *   here) and no `encoder` was passed — the message names the install line.
 *
 * @example
 * ```ts
 * const framing = agUiSse();
 * for (const event of serializer.event(e)) res.write(framing.frame(event));
 * ```
 */
export function agUiSse(options: AgUiSseOptions = {}): SseFraming<AgUiEvent> {
  const module = options.encoder ?? loadEncoder();
  if (typeof module?.EventEncoder !== 'function') {
    throw new TypeError(
      'agUiSse: `encoder` must be the `@ag-ui/encoder` module — an object whose `EventEncoder` ' +
        'is a class. Pass `import * as encoder from "@ag-ui/encoder"`.',
    );
  }
  const encoder = new module.EventEncoder();
  return {
    contentType: 'text/event-stream',
    frame: (event) => encoder.encodeSSE(event as never),
  };
}

function loadEncoder(): AgUiEncoderModule {
  try {
    return lazyRequire<AgUiEncoderModule>('@ag-ui/encoder');
  } catch (err) {
    throw new Error(
      sdkLoadFailure(err, {
        notInstalled: AG_UI_ENCODER_MISSING,
        caller: 'agUiSse',
        specifier: '@ag-ui/encoder',
        instead: 'Import `@ag-ui/encoder` yourself and pass it: `agUiSse({ encoder })`.',
      }),
    );
  }
}
