**Map** — retains the caller-declared base prompt and cache policy.

# Builder prompt declaration

`system.ts` applies the one-base-system-prompt rule to the original builder
receiver. It owns the prompt value and cache-policy declaration only; state and
public documentation remain on the facade.
