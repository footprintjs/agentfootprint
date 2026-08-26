/**
 * agentCoreBrowser — AWS Bedrock AgentCore **Browser** as a {@link BrowserRunner}.
 *
 * A managed Chrome in AWS's account that an agent can drive, a person can watch
 * live, and — the part this adapter exists for — a person can TAKE OVER
 * mid-session and hand back.
 *
 * ── Two channels, and only one of them is here ───────────────────────────────
 * A browser session has two doors, and confusing them wastes a day:
 *
 *   1. **The automation stream** — a CDP WebSocket. Navigate, find an element,
 *      fill a form: everything page-shaped happens here, driven by Playwright
 *      or another CDP client. This adapter hands you
 *      {@link BrowserSession.automationEndpoint} and stays out of the way. It
 *      does not depend on Playwright and does not drive the page for you.
 *   2. **`InvokeBrowser`** — the data-plane operation this adapter calls. It is
 *      OS-LEVEL input ABOVE the page: mouse, keyboard, screenshots. Its action
 *      union, read off the SDK rather than remembered, is exactly
 *      `mouseClick | mouseMove | mouseDrag | mouseScroll | keyType | keyPress |
 *      keyShortcut | screenshot`. **There is no navigate action**, and a reader
 *      expecting one is looking at the wrong door.
 *
 * ── The takeover ─────────────────────────────────────────────────────────────
 * `UpdateBrowserStream` with `automationStreamUpdate.streamStatus` set to
 * `DISABLED` stops the automation channel and leaves the live-view user in
 * control; `ENABLED` gives it back. That is `handControlTo('person' | 'agent')`
 * here, and it composes with this library's check-in: the agent pauses, a
 * person finishes the login, the agent resumes on the page they left — and both
 * handovers are ordinary events in the trace.
 *
 * ── How this talks to the SDK (the 9.4.0 law) ────────────────────────────────
 * Through `client.send(new SomeCommand(input))`, never a method on the client —
 * a bare `@aws-sdk/client-*` Client carries `send` and `destroy` and nothing
 * else. Every command name and request shape below was read off a real install
 * of `@aws-sdk/client-bedrock-agentcore` **3.1118.0**, including the action
 * union above and `ScreenshotResult`'s `{ status, error?, data? }`.
 *
 * ── One documented contradiction, left as AWS wrote it ───────────────────────
 * The devguide says a session defaults to 15 minutes; `StartBrowserSession`'s
 * API reference says 3600 seconds. This adapter sends nothing unless you pass
 * `sessionTimeoutSeconds`, so the default is whatever the service applies —
 * rather than this file picking a side in somebody else's disagreement.
 *
 * Pattern: Adapter (GoF) + lazy peer-dep load — the SDK is required only when
 * `start()` first runs, or never, if you inject `_client` / `_sdk`.
 */

import type { BrowserDriver, BrowserRunner, BrowserSession, BrowserShot } from '../types.js';
import { lazyRequire } from '../../lib/lazyRequire.js';

/** AWS's managed browser. A custom `CreateBrowser` resource id goes here instead. */
export const AWS_SYSTEM_BROWSER = 'aws.browser.v1';

export interface AgentCoreBrowserOptions {
  /** AWS region. Falls back to the SDK's own resolution when omitted. */
  readonly region?: string;
  /** Which browser resource. Default {@link AWS_SYSTEM_BROWSER}. */
  readonly browserIdentifier?: string;
  /**
   * Session lifetime in seconds. **Left unset by default on purpose** — AWS's
   * own devguide (15 minutes) and API reference (3600 seconds) disagree, so
   * sending nothing lets the service apply whichever it actually means.
   */
  readonly sessionTimeoutSeconds?: number;
  /** Viewport for the session, when you want one that is not the default. */
  readonly viewport?: { readonly width: number; readonly height: number };
  /** Stable runner id (default `'agentcore-browser'`). */
  readonly id?: string;
  /** Test seam — inject a client implementing {@link AgentCoreBrowserClientLike}. */
  readonly _client?: AgentCoreBrowserClientLike;
  /** @internal Test injection — the AWS SDK module. */
  readonly _sdk?: BedrockAgentCoreBrowserSdkModule;
}

