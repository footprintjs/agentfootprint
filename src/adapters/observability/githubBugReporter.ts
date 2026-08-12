/**
 * githubBugReporter — file a bug report, with the run attached, into GitHub.
 *
 *   import { exportBugReport, githubBugReporter } from 'agentfootprint/observe';
 *
 *   const reporter = githubBugReporter({
 *     issueRepo: 'acme/checkout-agent',      // where the ISSUE goes
 *     evidenceRepo: 'acme/agent-evidence',   // where the ZIP goes (default: issueRepo)
 *   });                                      // token: GITHUB_TOKEN, or `token`
 *
 *   const { issueUrl, zipUrl } = await reporter.file(report);
 *
 * Two HTTP calls and no SDK: `PUT /repos/{evidenceRepo}/contents/{path}` commits
 * the zip, `POST /repos/{issueRepo}/issues` files the issue with a manifest
 * table and a link to the committed bundle. Plain `fetch`, zero dependencies,
 * `apiBase` for GitHub Enterprise Server — so this works unchanged on a network
 * that never reaches github.com.
 *
 * ## TWIN TARGETS: the issue and the evidence may live in different repos
 *
 * The case this exists for: a field tester finds a bug in a LIBRARY. The issue
 * belongs in the library's public repo, where the maintainers and the next
 * person to hit it will find it. The evidence — a real run, with real prompts,
 * real tool arguments and real retrieved documents — does not. So the zip goes
 * into a PRIVATE repo the maintainers can read, and the issue links it and says
 * plainly that the evidence is private.
 *
 * ```ts
 * githubBugReporter({
 *   issueRepo: 'footprintjs/agentfootprint',   // public — the conversation
 *   evidenceRepo: 'acme/af-bug-evidence',      // private — the run
 * });
 * ```
 *
 * ## DEFAULT-TARGET DOCTRINE
 *
 * **File into the application's OWN repo.** That is the default (`evidenceRepo`
 * defaults to `issueRepo`) and it is the right default: the run belongs to the
 * organisation that produced it. Sending a run's evidence across an
 * organisational boundary — to a vendor, to an upstream library, to anyone
 * whose access your company did not grant — is a HUMAN act with consequences a
 * library cannot weigh. This adapter will do it, because a field tester filing
 * upstream is a real and valuable thing; it will not do it quietly. The
 * consent manifest (`describeBugReport`) exists so a person sees exactly what
 * would leave before it does, and this reporter refuses to commit evidence to a
 * PUBLIC repo unless the caller says `acknowledgePublicEvidence: true` out loud.
 *
 * ## Provisioning the token: fine-grained, and scoped to two repos
 *
 * Use a **fine-grained personal access token** (GitHub → Settings → Developer
 * settings → Fine-grained tokens), scoped to ONLY `issueRepo` and
 * `evidenceRepo`, with exactly two permissions — **Contents: read and write**
 * (to commit the zip) and **Issues: read and write** (to file the issue) — and
 * an expiry date. Put it in the server's environment as `GITHUB_TOKEN`, or pass
 * it as `token`.
 *
 * The contrast matters: a CLASSIC PAT's `repo` scope is coarse — it grants
 * read/write across every repository the account can reach, so a leaked
 * bug-report token is a leaked key to the whole account. With a fine-grained
 * token scoped as above, the blast radius of a leak is filing bug reports and
 * committing files to one evidence repo, and nothing else. GitHub App
 * installation tokens (short-lived, org-installed, revocable centrally) are the
 * next rung for an organisation that wants one; this adapter does not mint
 * them — hand it the token your app already obtained.
 *
 * ## Secrecy (the two-clause law)
 *
 * The token appears in no message, no error and no log this adapter can
 * produce, and neither does the bundle's content. A failed request is reported
 * as **the status and GitHub's own `message` field** — never the request, never
 * the headers, never the body that carried the token, never a byte of
 * evidence. Transport failures are re-wrapped rather than rethrown, because a
 * `fetch` implementation is free to put the request (headers included) into the
 * error it throws. Nothing here writes to a console. Pinned by a suite that
 * forces every failure path and greps the message, the stack and the JSON
 * projection for the token.
 *
 * @example  A server route (the app's own repo, the default target)
 * ```ts
 * const reporter = githubBugReporter({ issueRepo: 'acme/checkout-agent' });
 * app.post('/bug-report', async (req, res) => {
 *   const report = exportBugReport(recordings.get(req.body.runId), req.body.fields);
 *   res.json(await reporter.file(report));
 * });
 * ```
 */

