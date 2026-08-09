/**
 * The AWS COMMAND-NAME PIN — one registry, one helper, every AWS adapter.
 *
 * ── The bug class this exists to end ─────────────────────────────────────────
 * An adapter is a translation, and the one part of it a type-checker cannot see
 * is WHICH OPERATION of the vendor's API it dispatches. `new SomeCommand(...)`
 * type-checks against a fake, runs green against a double that answers whatever
 * it is asked, and fails on the first real call — in somebody else's account,
 * weeks later.
 *
 * This package has shipped that bug THREE times:
 *   • 6.42.0 — `AgentCoreStore` dispatched `PutMemoryEventCommand` /
 *     `GetMemoryEventCommand` at the wrong service. No such commands exist.
 *   • 9.4.0 — `agentCorePolicy` dispatched `EvaluatePolicyCommand`. No such
 *     command exists, in any package; the adapter is retired in this release.
 *   • 9.4.0 — `agentCoreIdentity` called `client.getResourceOauth2Token(...)`
 *     as a METHOD. A bare `*Client` has only `send` and `destroy`; the
 *     shortcuts live on the aggregated client. 100% failure, and the message
 *     blamed the SDK version.
 *
 * Every one of them passed its tests, because every test injected past the SDK.
 *
 * ── What the pin asserts ─────────────────────────────────────────────────────
 *   1. **Dispatch** — driven through an `_sdk` double whose ONLY exports are the
 *      pinned names, each adapter reaches for exactly those. Reach for a name
 *      that is not in the registry and the adapter's own "missing command"
 *      refusal fires instead. Runs everywhere, offline, always.
 *   2. **Reality** — when the peer dep IS resolvable (a developer machine that
 *      installed it), every pinned name must be a real function export of that
 *      package. This is what makes the registry a claim about AWS rather than
 *      about ourselves. It is deliberately NOT a devDependency: six adapters in
 *      this repo prove their missing-peer-dep refusals by the SDK genuinely not
 *      being installed, and installing it to satisfy this check would delete
 *      those tests and let a test reach for real credentials.
 *   3. **Completeness** — every source file that LOADS an `@aws-sdk/*` package
 *      has a row here. A new AWS adapter cannot ship unpinned.
 *
 * Nothing in this file, or in any file that imports it, reaches AWS.
 */

import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const require_ = createRequire(import.meta.url);

/** Repo root, from `test/adapters/aws/`. */
export const REPO_ROOT = new URL('../../../', import.meta.url).pathname;

/** One AWS adapter's contract with its SDK. */
export interface AwsAdapterPin {
  /** The public name a consumer types. */
  readonly adapter: string;
  /** Source files this row covers, repo-relative. Drives the completeness check. */
  readonly sources: readonly string[];
  /** The peer-dep package the adapter loads. */
  readonly sdkPackage: string;
  /** The client constructor it builds (never an aggregated client). */
  readonly client: string;
  /** Every command constructor it dispatches. Empty is a claim too — see `note`. */
  readonly commands: readonly string[];
  /** Why a row has no commands, when it has none. */
  readonly note?: string;
}

/**
 * THE REGISTRY. Verified against the installed packages on 2026-08-09:
 * `@aws-sdk/client-bedrock-agentcore` 3.1066.0 (the version in the field
 * report) and 3.1106.0 for the rest. Assertion (2) below re-verifies this
 * wherever the packages are actually present, so the date is provenance rather
 * than the guarantee.
 */
