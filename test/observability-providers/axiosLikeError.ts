/**
 * An error shaped EXACTLY like axios 1.x's `AxiosError`: `toJSON` on the
 * prototype, returning `config` (request headers included) and `stack` — the
 * shape the round-4 recheck (RB2) showed a value-reading replacer never sees.
 * Real axios is not a dependency of this repo, so the shape is reproduced
 * verbatim from `axios/lib/core/AxiosError.js · toJSON` (1.7.x).
 */
export class AxiosLikeError extends Error {
  config: { headers: Record<string, string> };
  code = 'ERR_BAD_REQUEST';
  constructor(message: string, authorization = 'Bearer tok-RECHECK') {
    super(message);
    this.name = 'AxiosError';
    this.config = { headers: { Authorization: authorization } };
  }
  toJSON() {
    return {
      message: this.message,
      name: this.name,
      stack: this.stack,
      config: this.config,
      code: this.code,
    };
  }
}