import { formatBytes } from '../../lib/bug-report/build.js';
import type { BugReport } from '../../lib/bug-report/index.js';

/** GitHub's own ceiling for a file committed through the contents API is 100 MB,
 *  but an issue attachment that large is not a bug report anybody opens. 24 MB
 *  keeps a bundle inside every practical limit including the 25 MB the web UI
 *  accepts for a drag-and-dropped file. */
const DEFAULT_MAX_ZIP_BYTES = 24 * 1024 * 1024;

const DEFAULT_API_BASE = 'https://api.github.com';
const FINE_GRAINED_TOKEN_PAGE = 'Settings → Developer settings → Fine-grained tokens';

export interface GithubBugReporterOptions {
  /** `owner/name` of the repo the ISSUE is filed in. Required. */
  readonly issueRepo: string;
  /**
   * `owner/name` of the repo the evidence ZIP is committed to. Defaults to
   * {@link issueRepo}. Point it at a PRIVATE repo when the issue itself is
   * public — see the twin-target section above.
   */
  readonly evidenceRepo?: string;
  /**
   * The GitHub token. Falls back to the `GITHUB_TOKEN` environment variable.
   * It needs **Contents: read/write on `evidenceRepo`** and **Issues:
   * read/write on `issueRepo`**; filing an issue on a public repo needs only a
   * valid account token. This is a secret: it is sent as an `Authorization`
   * header and appears in no message this adapter can throw.
   */
  readonly token?: string;
  /** Directory inside `evidenceRepo` for the bundles. Default `'bug-reports'`. */
  readonly dir?: string;
  /** Labels applied to the issue. Default: none. */
  readonly labels?: readonly string[];
  /** Branch to commit the evidence to. Default: the repo's default branch. */
  readonly branch?: string;
  /** API root. Default `https://api.github.com`; for GitHub Enterprise Server
   *  it is `https://github.your-company.com/api/v3`. */
  readonly apiBase?: string;
  /**
   * Commit evidence to a PUBLIC repo deliberately.
   *
   * Off by default: a bundle carries a real run — prompts, tool arguments,
   * retrieved documents — and a public repo publishes it to the internet
   * permanently. Set this only when the evidence is synthetic, or when a human
   * has read the manifest and decided.
   */
  readonly acknowledgePublicEvidence?: boolean;
  /** Refuse a zip larger than this before uploading. Default 24 MB. */
  readonly maxZipBytes?: number;
  /** Test seam — inject `fetch`. Bypasses the network entirely. */
  readonly _fetch?: typeof fetch;
}

/** What a filed report leaves behind. */
export interface FiledBugReport {
  /** The issue, on `issueRepo`. */
  readonly issueUrl: string;
  /** The committed bundle's blob page, on `evidenceRepo`. */
  readonly zipUrl: string;
  /** Path inside `evidenceRepo`. */
  readonly zipPath: string;
  /** `owner/name` the evidence went to. */
  readonly evidenceRepo: string;
  /**
   * Whether the evidence repo's visibility was actually READ before committing.
   *
   * `false` means the metadata call failed — usually a token that can write
   * contents but not read repository metadata. The commit proceeds (a
   * permissions quirk must not block a bug report) and this field says the
   * guard did not run, so nobody mistakes an unchecked upload for a checked one.
   */
  readonly checkedVisibility: boolean;
  /** The answer, when the check ran. */
  readonly evidenceRepoPrivate?: boolean;
}

/** Files a finished {@link BugReport}. */
export interface BugReporter {
  file(report: BugReport): Promise<FiledBugReport>;
}

