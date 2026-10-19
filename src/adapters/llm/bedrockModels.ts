/** Explicit Converse caching facts, verified against AWS's model table.
 * Unknown model IDs, custom aliases and ARNs are intentionally unsupported.
 * https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
 * Only this table owns model support; never infer it from a family prefix.
 * Profiles were checked against model-card Programmatic access lists. Rows
 * with no verified profiles accept only the listed base ID. Capability does
 * not promise endpoint/region/account availability (some base IDs require a
 * profile at runtime). Nova's published minimum is literally '1K'.
 */
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

/** Match one exact foundation ID or a documented geography profile for it. */
export function bedrockCacheFacts(model: string): BedrockCacheFacts | undefined {
  if (Object.prototype.hasOwnProperty.call(BEDROCK_CACHE_MODELS, model))
    return BEDROCK_CACHE_MODELS[model];
  const separator = model.indexOf('.');
  if (separator < 0) return undefined;
  const profile = model.slice(0, separator);
  const base = model.slice(separator + 1);
  if (!Object.prototype.hasOwnProperty.call(BEDROCK_CACHE_MODELS, base)) return undefined;
  const facts = BEDROCK_CACHE_MODELS[base];
  return facts.profiles.includes(profile) ? facts : undefined;
}
