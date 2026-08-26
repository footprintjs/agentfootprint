/**
 * agentCoreBrowser — the managed browser, and the handover that is the point.
 *
 * Every action name, argument field and result shape asserted here was read off
 * a real install of `@aws-sdk/client-bedrock-agentcore` 3.1118.0 before the
 * adapter was written — the 9.4.0 law. That verification changed the design
 * once, and the change is worth naming: the `InvokeBrowser` action union is
 * `mouseClick | mouseMove | mouseDrag | mouseScroll | keyType | keyPress |
 * keyShortcut | screenshot`, with **no navigate action at all**. Navigation
 * lives on the CDP channel, which this adapter hands over and does not drive.
 *
 * Nothing here reaches AWS.
 */

import { describe, expect, it } from 'vitest';

import {
  agentCoreBrowser,
  AWS_SYSTEM_BROWSER,
  type AgentCoreBrowserClientLike,
} from '../../../src/adapters/browser/agentcore.js';

interface Call {
  readonly op: string;
  readonly input: Record<string, unknown>;
}

function spyClient(
  overrides: Partial<AgentCoreBrowserClientLike> = {},
  started: Record<string, unknown> = {},
): { client: AgentCoreBrowserClientLike; calls: Call[] } {
  const calls: Call[] = [];
  const client: AgentCoreBrowserClientLike = {
    async startBrowserSession(input) {
      calls.push({ op: 'start', input: { ...input } });
      return {
        sessionId: 'sess-1',
        streams: {
          automationStream: { streamEndpoint: 'wss://automation.example/cdp' },
          liveViewStream: { streamEndpoint: 'wss://live.example/view' },
        },
        ...started,
      };
    },
    async invokeBrowser(input) {
      calls.push({ op: 'invoke', input: { ...input } });
      return { result: { screenshot: { status: 'SUCCESS', data: new Uint8Array([1, 2, 3]) } } };
    },
    async updateBrowserStream(input) {
      calls.push({ op: 'updateStream', input: { ...input } });
    },
    async stopBrowserSession(input) {
      calls.push({ op: 'stop', input: { ...input } });
    },
    ...overrides,
  };
  return { client, calls };
}

// ─── the session ─────────────────────────────────────────────────────

describe('opening and releasing a session', () => {
  it('starts on the managed browser and carries the isolation key as the name', async () => {
    const { client, calls } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'run:abc' });

    expect(calls[0]).toEqual({
      op: 'start',
      input: { browserIdentifier: AWS_SYSTEM_BROWSER, name: 'run:abc' },
    });
    expect(session.id).toBe('sess-1');
  });

  it('sends NO timeout unless asked — AWS’s own docs disagree about the default', async () => {
    const { client, calls } = spyClient();
    await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    // The devguide says 15 minutes; the API reference says 3600 seconds. Sending
    // nothing lets the service apply whichever it means, rather than this
    // adapter picking a side in somebody else's contradiction.
    expect(calls[0]?.input).not.toHaveProperty('sessionTimeoutSeconds');

    const explicit = spyClient();
    await agentCoreBrowser({ _client: explicit.client, sessionTimeoutSeconds: 600 }).start({
      key: 'k',
    });
    expect(explicit.calls[0]?.input.sessionTimeoutSeconds).toBe(600);
  });

  it('exposes both stream endpoints — the agent’s and the person’s', async () => {
    const { client } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    // The CDP endpoint is handed over, not driven: this library does not depend
    // on Playwright and does not do page work.
    expect(session.automationEndpoint).toBe('wss://automation.example/cdp');
    expect(session.liveViewEndpoint).toBe('wss://live.example/view');
  });

  it('omits an endpoint the backend did not offer', async () => {
    const { client } = spyClient({}, { streams: { automationStream: {} } });
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    expect(session.automationEndpoint).toBeUndefined();
    expect(session.liveViewEndpoint).toBeUndefined();
  });

  it('refuses a start that produced no session rather than returning a broken one', async () => {
    const { client } = spyClient({
      startBrowserSession: async () => ({}),
    });
    await expect(agentCoreBrowser({ _client: client }).start({ key: 'k' })).rejects.toThrow(
      /no sessionId/,
    );
  });

  it('tolerates stopping a session the far side already reaped', async () => {
    const { client } = spyClient({
      stopBrowserSession: async () => {
        throw new Error('ResourceNotFoundException: session is gone');
      },
    });
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    // An idle timeout is the ordinary case on a managed backend. A throw here
    // would fail a teardown that actually succeeded.
    await expect(session.stop()).resolves.toBeUndefined();
  });
});

// ─── OS-level input ──────────────────────────────────────────────────

