/**
 * githubBugReporter — 7-pattern tests.
 *
 *   P1 Unit         — the two calls, the paths, the labels, the issue body
 *   P2 Boundary     — evidenceRepo defaults to issueRepo; a taken filename is
 *                     suffixed, never overwritten; a visibility check that
 *                     cannot run does not block the report
 *   P3 Scenario     — TWIN TARGETS: public issue repo + private evidence repo,
 *                     and the issue says so
 *   P4 Property     — the token travels in a header and nowhere else; every
 *                     call carries it; no call carries it in a body
 *   P5 Security     — THE SECRECY PIN: no failure path can put the token in a
 *                     message; GitHub's `message` field only, never the body;
 *                     a PUBLIC evidence repo is refused; oversize refused
 *                     BEFORE the upload
 *   P6 Performance  — three HTTP calls on the happy path, and none at all when
 *                     a refusal fires first
 *   P7 ROI          — one call files the issue and returns both URLs
 *
 * No network: every test drives the `_fetch` seam.
 */

import { describe, expect, it } from 'vitest';

import { githubBugReporter, exportBugReport } from '../../src/doors/observe.js';
import type { BugReport, Recording } from '../../src/doors/observe.js';

// ── The secrets under test. Nothing in this file may echo them. ──────

const TOKEN = 'github_pat_11ABCDEFG0FAKEfakeFAKEtoken_9821';
const OTHER_SECRET = 'ghp_secondFakeToken_31337';
const SECRETS = [TOKEN, OTHER_SECRET];

const FIXED = new Date(Date.UTC(2026, 7, 11, 9, 0, 0));

const FIELDS = {
  title: 'Agent answered with a stale price',
  stepsToReproduce: '1. ask\n2. update\n3. ask again',
  expected: 'the new price',
  actual: 'the old one',
};

function recording(options: { secretInState?: string } = {}): Recording {
  const meta = {
    wallClockMs: 0,
    runOffsetMs: 0,
    runtimeStageId: 'seed#0',
    subflowPath: [],
    compositionPath: [],
    runId: 'run-1',
  };
  return {
    snapshot: {
      commitLog: [],
      sharedState: { price: 42, ...(options.secretInState && { note: options.secretInState }) },
    },
    events: [
      { type: 'agentfootprint.agent.turn_start', payload: { turnIndex: 0, userPrompt: 'q' }, meta },
      {
        type: 'agentfootprint.stream.llm_end',
        payload: { iteration: 0, content: 'a', toolCallCount: 0, stopReason: 'stop' },
        meta,
      },
    ] as Recording['events'],
    structure: { nodes: [] },
  };
}

const report = (options: { secretInState?: string; oversize?: boolean } = {}): BugReport =>
  exportBugReport(recording(options), {
    ...FIELDS,
    now: FIXED,
    ...(options.oversize && { warnOverBytes: 100 }),
  });

// ── A scripted GitHub ────────────────────────────────────────────────

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string;
}

interface Script {
  /** `private` for the repo metadata call; `undefined` = the call 404s. */
  readonly repoPrivate?: boolean;
  /** Status for the metadata call. Default 200 (or 404 when repoPrivate is undefined). */
  readonly repoStatus?: number;
  /** How many PUTs answer "already exists" before one succeeds. */
  readonly takenNames?: number;
  /** Force a status on the contents PUT. */
  readonly putStatus?: number;
  /** Force a status on the issue POST. */
  readonly issueStatus?: number;
  /** GitHub's `message` field on a failure — the thing that MAY be surfaced. */
  readonly message?: string;
  /** Something in the response body that must NEVER be surfaced. */
  readonly leakInBody?: string;
  /** Throw from fetch itself. */
  readonly transportError?: Error;
}

