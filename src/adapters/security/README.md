**Support** — one retired policy adapter, kept callable so the refusal can name
where the behaviour went.

## What it reads / what it writes
Nothing. The factory type-checks and refuses by name.

## The one law here
A removed capability that still type-checks must refuse out loud, with the
alternative named. Silence would read as approval.

## Files
- `agentcore.ts` — retired in 9.4.0; refuses with the reason and the
  alternatives.
