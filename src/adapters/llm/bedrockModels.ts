/** Explicit Converse caching facts, verified 2026-10-19 against AWS's model table.
 * Unknown models and undeclared application inference profiles remain unsupported.
 * https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
 * Only this table owns model support; never infer it from a family prefix.
 * Profiles were checked against model-card Programmatic access lists. Rows
 * with no verified profiles accept only the listed base ID. Capability does
 * not promise endpoint/region/account availability (some base IDs require a
 * profile at runtime). Nova's published minimum is literally '1K'.
 */
import { bedrockModelArn } from './bedrockModelArn.js';

export interface BedrockCacheFacts {
  readonly minimumTokens: number | '1K';
  readonly maxBreakpoints: number;
  readonly tools: boolean;
  readonly longTtl: boolean;
  readonly profiles: readonly string[];
}

const claude = (
  minimumTokens: number,
  longTtl = true,
  profiles: readonly string[] = [],
): BedrockCacheFacts =>
  Object.freeze({
    minimumTokens,
    maxBreakpoints: 4,
    tools: true,
    longTtl,
    profiles: Object.freeze([...profiles]),
  });
const nova = (profiles: readonly string[]): BedrockCacheFacts =>
  Object.freeze({
    minimumTokens: '1K',
    maxBreakpoints: 4,
    tools: false,
    longTtl: false,
    profiles: Object.freeze([...profiles]),
  });

export const BEDROCK_CACHE_MODELS: Readonly<Record<string, BedrockCacheFacts>> = Object.freeze({
  'anthropic.claude-haiku-5-5': claude(512, true, ['us', 'eu', 'au', 'jp', 'global']),
  'anthropic.claude-sonnet-5-5': claude(512),
  'anthropic.claude-opus-5-5': claude(512),
  'anthropic.claude-fable-5-1': claude(512),
  'anthropic.claude-mythos-5-1': claude(512),
  'anthropic.claude-fable-5': claude(512),
  'anthropic.claude-mythos-5': claude(512),
  'anthropic.claude-opus-5': claude(512),
  'anthropic.claude-opus-4-8': claude(1024),
  'anthropic.claude-opus-4-7': claude(4096),
  'anthropic.claude-opus-4-6-v1': claude(4096),
  'anthropic.claude-opus-4-5-20251101-v1:0': claude(4096),
  'anthropic.claude-sonnet-5': claude(1024),
  'anthropic.claude-sonnet-4-6': claude(1024, true, ['us', 'eu', 'au', 'jp', 'global']),
  'anthropic.claude-sonnet-4-5-20250929-v1:0': claude(1024, true, [
    'us',
    'eu',
    'au',
    'jp',
    'global',
  ]),
  'anthropic.claude-3-7-sonnet-20250219-v1:0': claude(1024, false),
  'anthropic.claude-3-5-sonnet-20241022-v2:0': claude(1024, false),
  'anthropic.claude-haiku-4-5-20251001-v1:0': claude(4096, true, [
    'us',
    'eu',
    'au',
    'jp',
    'in',
    'global',
  ]),
  'anthropic.claude-sonnet-4-20250514-v1:0': claude(1024, false, ['us', 'eu', 'apac', 'global']),
  'anthropic.claude-opus-4-1-20250805-v1:0': claude(1024, false, ['us']),
  'amazon.nova-2-lite-v1:0': nova(['us', 'eu', 'jp', 'global']),
  'amazon.nova-pro-v1:0': nova(['us', 'eu', 'apac']),
  'amazon.nova-lite-v1:0': nova(['us', 'ca', 'eu', 'apac']),
  'amazon.nova-micro-v1:0': nova(['us', 'eu']),
});

function foundationFacts(model: string): BedrockCacheFacts | undefined {
  return Object.prototype.hasOwnProperty.call(BEDROCK_CACHE_MODELS, model)
    ? BEDROCK_CACHE_MODELS[model]
    : undefined;
}

function profileFacts(model: string): BedrockCacheFacts | undefined {
  const separator = model.indexOf('.');
  if (separator < 0) return undefined;
  const facts = foundationFacts(model.slice(separator + 1));
  return facts?.profiles.includes(model.slice(0, separator)) ? facts : undefined;
}

/** Match an exact foundation ID or a verified system profile ID or ARN. */
export function bedrockCacheFacts(model: string): BedrockCacheFacts | undefined {
  const builtin = foundationFacts(model) ?? profileFacts(model);
  if (builtin !== undefined || !model.startsWith('arn:')) return builtin;
  const resource = bedrockModelArn(model);
  return resource?.kind === 'inference-profile' ? profileFacts(resource.id) : undefined;
}

const PROFILE_ID = /^[a-zA-Z0-9:.-]{1,64}$/;

/** Copy trusted, exact application-profile routes without resolving chains or
 * changing the submitted model identity. Built-in facts remain authoritative.
 */
export function bedrockCacheFactResolver(
  declarations?: Readonly<Record<string, string>>,
): (model: string) => BedrockCacheFacts | undefined {
  if (declarations === undefined) return bedrockCacheFacts;
  const profiles = new Map<string, BedrockCacheFacts>();
  for (const [route, descriptor] of Object.entries(
    Object.getOwnPropertyDescriptors(declarations),
  )) {
    const validRoute = route.startsWith('arn:')
      ? bedrockModelArn(route)?.kind === 'application-inference-profile'
      : PROFILE_ID.test(route) && route === route.trim();
    if (!validRoute || typeof descriptor.value !== 'string') continue;
    const facts = bedrockCacheFacts(descriptor.value);
    if (facts !== undefined) profiles.set(route, facts);
  }
  return (model) => bedrockCacheFacts(model) ?? profiles.get(model);
}