function fakeGithub(script: Script = {}): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let puts = 0;
  const impl = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    const options = (init ?? {}) as {
      method?: string;
      headers?: Record<string, string>;
      body?: string;
    };
    calls.push({
      url,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
      body: options.body ?? '',
    });
    if (script.transportError) throw script.transportError;

    const fail = (status: number): Response =>
      new Response(
        JSON.stringify({
          message: script.message ?? 'Not Found',
          documentation_url: 'https://docs.github.com/rest',
          ...(script.leakInBody && { errors: [{ resource: script.leakInBody }] }),
        }),
        { status },
      );

    // 1. repo metadata
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
      if (script.repoStatus && script.repoStatus >= 400) return fail(script.repoStatus);
      if (script.repoPrivate === undefined) return fail(404);
      return new Response(JSON.stringify({ private: script.repoPrivate }), { status: 200 });
    }
    // 2. contents PUT
    if (url.includes('/contents/')) {
      puts++;
      if (script.putStatus && script.putStatus >= 400) return fail(script.putStatus);
      if (script.takenNames && puts <= script.takenNames) return fail(422);
      const path = decodeURIComponent(url.split('/contents/')[1] ?? '');
      return new Response(
        JSON.stringify({
          content: { path, html_url: `https://github.example/blob/main/${path}` },
        }),
        { status: 201 },
      );
    }
    // 3. issue POST
    if (url.endsWith('/issues')) {
      if (script.issueStatus && script.issueStatus >= 400) return fail(script.issueStatus);
      return new Response(
        JSON.stringify({ html_url: 'https://github.example/issues/7', number: 7 }),
        {
          status: 201,
        },
      );
    }
    return fail(404);
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

const reporterFor = (script: Script = {}, options: Record<string, unknown> = {}) => {
  const github = fakeGithub(script);
  return {
    github,
    reporter: githubBugReporter({
      issueRepo: 'acme/checkout-agent',
      token: TOKEN,
      _fetch: github.fetch,
      ...options,
    }),
  };
};

/** Every string a failure can put in front of a human or a model. */
async function failureStrings(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    const error = err as Error;
    return [
      error.message,
      error.stack ?? '',
      JSON.stringify(error, Object.getOwnPropertyNames(error)),
    ].join('\n');
  }
  throw new Error('expected the call to fail, and it did not');
}

// ─── P1 Unit ─────────────────────────────────────────────────────────

describe('githubBugReporter — P1 unit', () => {
  it('P1 commits the zip, then files the issue', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true });
    await reporter.file(report());
    const [metadata, put, issue] = github.calls;
    expect(metadata!.url).toBe('https://api.github.com/repos/acme/checkout-agent');
    expect(put!.method).toBe('PUT');
    expect(put!.url).toMatch(
      /\/repos\/acme\/checkout-agent\/contents\/bug-reports\/2026-08-11-agent-answered-with-a-stale-price-[0-9a-z]{6}\.zip$/,
    );
    expect(issue!.method).toBe('POST');
    expect(issue!.url).toBe('https://api.github.com/repos/acme/checkout-agent/issues');
  });

  it('P1 `dir`, `labels`, `branch` and `apiBase` all land where they should', async () => {
    const { reporter, github } = reporterFor(
      { repoPrivate: true },
      {
        dir: 'evidence/2026',
        labels: ['bug', 'from-the-field'],
        branch: 'evidence',
        apiBase: 'https://github.acme.internal/api/v3',
      },
    );
    await reporter.file(report());
    const put = github.calls[1]!;
    expect(put.url).toContain('https://github.acme.internal/api/v3/repos/');
    expect(put.url).toContain('/contents/evidence/2026/');
    expect(JSON.parse(put.body)).toMatchObject({ branch: 'evidence' });
    expect(JSON.parse(github.calls[2]!.body)).toMatchObject({
      labels: ['bug', 'from-the-field'],
    });
  });

  it('P1 the issue body carries steps, the manifest table, the link and the environment', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true });
    await reporter.file(report());
    const body = JSON.parse(github.calls[2]!.body) as { title: string; body: string };
    expect(body.title).toBe(FIELDS.title);
    expect(body.body).toContain('### Steps to reproduce');
    expect(body.body).toContain('the old one');
    expect(body.body).toContain('| `manifest.json` |');
    expect(body.body).toContain('https://github.example/blob/main/bug-reports/');
    expect(body.body).toContain('### Environment');
    expect(body.body).toContain('node ');
  });

  it('P1 the zip travels as base64, and decodes back to the same bytes', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true });
    const bundle = report();
    await reporter.file(bundle);
    const sent = JSON.parse(github.calls[1]!.body) as { content: string };
    expect(Buffer.from(sent.content, 'base64').equals(Buffer.from(bundle.zip))).toBe(true);
  });
});