export function githubBugReporter(options: GithubBugReporterOptions): BugReporter {
  const issueRepo = checkedRepo(options.issueRepo, 'issueRepo');
  const evidenceRepo = options.evidenceRepo
    ? checkedRepo(options.evidenceRepo, 'evidenceRepo')
    : issueRepo;
  const token = options.token ?? readEnv('GITHUB_TOKEN');
  if (!token) {
    throw new TypeError(
      'githubBugReporter: no GitHub token. Pass `token`, or set the GITHUB_TOKEN environment ' +
        'variable on the server (a token belongs in the environment, not in the option in a ' +
        `committed config file). Make it a FINE-GRAINED token — ${FINE_GRAINED_TOKEN_PAGE} — ` +
        `scoped to just ${
          evidenceRepo === issueRepo ? issueRepo : `${issueRepo} and ${evidenceRepo}`
        }, ` +
        'with Contents: read/write and Issues: read/write, and an expiry date. A classic PAT ' +
        "grants those permissions across every repo the account can reach; this token's " +
        'blast radius should be filing bug reports and nothing else.',
    );
  }

  const apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const dir = (options.dir ?? 'bug-reports').replace(/^\/+|\/+$/g, '');
  const maxZipBytes = options.maxZipBytes ?? DEFAULT_MAX_ZIP_BYTES;
  const doFetch = options._fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  return {
    async file(report: BugReport): Promise<FiledBugReport> {
      if (!report || !(report.zip instanceof Uint8Array) || !report.manifest) {
        throw new TypeError(
          'githubBugReporter.file: expected the object exportBugReport() returns ' +
            '({ manifest, files, zip, filename }).',
        );
      }

      // 1. SIZE, before a byte moves. Refusing after a 24 MB upload wastes the
      //    reporter's time and GitHub's, and the manifest already computed the
      //    way out.
      if (report.zip.length > maxZipBytes) {
        throw new Error(
          `githubBugReporter: refusing to upload a ${formatBytes(report.zip.length)} bundle — ` +
            `the ceiling is ${formatBytes(
              maxZipBytes,
            )}. GitHub accepts far larger files through the ` +
            `contents API, but a bundle this size is not one a maintainer opens. Send fewer ` +
            `units: ${trimAdvice(report)}`,
        );
      }

      // 2. VISIBILITY. The doctrine's teeth: evidence is a real run, and a
      //    public repo publishes it permanently.
      const visibility = await readVisibility({ apiBase, evidenceRepo, token, doFetch });
      if (
        visibility.checked &&
        visibility.isPrivate === false &&
        !options.acknowledgePublicEvidence
      ) {
        throw new Error(
          `githubBugReporter: refusing to commit evidence to '${evidenceRepo}', which is a ` +
            `PUBLIC repository. A bug-report bundle carries a real run — prompts, tool ` +
            `arguments, retrieved documents — and committing it here publishes all of it ` +
            `permanently. Point \`evidenceRepo\` at a private repo the maintainers can read ` +
            `(the issue can still go to the public one), or pass ` +
            `\`acknowledgePublicEvidence: true\` if this is intended.`,
        );
      }

      // 3. COMMIT the zip.
      const uploaded = await uploadZip({
        apiBase,
        evidenceRepo,
        dir,
        token,
        doFetch,
        report,
        ...(options.branch !== undefined && { branch: options.branch }),
      });

      // 4. FILE the issue, pointing at it.
      const issueUrl = await createIssue({
        apiBase,
        issueRepo,
        token,
        doFetch,
        report,
        zipUrl: uploaded.zipUrl,
        zipPath: uploaded.zipPath,
        evidenceRepo,
        crossRepo: evidenceRepo !== issueRepo,
        evidencePrivate: visibility.checked ? visibility.isPrivate : undefined,
        ...(options.labels !== undefined && { labels: options.labels }),
      });

      return {
        issueUrl,
        zipUrl: uploaded.zipUrl,
        zipPath: uploaded.zipPath,
        evidenceRepo,
        checkedVisibility: visibility.checked,
        ...(visibility.checked && { evidenceRepoPrivate: visibility.isPrivate }),
      };
    },
  };
}

// ─── The three calls ─────────────────────────────────────────────────

interface CallBase {
  readonly apiBase: string;
  readonly token: string;
  readonly doFetch: typeof fetch;
}

/**
 * Read the evidence repo's visibility.
 *
 * Never blocks on a permissions quirk: a token with `contents: write` but no
 * metadata read is a legitimate configuration, and a bug report that cannot be
 * filed because a GUARD could not run has failed at its one job. The result
 * carries `checked: false` so the caller learns the guard was skipped.
 */