/** The operation-semantic surface this adapter calls. */
export interface AgentCoreBrowserClientLike {
  startBrowserSession(input: {
    readonly browserIdentifier: string;
    readonly name?: string;
    readonly sessionTimeoutSeconds?: number;
    readonly viewPort?: { readonly width: number; readonly height: number };
  }): Promise<{
    readonly sessionId?: string;
    readonly streams?: {
      readonly automationStream?: { readonly streamEndpoint?: string };
      readonly liveViewStream?: { readonly streamEndpoint?: string };
    };
  }>;
  invokeBrowser(input: {
    readonly browserIdentifier: string;
    readonly sessionId: string;
    readonly action: Readonly<Record<string, unknown>>;
  }): Promise<{ readonly result?: Readonly<Record<string, unknown>> }>;
  updateBrowserStream(input: {
    readonly browserIdentifier: string;
    readonly sessionId: string;
    readonly streamUpdate: {
      readonly automationStreamUpdate: { readonly streamStatus: 'ENABLED' | 'DISABLED' };
    };
  }): Promise<void>;
  stopBrowserSession(input: {
    readonly browserIdentifier: string;
    readonly sessionId: string;
  }): Promise<void>;
}

/** The slice of `@aws-sdk/client-bedrock-agentcore` this shim touches. */
export interface BedrockAgentCoreBrowserSdkModule {
  readonly BedrockAgentCoreClient?: new (config: { region?: string }) => {
    send(cmd: unknown): Promise<unknown>;
  };
  readonly StartBrowserSessionCommand?: new (input: unknown) => unknown;
  readonly InvokeBrowserCommand?: new (input: unknown) => unknown;
  readonly UpdateBrowserStreamCommand?: new (input: unknown) => unknown;
  readonly StopBrowserSessionCommand?: new (input: unknown) => unknown;
}

const BUTTONS = { left: 'LEFT', middle: 'MIDDLE', right: 'RIGHT' } as const;

function createBrowserClient(options: AgentCoreBrowserOptions): AgentCoreBrowserClientLike {
  let mod: BedrockAgentCoreBrowserSdkModule;
  if (options._sdk) {
    mod = options._sdk;
  } else {
    try {
      mod = lazyRequire<BedrockAgentCoreBrowserSdkModule>('@aws-sdk/client-bedrock-agentcore');
    } catch {
      throw new Error(
        'agentCoreBrowser requires the `@aws-sdk/client-bedrock-agentcore` peer dependency.\n' +
          '  Install:  npm install @aws-sdk/client-bedrock-agentcore\n' +
          '  Or pass `_client` for a pre-built or mock client.',
      );
    }
  }
  if (!mod.BedrockAgentCoreClient) {
    throw new Error(
      'agentCoreBrowser: `@aws-sdk/client-bedrock-agentcore` is installed but ' +
        '`BedrockAgentCoreClient` was not found. Update the SDK.',
    );
  }
  const sdk = new mod.BedrockAgentCoreClient({ ...(options.region && { region: options.region }) });

  const send = async (
    Ctor: (new (i: unknown) => unknown) | undefined,
    name: string,
    input: unknown,
  ): Promise<unknown> => {
    if (!Ctor) {
      throw new Error(
        `agentCoreBrowser: \`@aws-sdk/client-bedrock-agentcore\` is missing ${name}. ` +
          'Upgrade the SDK, or pass `_client` with your own mapping.',
      );
    }
    return sdk.send(new Ctor(input));
  };

  return {
    async startBrowserSession(input) {
      return (await send(
        mod.StartBrowserSessionCommand,
        'StartBrowserSessionCommand',
        input,
      )) as Awaited<ReturnType<AgentCoreBrowserClientLike['startBrowserSession']>>;
    },
    async invokeBrowser(input) {
      return (await send(mod.InvokeBrowserCommand, 'InvokeBrowserCommand', input)) as {
        result?: Readonly<Record<string, unknown>>;
      };
    },
    async updateBrowserStream(input) {
      await send(mod.UpdateBrowserStreamCommand, 'UpdateBrowserStreamCommand', input);
    },
    async stopBrowserSession(input) {
      await send(mod.StopBrowserSessionCommand, 'StopBrowserSessionCommand', input);
    },
  };
}