// ─── P2 Boundary ─────────────────────────────────────────────────────

describe('githubBugReporter — P2 boundary', () => {
  it('P2 evidenceRepo defaults to issueRepo', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true });
    const filed = await reporter.file(report());
    expect(filed.evidenceRepo).toBe('acme/checkout-agent');
    expect(github.calls[1]!.url).toContain('/repos/acme/checkout-agent/contents/');
  });

  it('P2 a name already taken is SUFFIXED, never overwritten', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true, takenNames: 2 });
    const filed = await reporter.file(report());
    const puts = github.calls.filter((call) => call.method === 'PUT');
    expect(puts).toHaveLength(3);
    expect(new Set(puts.map((call) => call.url)).size).toBe(3);
    // No `sha` anywhere: this reporter cannot replace an existing file even if
    // it wanted to — somebody else's evidence stays where it is.
    for (const put of puts) expect(JSON.parse(put.body).sha).toBeUndefined();
    expect(filed.zipPath).toContain('bug-reports/');
  });

  it('P2 five taken names in a row is a refusal that names the cause', async () => {
    const { reporter } = reporterFor({ repoPrivate: true, takenNames: 99 });
    await expect(reporter.file(report())).rejects.toThrow(
      /five names in 'bug-reports\/' were already taken/,
    );
  });

  it('P2 a visibility check that cannot run does not block the report — it is REPORTED', async () => {
    const { reporter } = reporterFor({ repoStatus: 403 });
    const filed = await reporter.file(report());
    expect(filed.checkedVisibility).toBe(false);
    expect(filed.evidenceRepoPrivate).toBeUndefined();
    expect(filed.issueUrl).toBe('https://github.example/issues/7');
  });

  it('P2 a transport failure on the metadata call is not fatal either', async () => {
    const github = fakeGithub({ repoPrivate: true });
    let first = true;
    const flaky = (async (url: unknown, init?: unknown) => {
      if (first && /\/repos\/[^/]+\/[^/]+$/.test(String(url))) {
        first = false;
        throw new Error('ECONNRESET');
      }
      return github.fetch(url as string, init as RequestInit);
    }) as unknown as typeof fetch;
    const reporter = githubBugReporter({
      issueRepo: 'acme/checkout-agent',
      token: TOKEN,
      _fetch: flaky,
    });
    expect((await reporter.file(report())).checkedVisibility).toBe(false);
  });

  it('P2 a malformed repo is refused, naming both options', () => {
    expect(() => githubBugReporter({ issueRepo: 'checkout-agent', token: TOKEN })).toThrow(
      /`issueRepo` must be 'owner\/name'/,
    );
    expect(() =>
      githubBugReporter({ issueRepo: 'acme/a', evidenceRepo: 'nope', token: TOKEN }),
    ).toThrow(/`evidenceRepo` must be 'owner\/name'/);
  });

  it('P2 something that is not a bug report is refused by shape', async () => {
    const { reporter } = reporterFor({ repoPrivate: true });
    await expect(reporter.file({} as BugReport)).rejects.toThrow(/exportBugReport\(\) returns/);
  });
});

// ─── P3 Scenario — twin targets ──────────────────────────────────────

describe('githubBugReporter — P3 scenario (twin targets)', () => {
  it('P3 issue to the public repo, evidence to the private one, and the issue says so', async () => {
    const { reporter, github } = reporterFor(
      { repoPrivate: true },
      { issueRepo: 'footprintjs/agentfootprint', evidenceRepo: 'acme/af-bug-evidence' },
    );
    const filed = await reporter.file(report());

    expect(github.calls[0]!.url).toContain('/repos/acme/af-bug-evidence');
    expect(github.calls[1]!.url).toContain('/repos/acme/af-bug-evidence/contents/');
    expect(github.calls[2]!.url).toContain('/repos/footprintjs/agentfootprint/issues');

    const body = (JSON.parse(github.calls[2]!.body) as { body: string }).body;
    expect(body).toContain('`acme/af-bug-evidence`');
    expect(body).toContain('private repository visible to maintainers');
    expect(filed).toMatchObject({
      evidenceRepo: 'acme/af-bug-evidence',
      checkedVisibility: true,
      evidenceRepoPrivate: true,
    });
  });

  it('P3 an acknowledged PUBLIC evidence repo is labelled as public in the issue', async () => {
    const { reporter, github } = reporterFor(
      { repoPrivate: false },
      {
        issueRepo: 'footprintjs/agentfootprint',
        evidenceRepo: 'acme/public-evidence',
        acknowledgePublicEvidence: true,
      },
    );
    await reporter.file(report());
    expect((JSON.parse(github.calls[2]!.body) as { body: string }).body).toContain(
      'a separate PUBLIC repository',
    );
  });

  it('P3 a subset selection is stated in the issue body', async () => {
    const bundle = exportBugReport([recording(), recording()], {
      ...FIELDS,
      include: ['conv-1', 'file-environment'],
      now: FIXED,
    });
    const { reporter, github } = reporterFor({ repoPrivate: true });
    await reporter.file(bundle);
    expect((JSON.parse(github.calls[2]!.body) as { body: string }).body).toContain(
      'The reporter chose a subset',
    );
  });
});