async function readVisibility(
  args: CallBase & { readonly evidenceRepo: string },
): Promise<{ checked: boolean; isPrivate: boolean }> {
  try {
    const res = await args.doFetch(`${args.apiBase}/repos/${args.evidenceRepo}`, {
      method: 'GET',
      headers: githubHeaders(args.token),
    });
    if (!res.ok) return { checked: false, isPrivate: false };
    const body = (await res.json()) as { private?: unknown };
    if (typeof body?.private !== 'boolean') return { checked: false, isPrivate: false };
    return { checked: true, isPrivate: body.private };
  } catch {
    // A transport failure here is not the report's problem, and the error is
    // deliberately not propagated — it is the one place where a thrown fetch
    // could carry request headers into a message.
    return { checked: false, isPrivate: false };
  }
}

/** Commit the zip, suffixing the name if that path is already taken. */
async function uploadZip(
  args: CallBase & {
    readonly evidenceRepo: string;
    readonly dir: string;
    readonly report: BugReport;
    readonly branch?: string;
  },
): Promise<{ zipUrl: string; zipPath: string }> {
  const base = args.report.filename.replace(/\.zip$/, '');
  const content = toBase64(args.report.zip);
  const title = args.report.manifest.report?.title ?? 'bug report';

  // A name collision is ordinary (two reports of the same bug on the same day),
  // and GitHub answers a create-without-sha on an existing path with 409/422.
  // Suffix and retry rather than overwrite: the earlier bundle is somebody
  // else's evidence.
  for (let attempt = 1; attempt <= 5; attempt++) {
    const path = `${args.dir}/${base}-${shortId()}.zip`;
    const res = await request({
      ...args,
      url: `${args.apiBase}/repos/${args.evidenceRepo}/contents/${encodePath(path)}`,
      method: 'PUT',
      body: {
        message: `bug report: ${title}`,
        content,
        ...(args.branch !== undefined && { branch: args.branch }),
      },
      what: `commit the evidence bundle to '${args.evidenceRepo}'`,
      allowStatuses: [409, 422],
    });
    if (res.ok) {
      const body = res.body as { content?: { html_url?: unknown; path?: unknown } };
      const htmlUrl =
        typeof body?.content?.html_url === 'string'
          ? body.content.html_url
          : `https://github.com/${args.evidenceRepo}/blob/HEAD/${path}`;
      return { zipUrl: htmlUrl, zipPath: path };
    }
    if (attempt === 5) {
      throw new Error(
        `githubBugReporter: could not commit the evidence bundle to '${args.evidenceRepo}' — ` +
          `five names in '${args.dir}/' were already taken (GitHub answered ${res.status}: ` +
          `${res.message}). Check that the token has Contents: read/write there, or set ` +
          `\`dir\` to somewhere less crowded.`,
      );
    }
  }
  /* istanbul ignore next — the loop always returns or throws. */
  throw new Error('githubBugReporter: unreachable');
}

async function createIssue(
  args: CallBase & {
    readonly issueRepo: string;
    readonly report: BugReport;
    readonly zipUrl: string;
    readonly zipPath: string;
    readonly evidenceRepo: string;
    readonly crossRepo: boolean;
    readonly evidencePrivate?: boolean;
    readonly labels?: readonly string[];
  },
): Promise<string> {
  const res = await request({
    ...args,
    url: `${args.apiBase}/repos/${args.issueRepo}/issues`,
    method: 'POST',
    body: {
      title: args.report.manifest.report?.title ?? 'Bug report',
      body: issueBody(args),
      ...(args.labels && args.labels.length > 0 && { labels: [...args.labels] }),
    },
    what: `file the issue on '${args.issueRepo}'`,
    allowStatuses: [],
  });
  const body = res.body as { html_url?: unknown };
  return typeof body?.html_url === 'string'
    ? body.html_url
    : `https://github.com/${args.issueRepo}/issues`;
}

// ─── HTTP, with the secrecy law applied ──────────────────────────────

interface RequestArgs extends CallBase {
  readonly url: string;
  readonly method: 'GET' | 'POST' | 'PUT';
  readonly body: Readonly<Record<string, unknown>>;
  /** "commit the evidence bundle to 'x/y'" — the ONE piece of context an error names. */
  readonly what: string;
  /** Statuses the caller handles itself instead of throwing. */
  readonly allowStatuses: readonly number[];
}