/**
 * Build a {@link BrowserRunner} backed by AgentCore Browser.
 *
 * @example  A session, a person taking over, and the agent resuming
 *   const browser = agentCoreBrowser({ region: 'us-east-1' });
 *   const session = await browser.start({ key: toolSessionKey(ctx, 'run') });
 *
 *   // Page work goes over CDP, not through this adapter:
 *   //   const page = await chromium.connectOverCDP(session.automationEndpoint!)
 *
 *   await session.handControlTo?.('person');   // they finish the login
 *   await session.handControlTo?.('agent');    // and the agent carries on
 *   await session.stop();
 */
export function agentCoreBrowser(options: AgentCoreBrowserOptions = {}): BrowserRunner {
  const browserIdentifier = options.browserIdentifier ?? AWS_SYSTEM_BROWSER;
  let client: AgentCoreBrowserClientLike | undefined;
  const getClient = (): AgentCoreBrowserClientLike => {
    client ??= options._client ?? createBrowserClient(options);
    return client;
  };

  return {
    id: options.id ?? 'agentcore-browser',
    async start(req) {
      const c = getClient();
      const started = await c.startBrowserSession({
        browserIdentifier,
        name: req.key,
        ...(options.sessionTimeoutSeconds !== undefined && {
          sessionTimeoutSeconds: options.sessionTimeoutSeconds,
        }),
        ...(options.viewport !== undefined && { viewPort: options.viewport }),
      });
      const sessionId = started.sessionId;
      if (!sessionId) {
        throw new Error(
          'agentCoreBrowser: StartBrowserSession returned no sessionId, so there is no session ' +
            'to drive. Check the browser identifier and the execution role.',
        );
      }

      const act = async (
        action: Readonly<Record<string, unknown>>,
      ): Promise<Readonly<Record<string, unknown>> | undefined> => {
        const answer = await c.invokeBrowser({ browserIdentifier, sessionId, action });
        return answer.result;
      };

      const automationEndpoint = started.streams?.automationStream?.streamEndpoint;
      const liveViewEndpoint = started.streams?.liveViewStream?.streamEndpoint;

      const session: BrowserSession = {
        id: sessionId,
        ...(automationEndpoint !== undefined && { automationEndpoint }),
        ...(liveViewEndpoint !== undefined && { liveViewEndpoint }),

        async click({ x, y, button, clicks }) {
          await act({
            mouseClick: {
              x,
              y,
              ...(button !== undefined && { button: BUTTONS[button] }),
              ...(clicks !== undefined && { clickCount: clicks }),
            },
          });
        },

        async type(text) {
          await act({ keyType: { text } });
        },

        async press({ key, times }) {
          await act({ keyPress: { key, ...(times !== undefined && { presses: times }) } });
        },

        async screenshot(): Promise<BrowserShot> {
          const result = await act({ screenshot: { format: 'PNG' } });
          const shot = result?.screenshot as
            | { status?: string; error?: string; data?: Uint8Array }
            | undefined;
          if (!shot?.data) {
            // The result member carries its own status and error, so a failed
            // screenshot says what the service said rather than answering with
            // an empty image that reads as a blank page.
            throw new Error(
              `agentCoreBrowser: the screenshot did not produce image data` +
                `${shot?.status ? ` (status ${shot.status})` : ''}` +
                `${shot?.error ? `: ${shot.error}` : '.'}`,
            );
          }
          return { data: shot.data, format: 'png' };
        },

        async handControlTo(driver: BrowserDriver) {
          // The person takes over by DISABLING automation: the live-view user
          // is already connected, and stopping the automation stream is what
          // lets their input through.
          await c.updateBrowserStream({
            browserIdentifier,
            sessionId,
            streamUpdate: {
              automationStreamUpdate: {
                streamStatus: driver === 'person' ? 'DISABLED' : 'ENABLED',
              },
            },
          });
        },

        async stop() {
          try {
            await c.stopBrowserSession({ browserIdentifier, sessionId });
          } catch {
            // A managed session reaped by its own idle timeout is the ordinary
            // case, and stopping one that is already gone is a no-op — the port
            // says so, and a throw here would fail a teardown that succeeded.
          }
        },
      };
      return session;
    },
  };
}
