/**
 * The linear trims (`src/lib/linearText.ts`) and every door that took one
 * instead of a quadratic `X+$` regex.
 *
 * WHAT A GREEN RUN PROVES
 *   1. Each trim returns EXACTLY what the regex it replaced returns — on every
 *      UTF-16 code unit for `isRegExpWhitespace`, and on seeded strings built
 *      from the characters each trim drops plus filler for the rest.
 *   2. Each door that trims text it did not write — a base URL, a prefix, a
 *      model's token or reply, a person's words — does it in work linear in
 *      the input, on that door's worst case. Work is COUNTED
 *      (`test/helpers/workCount.ts`), never timed: the old regexes took ~90 ms
 *      on 16,000 slashes and minutes on a million, and a counted bound cannot
 *      be passed by a fast machine.
 *
 * Each door gets two inputs. The run the old regex choked on (a run of the
 * trimmed character, then one more character) must stay under the linear
 * bound. A run AT the end — what the scanner itself has to read — must also
 * show at least that run's length of counted reads: a door that went back to
 * a regex reads nothing the counter sees and fails there.
 *
 * Not counted, and linear: the anchored scheme checks (`/^https?:\/\//i`),
 * `/\/v1$/i`, `new URL`, `trim`, `endsWith` and the slices that build results.
 *
 * Test types (Convention 3): security, property (seeded equivalence),
 * performance/regression (counted work).
 */
import { describe, expect, it } from 'vitest';
import {
  anyOf,
  either,
  isHyphen,
  isRegExpWhitespace,
  isSlash,
  trimBoth,
  trimLeading,
  trimTrailing,
} from '../../src/lib/linearText.js';
import { azureBaseUrl } from '../../src/adapters/llm/azureUrl.js';
import { ollama } from '../../src/adapters/llm/OllamaProvider.js';
import { foundryLocal } from '../../src/adapters/llm/FoundryLocalProvider.js';
import { foundryInferenceUrl } from '../../src/adapters/llm/FoundryProvider.js';
import { invokeModelGateway } from '../../src/adapters/llm/InvokeModelGatewayProvider.js';
import { vaultCredentials } from '../../src/adapters/identity/vault.js';
import { discoveryUrlFor } from '../../src/adapters/identity/verify/discovery.js';
import { githubBugReporter } from '../../src/adapters/observability/githubBugReporter.js';
import { githubDeviceSignIn } from '../../src/adapters/observability/githubDeviceSignIn.js';
import { normalizeKeyRoot } from '../../src/artifacts/scopePath.js';
import { typesafe } from '../../src/classify/typesafe.js';
import { normalizeToken } from '../../src/core/agent/evidence/normalize.js';
import { slugify } from '../../src/lib/bug-report/build.js';
import { parseEnumLine } from '../../src/lib/injection-engine/constrainedEnumPick.js';
import { cleanValue } from '../../src/memory/facts/patternFactExtractor.js';
import { countTextWork } from '../helpers/workCount.js';
import { seededTexts } from '../helpers/seededText.js';

/** Long enough that a quadratic door would count billions; short enough to stay quick. */
const N = 100_000;

/** The linear budget: a few reads per character, plus constant setup. */
const linearBudget = (n: number): number => 4 * n + 2_000;

// ─── 1. Equivalence ─────────────────────────────────────────────────