interface RequestResult {
  readonly ok: boolean;
  readonly status: number;
  /** GitHub's own `message` field — the only text from a response any error may carry. */
  readonly message: string;
  readonly body: unknown;
}

/**
 * One request.
 *
 * Everything about the secrecy law lives here: the token goes into a header and
 * nowhere else; a thrown fetch is re-wrapped so no implementation can smuggle
 * its request (headers included) into the text; a non-2xx names the status and
 * GitHub's `message` field ONLY — never the request body, which for the upload
 * is the base64 of the evidence and for every call travelled beside the token.
 */
async function request(args: RequestArgs): Promise<RequestResult> {
  let res: Awaited<ReturnType<typeof fetch>>;
  try {
    res = await args.doFetch(args.url, {
      method: args.method,
      headers: { ...githubHeaders(args.token), 'content-type': 'application/json' },
      body: JSON.stringify(args.body),
    });
  } catch (err) {
    throw new Error(
      `githubBugReporter: could not reach GitHub to ${args.what} (${transportReason(err)}). ` +
        `Check the network and \`apiBase\`.`,
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const message = githubMessage(body);

  if (res.ok) return { ok: true, status: res.status, message, body };
  if (args.allowStatuses.includes(res.status)) {
    return { ok: false, status: res.status, message, body };
  }

  throw new Error(
    `githubBugReporter: GitHub answered ${res.status} when asked to ${args.what}` +
      `${message ? ` — "${message}"` : ''}.${statusHint(res.status)}`,
  );
}

/** GitHub's error envelope is `{ message, documentation_url, errors }`. Only
 *  `message` is ever surfaced: `errors[]` can quote the request. */
function githubMessage(body: unknown): string {
  const message = (body as { message?: unknown } | undefined)?.message;
  return typeof message === 'string' ? message.slice(0, 200) : '';
}

function statusHint(status: number): string {
  if (status === 401) {
    return (
      ` The token is missing, expired or revoked — mint a new fine-grained one ` +
      `(${FINE_GRAINED_TOKEN_PAGE}).`
    );
  }
  if (status === 403) {
    return (
      ` The token is valid but not permitted here. A fine-grained token needs Contents: ` +
      `read/write on the evidence repo and Issues: read/write on the issue repo, and it must ` +
      `list BOTH repositories in its repository access.`
    );
  }
  if (status === 404) {
    return (
      ` Either the repository does not exist under that name, or the token cannot see it — ` +
      `GitHub answers 404 rather than 403 for a private repo a token has no access to.`
    );
  }
  if (status === 410) return ' Issues are disabled on that repository.';
  return '';
}

function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
}

/** A short, payload-free reason. Never the error's own message: a fetch may put
 *  the request — headers included — in it. */
function transportReason(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'the request timed out';
    return err.name || 'network error';
  }
  return 'network error';
}

// ─── Small pure helpers ──────────────────────────────────────────────

function checkedRepo(repo: string, option: 'issueRepo' | 'evidenceRepo'): string {
  if (typeof repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new TypeError(
      `githubBugReporter: \`${option}\` must be 'owner/name' (e.g. 'acme/checkout-agent'), ` +
        `not '${String(repo)}'. \`issueRepo\` is where the ISSUE is filed; \`evidenceRepo\` ` +
        `is where the evidence ZIP is committed, and defaults to \`issueRepo\`.`,
    );
  }
  return repo;
}

function readEnv(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const value = env?.[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** Base64 for the contents API. Node-only, and it says so by name. */
function toBase64(bytes: Uint8Array): string {
  const buffer = (
    globalThis as { Buffer?: { from(input: Uint8Array): { toString(e: string): string } } }
  ).Buffer;
  if (!buffer) {
    throw new Error(
      'githubBugReporter is a server-side reporter and needs Node (it base64-encodes the ' +
        'bundle with Buffer). In a browser, build the bundle with exportBugReport() and POST ' +
        'it to your own server, which files it — a browser holding a GitHub token is a token ' +
        'anyone with the page can read.',
    );
  }
  return buffer.from(bytes).toString('base64');
}

/** Six characters of collision resistance in a filename. */
function shortId(): string {
  const random = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } })
    .crypto;
  if (random?.getRandomValues) {
    const bytes = random.getRandomValues(new Uint8Array(4));
    return [...bytes]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 6);
  }
  return Math.random().toString(36).slice(2, 8);
}