export const AWS_COMMAND_PINS: readonly AwsAdapterPin[] = [
  {
    adapter: 'agentCoreIdentity',
    sources: ['src/adapters/identity/agentcore.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-agentcore',
    client: 'BedrockAgentCoreClient',
    commands: ['GetResourceOauth2TokenCommand', 'GetWorkloadAccessTokenForUserIdCommand'],
  },
  {
    adapter: 'AgentCoreStore',
    sources: ['src/adapters/memory/agentcore.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-agentcore',
    client: 'BedrockAgentCoreClient',
    commands: [
      'CreateEventCommand',
      'ListEventsCommand',
      'DeleteEventCommand',
      'RetrieveMemoryRecordsCommand',
    ],
  },
  {
    adapter: 'agentCoreSessions',
    sources: ['src/adapters/hosting/agentcore.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-agentcore',
    client: 'BedrockAgentCoreClient',
    commands: ['CreateEventCommand', 'ListEventsCommand'],
  },
  {
    adapter: 'agentCorePolicy (retired 9.4.0)',
    sources: ['src/adapters/security/agentcore.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-agentcore',
    client: 'BedrockAgentCoreClient',
    commands: [],
    note:
      'Dispatches nothing: the factory refuses at construction. It used to send ' +
      'EvaluatePolicyCommand, which does not exist — AgentCore has no data-plane ' +
      'policy evaluation, because policy is enforced at the Gateway. The row stays ' +
      'so that re-adding an SDK call here is a decision somebody has to record.',
  },
  {
    adapter: 'BedrockAgentMemory',
    sources: ['src/adapters/memory/bedrockAgentMemory.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-agent-runtime',
    client: 'BedrockAgentRuntimeClient',
    commands: ['GetAgentMemoryCommand', 'DeleteAgentMemoryCommand'],
  },
  {
    adapter: 's3VectorsStore',
    sources: ['src/adapters/memory/s3Vectors.ts'],
    sdkPackage: '@aws-sdk/client-s3vectors',
    client: 'S3VectorsClient',
    commands: [
      // The PREFLIGHT (9.4.0) — read the index before trusting it.
      'GetIndexCommand',
      'PutVectorsCommand',
      'QueryVectorsCommand',
      'GetVectorsCommand',
      'ListVectorsCommand',
      'DeleteVectorsCommand',
    ],
  },
  {
    adapter: 'cloudwatchObservability / agentcoreObservability',
    sources: ['src/adapters/observability/cloudwatch.ts'],
    sdkPackage: '@aws-sdk/client-cloudwatch-logs',
    client: 'CloudWatchLogsClient',
    commands: ['PutLogEventsCommand', 'CreateLogStreamCommand'],
  },
  {
    adapter: 'xrayObservability',
    sources: ['src/adapters/observability/xray.ts'],
    sdkPackage: '@aws-sdk/client-xray',
    client: 'XRayClient',
    commands: ['PutTraceSegmentsCommand'],
  },
  {
    adapter: 'bedrockEmbedder',
    sources: ['src/embedders/index.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-runtime',
    client: 'BedrockRuntimeClient',
    commands: ['InvokeModelCommand'],
  },
  {
    adapter: 'bedrock (LLM provider)',
    sources: ['src/adapters/llm/BedrockProvider.ts'],
    sdkPackage: '@aws-sdk/client-bedrock-runtime',
    client: 'BedrockRuntimeClient',
    commands: ['ConverseCommand', 'ConverseStreamCommand'],
  },
];

/** One command as it reached `send()`: the operation, and what it carried. */
export interface SentCommand {
  /** The SDK export name the adapter constructed, e.g. `'PutVectorsCommand'`. */
  readonly command: string;
  readonly input: Record<string, unknown>;
}

/** How a fake SDK answers one operation: a value, or a function of the input. */
export type SdkAnswer = unknown | ((input: Record<string, unknown>) => unknown);

export interface FakeSdk {
  /** Pass as the adapter's `_sdk`. */
  readonly module: Record<string, unknown>;
  /** Every command that reached `send()`, in order. */
  readonly sent: SentCommand[];
  /** Just the export names, for a one-line assertion. */
  names(): string[];
}

/**
 * Build a fake SDK module for one pinned adapter.
 *
 * It exports the client and EXACTLY the pinned command names — nothing else.
 * That is the whole trick: an adapter reaching for an unpinned command finds
 * `undefined` and raises its own "missing command" refusal, so the test fails
 * on the dispatch rather than on a mystery downstream.
 *
 * @param pin      the registry row
 * @param answers  per-command replies, keyed by SDK export name
 */
export function fakeSdk(pin: AwsAdapterPin, answers: Record<string, SdkAnswer> = {}): FakeSdk {
  const sent: SentCommand[] = [];
  const module: Record<string, unknown> = {};

  for (const name of pin.commands) {
    module[name] = class {
      static readonly __command = name;
      readonly __command = name;
      readonly __input: Record<string, unknown>;
      constructor(input: Record<string, unknown>) {
        this.__input = input ?? {};
      }
    };
  }

  module[pin.client] = class {
    constructor(readonly config: { region?: string } = {}) {}
    async send(cmd: unknown): Promise<unknown> {
      const c = cmd as { __command?: string; __input?: Record<string, unknown> };
      const command = c.__command ?? '(not a pinned command)';
      const input = c.__input ?? {};
      sent.push({ command, input });
      const answer = answers[command];
      return typeof answer === 'function'
        ? (answer as (i: Record<string, unknown>) => unknown)(input)
        : answer ?? {};
    }
    destroy(): void {
      /* the real client has one; nothing to do here */
    }
  };

  return { module, sent, names: () => sent.map((s) => s.command) };
}

/**
 * The installed peer dep, when it IS installed.
 *
 * `undefined` is the normal answer in this repo and in CI: the AWS SDKs are
 * deliberately absent so the missing-peer-dep refusals can be tested for real.
 * The reality check below reports which packages it could and could not reach,
 * so an empty run is visible rather than silently vacuous.
 */
export function realSdk(sdkPackage: string): Record<string, unknown> | undefined {
  try {
    return require_(sdkPackage) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/**
 * Every source file that LOADS an `@aws-sdk/*` package, with the packages it
 * loads. Matches real load sites only — a package NAMED in prose is not a
 * dependency, and `lazyRequire`'s own doc comment names several.
 */
export function findAwsLoadSites(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const srcRoot = join(REPO_ROOT, 'src');
  const loadSite =
    /(?:lazyRequire\s*(?:<[^>]*>)?\s*\(|(?:^|[^.\w])require\s*\(|\bimport\s*\(|\bfrom\s+)\s*['"](@aws-sdk\/[^'"]+)['"]/g;

  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!name.endsWith('.ts')) continue;
      const text = readFileSync(full, 'utf8');
      let match: RegExpExecArray | null;
      loadSite.lastIndex = 0;
      while ((match = loadSite.exec(text)) !== null) {
        const key = relative(REPO_ROOT, full);
        const set = out.get(key) ?? new Set<string>();
        set.add(match[1]!);
        out.set(key, set);
      }
    }
  };

  walk(srcRoot);
  return out;
}