// ─── P4 Property ─────────────────────────────────────────────────────

describe('githubBugReporter — P4 property', () => {
  it('P4 the token is in the Authorization header of every call, and in no body', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true });
    await reporter.file(report());
    expect(github.calls).toHaveLength(3);
    for (const call of github.calls) {
      expect(call.headers.authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
      expect(call.body).not.toContain(TOKEN);
    }
  });

  it('P4 the token is read from GITHUB_TOKEN when no option is passed', async () => {
    const previous = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = OTHER_SECRET;
    try {
      const github = fakeGithub({ repoPrivate: true });
      const reporter = githubBugReporter({ issueRepo: 'acme/a', _fetch: github.fetch });
      await reporter.file(report());
      expect(github.calls[0]!.headers.authorization).toBe(`Bearer ${OTHER_SECRET}`);
    } finally {
      if (previous === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = previous;
    }
  });
});

// ─── P5 Security — THE SECRECY PIN ───────────────────────────────────

describe('githubBugReporter — P5 security', () => {
  it('P5 no failure path can put the token in a message, a stack or a JSON projection', async () => {
    const bundle = report({ secretInState: OTHER_SECRET });
    const failing = (script: Script, options: Record<string, unknown> = {}) =>
      failureStrings(() => reporterFor(script, options).reporter.file(bundle));

    const failures = await Promise.all([
      // Evidence repo 404 — the twin-target typo, and the private-repo-no-access case.
      failing({ repoPrivate: true, putStatus: 404 }, { evidenceRepo: 'acme/nope' }),
      // Issue repo 403.
      failing({ repoPrivate: true, issueStatus: 403 }),
      failing({ repoPrivate: true, issueStatus: 401 }),
      failing({ repoPrivate: true, issueStatus: 410 }),
      // Visibility check itself fails, then the upload does too.
      failing({ repoStatus: 500, putStatus: 500 }),
      // Every name taken.
      failing({ repoPrivate: true, takenNames: 99 }),
      // A response body that smuggles a secret into `errors[]`.
      failing({ repoPrivate: true, putStatus: 422, leakInBody: OTHER_SECRET }),
      // A transport error that embeds the auth header — the classic leak.
      failing({
        repoPrivate: true,
        transportError: new Error(
          `connect ECONNREFUSED — request was PUT /repos/a/b/contents/x.zip with ` +
            `authorization: Bearer ${TOKEN}`,
        ),
      }),
      // The public-evidence refusal.
      failing({ repoPrivate: false }, { evidenceRepo: 'acme/public-evidence' }),
      // Oversize, refused before anything moves.
      failureStrings(() =>
        reporterFor({ repoPrivate: true }, { maxZipBytes: 10 }).reporter.file(bundle),
      ),
    ]);

    for (const text of failures) {
      for (const secret of SECRETS) {
        expect(text, `a failure message leaked a secret:\n${text}`).not.toContain(secret);
      }
      // Nor the header whose value is the token: naming it is one refactor away
      // from naming what it carried.
      expect(text.toLowerCase()).not.toContain('bearer ');
    }
  });

  it('P5 a non-2xx names the status and GitHub’s message field — never the response body', async () => {
    const text = await failureStrings(() =>
      reporterFor({
        repoPrivate: true,
        issueStatus: 403,
        message: 'Resource not accessible by personal access token',
        leakInBody: 'internal-only-detail',
      }).reporter.file(report()),
    );
    expect(text).toContain('403');
    expect(text).toContain('Resource not accessible by personal access token');
    expect(text).toContain("file the issue on 'acme/checkout-agent'");
    expect(text).not.toContain('internal-only-detail');
    expect(text).not.toContain('documentation_url');
  });

  it('P5 a PUBLIC evidence repo is refused, teaching the private-evidence pattern', async () => {
    const { reporter, github } = reporterFor(
      { repoPrivate: false },
      { evidenceRepo: 'acme/public-evidence' },
    );
    await expect(reporter.file(report())).rejects.toThrow(
      /refusing to commit evidence to 'acme\/public-evidence'.*acknowledgePublicEvidence: true/s,
    );
    // Refused BEFORE the upload: only the metadata call happened.
    expect(github.calls).toHaveLength(1);
  });

  it('P5 `acknowledgePublicEvidence` is the deliberate opt-out', async () => {
    const { reporter } = reporterFor(
      { repoPrivate: false },
      { evidenceRepo: 'acme/public-evidence', acknowledgePublicEvidence: true },
    );
    expect((await reporter.file(report())).evidenceRepoPrivate).toBe(false);
  });

  it('P5 no token is a refusal that teaches env vs option AND fine-grained scoping', () => {
    const previous = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      expect(() =>
        githubBugReporter({ issueRepo: 'acme/a', evidenceRepo: 'acme/evidence' }),
      ).toThrow(/GITHUB_TOKEN environment variable/);
      expect(() =>
        githubBugReporter({ issueRepo: 'acme/a', evidenceRepo: 'acme/evidence' }),
      ).toThrow(/Fine-grained tokens.*acme\/a and acme\/evidence.*Contents: read\/write/s);
    } finally {
      if (previous !== undefined) process.env.GITHUB_TOKEN = previous;
    }
  });

  it('P5 a 403 hint names the two permissions a fine-grained token needs', async () => {
    const text = await failureStrings(() =>
      reporterFor({ repoPrivate: true, issueStatus: 403 }).reporter.file(report()),
    );
    expect(text).toMatch(/Contents: read\/write.*Issues: read\/write/s);
  });

  it('P5 the bundle’s own bytes never appear in an error', async () => {
    // The upload body is the base64 of the evidence. An error that echoed the
    // request would carry the whole run into a log line.
    const bundle = report({ secretInState: OTHER_SECRET });
    let message = '';
    try {
      await reporterFor({ repoPrivate: true, putStatus: 500 }).reporter.file(bundle);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('500');
    expect(message).not.toContain('base64');
    expect(message).not.toContain(OTHER_SECRET);
    // No long base64-looking run anywhere in it.
    expect(message).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/);
    expect(message.length).toBeLessThan(500);
  });
});

