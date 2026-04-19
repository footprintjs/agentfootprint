/**
 * Resolve `'auto'` SurfaceMode to a concrete mode based on a provider
 * hint.
 *
 * Rules (panel #2 + #1):
 *   - Claude 3.5+ / Claude 4 / Claude 5 etc. → `'both'`
 *     (system-prompt adherence is strong; belt-and-braces delivery
 *     adds free correctness signal on long contexts)
 *   - Anthropic models older than 3.5 → `'tool-only'`
 *   - Everything else (openai, mock, ollama, bedrock, unknown) → `'tool-only'`
 *     (portable default; matches eval-on-mock == production-on-real semantics)
 */
import type { ProviderHint, SurfaceMode } from './types';

/**
 * Parse Anthropic model ids like `claude-3-5-sonnet-20240620`,
 * `claude-sonnet-4-5-20250514`, `claude-opus-4-7` into a `{major, minor}`
 * tuple. Returns `null` for ids we can't parse (unknown → fall back to
 * the pre-3.5 path, which is the safe default).
 *
 * Handles the two id formats Anthropic has shipped:
 *   - Legacy: `claude-3-5-sonnet` / `claude-3-opus` (major.minor before family)
 *   - Current: `claude-sonnet-4-5` / `claude-opus-4-7` (family before major.minor)
 */
export function parseAnthropicVersion(modelId: string): { major: number; minor: number } | null {
  // Current format: claude-{family}-{major}-{minor}[-date]
  const current = modelId.match(/^claude-[a-z]+-(\d+)-(\d+)(?:[-].*)?$/);
  if (current) {
    const major = Number(current[1]);
    const minor = Number(current[2]);
    if (Number.isFinite(major) && Number.isFinite(minor)) return { major, minor };
  }

  // Legacy format: claude-{major}-{minor}-{family}[-date]
  const legacy = modelId.match(/^claude-(\d+)(?:-(\d+))?-[a-z]+(?:[-].*)?$/);
  if (legacy) {
    const major = Number(legacy[1]);
    const minor = legacy[2] !== undefined ? Number(legacy[2]) : 0;
    if (Number.isFinite(major) && Number.isFinite(minor)) return { major, minor };
  }

  return null;
}

/** True if the parsed version is Claude ≥ 3.5. */
export function isClaudeStrongAdherence(version: { major: number; minor: number } | null): boolean {
  if (!version) return false;
  if (version.major > 3) return true;
  if (version.major === 3 && version.minor >= 5) return true;
  return false;
}

export function resolveSurfaceMode(
  mode: SurfaceMode,
  hint?: ProviderHint,
): Exclude<SurfaceMode, 'auto'> {
  if (mode !== 'auto') return mode;
  if (!hint) return 'tool-only';

  if (hint.provider === 'anthropic' && hint.modelId) {
    const version = parseAnthropicVersion(hint.modelId);
    return isClaudeStrongAdherence(version) ? 'both' : 'tool-only';
  }

  // OpenAI / Ollama / Bedrock / mock / unknown → portable default
  return 'tool-only';
}
