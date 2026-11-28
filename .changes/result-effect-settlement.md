---
type: breaking
---
**Tool result middleware now governs typed result effects.** Withholding a result also suppresses its framework transition and instruction proposals. A rewrite, or a hooked result whose unchanged content cannot be proven, suppresses these proposals by default. A trusted result policy can explicitly select original proposals against bounded final content. External operations an executed tool already performed remain separate.

Migration: Result hooks that must preserve typed effects should pass through unchanged scalar content or use `sealToolEffectContent` to prepare immutable bounded JSON before returning it. For a rewrite, use `admitToolResultEffects` on one registered result policy and return only the proposal references it explicitly authorizes. Review flows that previously relied on effects from withheld results. A decision to withhold takes precedence over effect admission.