// ─── P6 Performance ──────────────────────────────────────────────────

describe('githubBugReporter — P6 performance', () => {
  it('P6 three HTTP calls on the happy path — metadata, contents, issue', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true });
    await reporter.file(report());
    expect(github.calls.map((call) => call.method)).toEqual(['GET', 'PUT', 'POST']);
  });

  it('P6 an oversized bundle is refused with ZERO calls, quoting the trim hints', async () => {
    const { reporter, github } = reporterFor({ repoPrivate: true }, { maxZipBytes: 500 });
    await expect(reporter.file(report({ oversize: true }))).rejects.toThrow(
      /refusing to upload.*the ceiling is 500 bytes.*Send fewer units/s,
    );
    expect(github.calls).toHaveLength(0);
  });
});

// ─── P7 ROI ──────────────────────────────────────────────────────────

describe('githubBugReporter — P7 ROI', () => {
  it('P7 one call returns the issue and the evidence, both linkable', async () => {
    const { reporter } = reporterFor({ repoPrivate: true });
    const filed = await reporter.file(report());
    expect(filed.issueUrl).toBe('https://github.example/issues/7');
    expect(filed.zipUrl).toContain('https://github.example/blob/main/bug-reports/');
    expect(filed.zipPath).toMatch(/^bug-reports\/2026-08-11-.*\.zip$/);
  });
});