const encodePath = (path: string): string => path.split('/').map(encodeURIComponent).join('/');

/** The manifest already worked out what to drop; repeat it rather than invent. */
function trimAdvice(report: BugReport): string {
  const hints = report.manifest.oversize?.trimHints;
  if (hints && hints.length > 0) return hints.join(' ');
  const biggest = [...report.manifest.units]
    .filter((unit) => unit.kind === 'conversation')
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 3);
  return biggest.length > 0
    ? `pass \`include\` to exportBugReport() without ${biggest
        .map((unit) => `${unit.id} (${formatBytes(unit.bytes)})`)
        .join(' / ')}.`
    : 'pass `include` to exportBugReport() with fewer units.';
}

// ─── The issue body ──────────────────────────────────────────────────

function issueBody(args: {
  readonly report: BugReport;
  readonly zipUrl: string;
  readonly zipPath: string;
  readonly evidenceRepo: string;
  readonly crossRepo: boolean;
  readonly evidencePrivate?: boolean;
}): string {
  const { manifest } = args.report;
  const fields = manifest.report;
  const lines: string[] = [];

  if (fields) {
    lines.push('### Steps to reproduce', '', fields.stepsToReproduce, '');
    lines.push('### Expected', '', fields.expected, '');
    lines.push('### Actual', '', fields.actual, '');
  }

  lines.push('### The run is attached', '');
  lines.push(`[\`${args.zipPath}\`](${args.zipUrl}) — the recorded run itself.`);
  if (args.crossRepo) {
    lines.push(
      '',
      args.evidencePrivate === false
        ? `The evidence is committed to \`${args.evidenceRepo}\`, a separate PUBLIC repository.`
        : `The evidence is committed to \`${args.evidenceRepo}\`, a private repository visible ` +
            `to maintainers — this issue links it but does not contain it.`,
    );
  }
  lines.push(
    '',
    'Open it with `observeRecording()` (agentfootprint-lens) or the trace tools — ' +
      '`recording.json` is the canon `{ snapshot, events, structure }`.',
    '',
  );

  lines.push('### What is in the bundle', '');
  lines.push('| file | bytes | events | turns |', '|---|---:|---:|---:|');
  for (const file of manifest.files) {
    lines.push(
      `| \`${file.name}\` | ${file.bytes} | ${file.eventCount ?? ''} | ${file.turnCount ?? ''} |`,
    );
  }
  lines.push(
    '',
    `${manifest.counts.conversations} conversation(s), ${manifest.counts.runs} run(s), ` +
      `${manifest.counts.events} event(s), ${manifest.counts.turns} turn(s), ` +
      `${manifest.totalBytes} bytes uncompressed.`,
    '',
  );

  if (manifest.excluded.conversations > 0 || manifest.excluded.files > 0) {
    lines.push(
      `**The reporter chose a subset.** Left out: ${manifest.excluded.conversations} ` +
        `conversation(s) (${manifest.excluded.events} events, ${manifest.excluded.turns} ` +
        `turns) and ${manifest.excluded.files} file(s).`,
      '',
    );
  }

  lines.push(
    '### Redacted keys',
    '',
    manifest.redactedKeys.length > 0
      ? `Scrubbed at commit time by the run's redaction policy, listed by name only: ` +
          `${manifest.redactedKeys.map((key) => `\`${key}\``).join(', ')}.`
      : 'None — this run had no redaction policy, so every value in the bundle is real.',
    '',
  );

  const env = manifest.environment;
  lines.push('### Environment', '');
  lines.push('```');
  lines.push(`agentfootprint  ${env.agentfootprint}`);
  lines.push(`footprintjs     ${env.footprintjs}`);
  lines.push(`node            ${env.node}`);
  lines.push(`platform        ${env.platform}/${env.arch}`);
  if (env.appVersion) lines.push(`app             ${env.appVersion}`);
  lines.push('```');

  if (manifest.warnings.length > 0) {
    lines.push('', '### Warnings', '');
    for (const warning of manifest.warnings) lines.push(`- ${warning}`);
  }
  if (manifest.notes.length > 0) {
    lines.push('', '<details><summary>Notes about this bundle</summary>', '');
    for (const note of manifest.notes) lines.push(`- ${note}`);
    lines.push('', '</details>');
  }

  return lines.join('\n');
}