describe('linearText — returns exactly what the regex returned', () => {
  it('isRegExpWhitespace is `\\s`, on every UTF-16 code unit', () => {
    const disagreements: number[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      if (isRegExpWhitespace(code) !== /\s/.test(String.fromCharCode(code)))
        disagreements.push(code);
    }
    expect(disagreements).toEqual([]);
  });

  const slashTexts = seededTexts(0x5eed, ['/', '/', 'a', '-', ' ', '//'], 3_000, 10);

  it('trimTrailing(isSlash) is `/\\/+$/`', () => {
    for (const s of slashTexts) expect(trimTrailing(s, isSlash), s).toBe(s.replace(/\/+$/, ''));
  });

  it('trimLeading(isSlash) is `/^\\/+/`', () => {
    for (const s of slashTexts) expect(trimLeading(s, isSlash), s).toBe(s.replace(/^\/+/, ''));
  });

  it('trimBoth(isSlash) is `/^\\/+|\\/+$/g`, and the two-step form scopePath used', () => {
    for (const s of slashTexts) {
      expect(trimBoth(s, isSlash), s).toBe(s.replace(/^\/+|\/+$/g, ''));
      expect(trimBoth(s, isSlash), s).toBe(s.replace(/^\/+/, '').replace(/\/+$/, ''));
    }
  });

  it('the decoration, enum-reply and fact-value sets match their character classes', () => {
    const texts = seededTexts(
      0xdec0,
      [
        '.',
        ',',
        ';',
        ':',
        '!',
        '?',
        '%',
        "'",
        '"',
        '`',
        ')',
        ']',
        '}',
        '>',
        'a',
        '1',
        ' ',
        '\t',
        '\u00a0',
        '\u2028',
        '\ufeff',
        '-',
      ],
      4_000,
      10,
    );
    const decoration = anyOf('.,;:!?%\'"`)]}>');
    const noise = either(isRegExpWhitespace, anyOf('.!?,;:'));
    for (const s of texts) {
      expect(trimTrailing(s, decoration), s).toBe(s.replace(/[.,;:!?%'"`)\]}>]+$/, ''));
      expect(trimTrailing(s, noise), s).toBe(s.replace(/[\s.!?,;:]+$/, ''));
      expect(cleanValue(s), s).toBe(s.replace(/[\s.!?,;:]+$/, '').trim());
      const oldLine = s.trim().replace(/^["'`]+|["'`.,]+$/g, '');
      // parseEnumLine answers `oldLine` only when it computed the same line.
      expect(parseEnumLine(s, [oldLine]), s).toBe(oldLine);
    }
  });

  it('slugify is the regex chain it replaced', () => {
    const oldSlugify = (title: string): string =>
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60)
        .replace(/-+$/g, '') || 'bug-report';
    const titles = seededTexts(
      0x5106,
      ['-', ' ', 'a', 'B', '9', '!', '--', 'ü', 'word '],
      3_000,
      40,
    );
    for (const t of titles) expect(slugify(t), t).toBe(oldSlugify(t));
    expect(trimBoth('--a-b--', isHyphen)).toBe('a-b');
  });
});

// ─── 2. Counted work at every door ──────────────────────────────────

/** A door: the call that trims `text`, as the library makes it. */
interface Door {
  readonly name: string;
  /** Text ending in a run of what the door trims, `n` long — the scanner's own worst case. */
  readonly runAtEnd: (n: number) => string;
  /** The same run with one more character after it — the old regex's worst case. */
  readonly runThenChar: (n: number) => string;
  readonly call: (text: string) => unknown;
}

const neverAnswers = (() => new Promise<Response>(() => {})) as typeof fetch;

const DOORS: readonly Door[] = [
  {
    name: 'azureBaseUrl',
    runAtEnd: (n) => `https://co.openai.azure.com${'/'.repeat(n)}`,
    runThenChar: (n) => `https://co.openai.azure.com${'/'.repeat(n)}x`,
    call: (url) => azureBaseUrl(url),
  },
  {
    name: 'ollama({ baseURL })',
    runAtEnd: (n) => `http://localhost:11434${'/'.repeat(n)}`,
    runThenChar: (n) => `http://localhost:11434${'/'.repeat(n)}x`,
    call: (baseURL) => ollama({ model: 'm', baseURL }),
  },
  {
    name: 'foundryLocal({ endpoint })',
    runAtEnd: (n) => `http://127.0.0.1:5273${'/'.repeat(n)}`,
    runThenChar: (n) => `http://127.0.0.1:5273${'/'.repeat(n)}x`,
    call: (endpoint) => foundryLocal('m', { endpoint }),
  },
  {
    name: 'foundryInferenceUrl',
    runAtEnd: (n) => `https://r.services.ai.azure.com/api/projects/p${'/'.repeat(n)}`,
    runThenChar: (n) => `https://r.services.ai.azure.com/api/projects/p${'/'.repeat(n)}x`,
    call: (url) => foundryInferenceUrl(url),
  },
  {
    name: 'invokeModelGateway({ baseUrl })',
    runAtEnd: (n) => `https://gateway.example.test${'/'.repeat(n)}`,
    runThenChar: (n) => `https://gateway.example.test${'/'.repeat(n)}x`,
    call: (baseUrl) =>
      invokeModelGateway({
        baseUrl,
        apiKeyHeader: 'api-key',
        apiKey: 'k',
        model: 'm',
        fetch: neverAnswers,
      }),
  },
  {
    name: 'vaultCredentials({ address })',
    runAtEnd: (n) => `https://vault.internal:8200${'/'.repeat(n)}`,
    runThenChar: (n) => `https://vault.internal:8200${'/'.repeat(n)}x`,
    call: (address) => vaultCredentials({ address, token: 'hvs.test', _fetch: neverAnswers }),
  },
  {
    name: 'vaultCredentials({ mount })',
    runAtEnd: (n) => `kv${'/'.repeat(n)}`,
    runThenChar: (n) => `kv${'/'.repeat(n)}x`,
    call: (mount) =>
      vaultCredentials({
        address: 'https://vault.internal:8200',
        token: 'hvs.test',
        mount,
        _fetch: neverAnswers,
      }),
  },
  {
    name: 'discoveryUrlFor',
    runAtEnd: (n) => `https://login.example.test/tenant${'/'.repeat(n)}`,
    runThenChar: (n) => `https://login.example.test/tenant${'/'.repeat(n)}x`,
    call: (issuer) => discoveryUrlFor(issuer),
  },
  {
    name: 'githubBugReporter({ apiBase })',
    runAtEnd: (n) => `https://api.github.com${'/'.repeat(n)}`,
    runThenChar: (n) => `https://api.github.com${'/'.repeat(n)}x`,
    call: (apiBase) =>
      githubBugReporter({ issueRepo: 'acme/a', token: 'github_pat_test', apiBase }),
  },
  {
    name: 'githubBugReporter({ dir })',
    runAtEnd: (n) => `bug-reports${'/'.repeat(n)}`,
    runThenChar: (n) => `bug-reports${'/'.repeat(n)}x`,
    call: (dir) => githubBugReporter({ issueRepo: 'acme/a', token: 'github_pat_test', dir }),
  },
  {
    // Async: the trims run before its first request, inside the counted call.
    // The request never answers, so the flow parks there.
    name: 'githubDeviceSignIn({ authBase })',
    runAtEnd: (n) => `https://github.com${'/'.repeat(n)}`,
    runThenChar: (n) => `https://github.com${'/'.repeat(n)}x`,
    call: (authBase) =>
      githubDeviceSignIn({
        clientId: 'Iv1.0123456789abcdef',
        authBase,
        _fetch: neverAnswers,
      }).catch(() => undefined),
  },
  {
    name: 'githubDeviceSignIn({ apiBase })',
    runAtEnd: (n) => `https://api.github.com${'/'.repeat(n)}`,
    runThenChar: (n) => `https://api.github.com${'/'.repeat(n)}x`,
    call: (apiBase) =>
      githubDeviceSignIn({ clientId: 'Iv1.0123456789abcdef', apiBase, _fetch: neverAnswers }).catch(
        () => undefined,
      ),
  },
  {
    name: 'normalizeKeyRoot (artifact prefix)',
    runAtEnd: (n) => `tenant${'/'.repeat(n)}`,
    runThenChar: (n) => `tenant${'/'.repeat(n)}x`,
    call: (root) => normalizeKeyRoot('s3Artifacts', root),
  },
  {
    name: 'typesafe({ baseUrl })',
    runAtEnd: (n) => `https://api.typesafe.example${'/'.repeat(n)}`,
    runThenChar: (n) => `https://api.typesafe.example${'/'.repeat(n)}x`,
    call: (baseUrl) => typesafe({ apiKey: 'k', baseUrl }),
  },
  {
    name: 'normalizeToken (a model token)',
    runAtEnd: (n) => `41200${'!'.repeat(n)}`,
    runThenChar: (n) => `a${'!'.repeat(n)}x`,
    call: (token) => normalizeToken(token),
  },
  {
    name: 'parseEnumLine (a model reply)',
    runAtEnd: (n) => `"billing${'"'.repeat(n)}`,
    runThenChar: (n) => `a${'"'.repeat(n)}x`,
    call: (reply) => parseEnumLine(reply, ['billing']),
  },
  {
    name: 'cleanValue (a person’s words)',
    runAtEnd: (n) => `San Francisco${' \t'.repeat(n / 2)}`,
    runThenChar: (n) => `A${'\t'.repeat(n)}B`,
    call: (value) => cleanValue(value),
  },
];

describe('linearText — every door trims in linear, counted work', () => {
  it('calibration: the counter is blind to a regex, so only a lower bound proves a scan', () => {
    const text = `https://x${'/'.repeat(1_000)}`;
    expect(countTextWork(() => text.replace(/\/+$/, '')).work).toBe(0);
    expect(countTextWork(() => trimTrailing(text, isSlash)).work).toBe(1_001);
  });

  it.each(DOORS)('$name: the old regex’s worst case stays within the linear budget', (door) => {
    const text = door.runThenChar(N);
    const { work } = countTextWork(() => door.call(text));
    expect(work).toBeLessThanOrEqual(linearBudget(text.length));
  });

  it.each(DOORS)('$name: a run at the end is read once — and the counter sees it', (door) => {
    const text = door.runAtEnd(N);
    const { work } = countTextWork(() => door.call(text));
    expect(work).toBeGreaterThanOrEqual(N);
    expect(work).toBeLessThanOrEqual(linearBudget(text.length));
  });

  it('slugify: the old worst case is cheap — and there is no long run left to trim', () => {
    // `[^a-z0-9]+` → `-` collapses every run before the trim, so the trim never
    // meets more than one hyphen at either end; the old `^-+|-+$` was quadratic
    // only on input this pipeline never hands it. Kept on the shared trim so the
    // door reads like the others.
    const title = `a${' -'.repeat(N / 2)}b${' -'.repeat(N / 2)}`;
    const { result, work } = countTextWork(() => slugify(title));
    expect(result).toBe('a-b');
    expect(work).toBeLessThanOrEqual(linearBudget(title.length));
  });

  it('the trimmed values are what the doors serve', () => {
    expect(azureBaseUrl(`https://co.openai.azure.com${'/'.repeat(N)}`)).toBe(
      'https://co.openai.azure.com/openai',
    );
    expect(discoveryUrlFor(`https://login.example.test/t${'/'.repeat(N)}`)).toBe(
      'https://login.example.test/t/.well-known/openid-configuration',
    );
    expect(normalizeKeyRoot('s3Artifacts', `${'/'.repeat(N)}tenant${'/'.repeat(N)}`)).toBe(
      'tenant',
    );
    expect(normalizeToken(`41,200${'!'.repeat(N)}`)).toBe('41200');
    expect(parseEnumLine(`"billing${'"'.repeat(N)}`, ['billing'])).toBe('billing');
    expect(cleanValue(`San Francisco${' \t'.repeat(N / 2)}`)).toBe('San Francisco');
    expect(slugify(`Stale price${' -'.repeat(N / 2)}`)).toBe('stale-price');
  });
});