describe('the actions InvokeBrowser actually has', () => {
  it('clicks with the SDK’s own field and enum spellings', async () => {
    const { client, calls } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    await session.click({ x: 12, y: 34, button: 'right', clicks: 2 });

    const invoke = calls.find((c) => c.op === 'invoke')!;
    expect(invoke.input.sessionId).toBe('sess-1');
    expect(invoke.input.action).toEqual({
      mouseClick: { x: 12, y: 34, button: 'RIGHT', clickCount: 2 },
    });
  });

  it('omits optional click fields rather than sending defaults', async () => {
    const { client, calls } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    await session.click({ x: 1, y: 2 });
    expect(calls.find((c) => c.op === 'invoke')!.input.action).toEqual({
      mouseClick: { x: 1, y: 2 },
    });
  });

  it('types and presses through keyType / keyPress', async () => {
    const { client, calls } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    await session.type('hello');
    await session.press({ key: 'Enter', times: 3 });

    const actions = calls.filter((c) => c.op === 'invoke').map((c) => c.input.action);
    expect(actions[0]).toEqual({ keyType: { text: 'hello' } });
    expect(actions[1]).toEqual({ keyPress: { key: 'Enter', presses: 3 } });
  });

  it('returns screenshot bytes, and refuses an empty one by what the service said', async () => {
    const { client } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    const shot = await session.screenshot();
    expect(shot.format).toBe('png');
    expect(Array.from(shot.data)).toEqual([1, 2, 3]);

    const failing = spyClient({
      invokeBrowser: async () => ({
        result: { screenshot: { status: 'ERROR', error: 'display not ready' } },
      }),
    });
    const bad = await agentCoreBrowser({ _client: failing.client }).start({ key: 'k' });
    // A blank image would read as a blank page. The refusal repeats the
    // service's own status and message instead.
    await expect(bad.screenshot()).rejects.toThrow(/status ERROR.*display not ready/);
  });
});

// ─── the handover ────────────────────────────────────────────────────

describe('handing the controls to a person, and taking them back', () => {
  it('gives control away by DISABLING the automation stream', async () => {
    const { client, calls } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });

    await session.handControlTo?.('person');
    await session.handControlTo?.('agent');

    const updates = calls
      .filter((c) => c.op === 'updateStream')
      .map(
        (c) =>
          (c.input.streamUpdate as { automationStreamUpdate: { streamStatus: string } })
            .automationStreamUpdate.streamStatus,
      );
    // The live-view user is already connected; stopping automation is what lets
    // their input through. Enabling it takes the wheel back.
    expect(updates).toEqual(['DISABLED', 'ENABLED']);
  });

  it('names the session it is handing over', async () => {
    const { client, calls } = spyClient();
    const session = await agentCoreBrowser({ _client: client }).start({ key: 'k' });
    await session.handControlTo?.('person');
    const update = calls.find((c) => c.op === 'updateStream')!;
    expect(update.input.sessionId).toBe('sess-1');
    expect(update.input.browserIdentifier).toBe(AWS_SYSTEM_BROWSER);
  });
});

// ─── the SDK shim ────────────────────────────────────────────────────

describe('the SDK shim uses send(new Command(...)), not a method on the client', () => {
  it('dispatches each operation by its real command name', async () => {
    const sent: string[] = [];
    const command = (name: string) =>
      class {
        readonly __command = name;
        constructor(readonly __input: unknown) {}
      } as unknown as new (input: unknown) => unknown;

    const runner = agentCoreBrowser({
      region: 'us-east-1',
      _sdk: {
        BedrockAgentCoreClient: class {
          async send(cmd: unknown): Promise<unknown> {
            const c = cmd as { __command: string };
            sent.push(c.__command);
            return c.__command === 'StartBrowserSessionCommand' ? { sessionId: 's' } : {};
          }
        } as never,
        StartBrowserSessionCommand: command('StartBrowserSessionCommand'),
        InvokeBrowserCommand: command('InvokeBrowserCommand'),
        UpdateBrowserStreamCommand: command('UpdateBrowserStreamCommand'),
        StopBrowserSessionCommand: command('StopBrowserSessionCommand'),
      },
    });

    const session = await runner.start({ key: 'k' });
    await session.type('x');
    await session.handControlTo?.('person');
    await session.stop();

    expect(sent).toEqual([
      'StartBrowserSessionCommand',
      'InvokeBrowserCommand',
      'UpdateBrowserStreamCommand',
      'StopBrowserSessionCommand',
    ]);
  });

  it('names the missing command when an SDK is too old to have it', async () => {
    const runner = agentCoreBrowser({
      _sdk: {
        BedrockAgentCoreClient: class {
          async send(): Promise<unknown> {
            return {};
          }
        } as never,
        // StartBrowserSessionCommand deliberately absent.
      },
    });
    await expect(runner.start({ key: 'k' })).rejects.toThrow(/missing StartBrowserSessionCommand/);
  });
});
