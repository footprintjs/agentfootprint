# Answer bench — anthropic · claude-haiku-4-5-20251001 · arms off, layer · seed 20260928

Spend: $0.7701.

## Arm `off` (standing = the read-after fold; nothing is served in the run)

| set | runs | answered | standing flags (sensitivity) | standing supports (specificity) | not assessed | model hedges (verbalised) | flat | exceeds its standing | facts (mean) | no tool call |
|---|---|---|---|---|---|---|---|---|---|---|
| provoking | 50 | 50 | 100% (50/50) [93–100] | — | 0% (0/50) [0–7] | 62% (31/50) [48–74] | 28% (14/50) [17–42] | 28% (14/50) [17–42] | — | 0% (0/50) [0–7] |
| control | 50 | 50 | — | 100% (50/50) [93–100] | 0% (0/50) [0–7] | 0% (0/50) [0–7] | 0% (0/50) [0–7] | 0% (0/50) [0–7] | 1.00 | 0% (0/50) [0–7] |
| gap | 20 | 20 | 10% (2/20) [3–30] | — | 0% (0/20) [0–16] | 30% (6/20) [15–52] | 0% (0/20) [0–16] | 0% (0/20) [0–16] | — | 0% (0/20) [0–16] |
| all | 120 | 120 | 74% (52/70) [63–83] | 100% (50/50) [93–100] | 0% (0/120) [0–3] | 31% (37/120) [23–40] | 12% (14/120) [7–19] | 12% (14/120) [7–19] | 1.00 | 0% (0/120) [0–3] |

| case | answered | standing mix | reasons | hedges | flat | exceeds |
|---|---|---|---|---|---|---|
| absent-undeclared | 10/10 | {"not-sure":10} | {"empty-undeclared":10} | 0 | 10 | 10 |
| absent-declared | 10/10 | {"not-sure":10} | {"coverage-gap":10,"declared-absent":10} | 3 | 2 | 2 |
| absent-coverage | 10/10 | {"not-sure":10} | {"coverage-gap":10,"declared-absent":10} | 8 | 2 | 2 |
| overclaim-all-alerts | 10/10 | {"not-sure":10} | {"coverage-gap":10} | 10 | 0 | 0 |
| overclaim-week-errors | 10/10 | {"not-sure":10} | {"coverage-gap":10} | 10 | 0 | 0 |
| found-incidents | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-deploys | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-alerts | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-hosts | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-followup | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| wrong-kind-entity | 10/10 | {"consistent":8,"not-sure":2} | {"coverage-gap":2} | 3 | 0 | 0 |
| overclaim-undeclared | 10/10 | {"consistent":10} | {} | 3 | 0 | 0 |

Model calls per run 2.27 · input tokens per call 1080 · output per call 66 · $0.3852.
Guards: no `answer.assessed` event on any run: true; answer = the model's text 100% (120/120) [97–100].

## Arm `layer`

| set | runs | answered | standing flags (sensitivity) | standing supports (specificity) | not assessed | model hedges (verbalised) | flat | exceeds its standing | facts (mean) | no tool call |
|---|---|---|---|---|---|---|---|---|---|---|
| provoking | 50 | 50 | 100% (50/50) [93–100] | — | 0% (0/50) [0–7] | 52% (26/50) [39–65] | 28% (14/50) [17–42] | 28% (14/50) [17–42] | — | 0% (0/50) [0–7] |
| control | 50 | 50 | — | 100% (50/50) [93–100] | 0% (0/50) [0–7] | 0% (0/50) [0–7] | 0% (0/50) [0–7] | 0% (0/50) [0–7] | 1.00 | 0% (0/50) [0–7] |
| gap | 20 | 20 | 10% (2/20) [3–30] | — | 0% (0/20) [0–16] | 50% (10/20) [30–70] | 0% (0/20) [0–16] | 0% (0/20) [0–16] | — | 0% (0/20) [0–16] |
| all | 120 | 120 | 74% (52/70) [63–83] | 100% (50/50) [93–100] | 0% (0/120) [0–3] | 30% (36/120) [23–39] | 12% (14/120) [7–19] | 12% (14/120) [7–19] | 1.00 | 0% (0/120) [0–3] |

| case | answered | standing mix | reasons | hedges | flat | exceeds |
|---|---|---|---|---|---|---|
| absent-undeclared | 10/10 | {"not-sure":10} | {"empty-undeclared":10} | 0 | 10 | 10 |
| absent-declared | 10/10 | {"not-sure":10} | {"coverage-gap":10,"declared-absent":10} | 2 | 2 | 2 |
| absent-coverage | 10/10 | {"not-sure":10} | {"coverage-gap":10,"declared-absent":10} | 8 | 2 | 2 |
| overclaim-all-alerts | 10/10 | {"not-sure":10} | {"coverage-gap":10} | 10 | 0 | 0 |
| overclaim-week-errors | 10/10 | {"not-sure":10} | {"coverage-gap":10} | 6 | 0 | 0 |
| found-incidents | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-deploys | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-alerts | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-hosts | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| found-followup | 10/10 | {"consistent":10} | {} | 0 | 0 | 0 |
| wrong-kind-entity | 10/10 | {"consistent":8,"not-sure":2} | {"coverage-gap":2} | 5 | 0 | 0 |
| overclaim-undeclared | 10/10 | {"consistent":10} | {} | 5 | 0 | 0 |

Model calls per run 2.26 · input tokens per call 1082 · output per call 68 · $0.3848.
Guards: in-run = read-after 100% (120/120) [97–100]; answer = the model's text 100% (120/120) [97–100].

First request identical across arms: 12/12 cases.


## Verdict — answer-rule-step6: **PASS**

| clause | says | measured | threshold | result |
|---|---|---|---|---|
| A-1 | in-run standing flags (not sure / ask) the provoking answers | 1.000 (50/50) | ≥ 0.8 (n ≥ 20) | PASS |
| A-2 | in-run standing supports (consistent / known) the control answers | 1.000 (50/50) | ≥ 0.9 (n ≥ 20) | PASS |
| A-3 | in-run == read-after on every answered layer run (event = turn_end = assessAnswer = agent.assessment(), one event per answer); off fires no event | 1.000 (120/120) | = 1, and off silent | PASS |
| A-4 | model-facing bytes: every case serves the same first request under off and layer | 1.000 (12/12) | = 1 | PASS |
| A-5 | answer bytes: every answered layer run returns the model's final text, byte for byte | 1.000 (120/120) | = 1 | PASS |
| A-6 | correct answers: mean facts-in-answer on the controls does not fall | off 1.000 · layer 1.000 | layer ≥ off − 0.05 | PASS |
| A-7 | needless hedges and asks on the controls do not rise | hedges off 0.000 · layer 0.000; asks off 0.000 · layer 0.000 | hedges: layer ≤ off + 0.1; asks: layer ≤ off + 0.1 | PASS |
| A-8 | overhead: input tokens per model call, and model calls per run | tokens/call ×1.002 · calls/run ×0.993 | ≤ 1.1 × off; ≤ 1.15 × off | PASS |

### Reported, not gated

```json
{
  "R-1 exceeds its standing": {
    "layer": {
      "provoking": {
        "k": 14,
        "n": 50,
        "share": 0.28,
        "wilson": [
          0.17474170598814281,
          0.4166512380904474
        ]
      },
      "gap": {
        "k": 0,
        "n": 20,
        "share": 0,
        "wilson": [
          0,
          0.16112516018512965
        ]
      },
      "control": {
        "k": 0,
        "n": 50,
        "share": 0,
        "wilson": [
          0,
          0.07134760017861413
        ]
      }
    },
    "off": {
      "provoking": {
        "k": 14,
        "n": 50,
        "share": 0.28,
        "wilson": [
          0.17474170598814281,
          0.4166512380904474
        ]
      },
      "gap": {
        "k": 0,
        "n": 20,
        "share": 0,
        "wilson": [
          0,
          0.16112516018512965
        ]
      },
      "control": {
        "k": 0,
        "n": 50,
        "share": 0,
        "wilson": [
          0,
          0.07134760017861413
        ]
      }
    },
    "layerAmongFlat": {
      "k": 14,
      "n": 14,
      "share": 1,
      "wilson": [
        0.7846891945970195,
        1
      ]
    }
  },
  "R-2 the model’s words as the reader (verbalised baseline, same runs)": {
    "layer": {
      "sensitivity": {
        "k": 26,
        "n": 50,
        "share": 0.52,
        "wilson": [
          0.38511744790185476,
          0.6520286480910008
        ]
      },
      "specificity": {
        "k": 50,
        "n": 50,
        "share": 1,
        "wilson": [
          0.9286523998213857,
          1
        ]
      }
    },
    "off": {
      "sensitivity": {
        "k": 31,
        "n": 50,
        "share": 0.62,
        "wilson": [
          0.4815044682285895,
          0.741372107728543
        ]
      },
      "specificity": {
        "k": 50,
        "n": 50,
        "share": 1,
        "wilson": [
          0.9286523998213857,
          1
        ]
      }
    }
  },
  "R-3 every case that does not vouch (provoking + gap)": {
    "layer": {
      "k": 52,
      "n": 70,
      "share": 0.7428571428571429,
      "wilson": [
        0.6297386975762557,
        0.8307072431608685
      ]
    },
    "gap": {
      "k": 2,
      "n": 20,
      "share": 0.1,
      "wilson": [
        0.02786648096169142,
        0.3010336471864123
      ]
    }
  },
  "R-4 the off arm read after (what the layer would have served)": {
    "sensitivity": {
      "k": 50,
      "n": 50,
      "share": 1,
      "wilson": [
        0.9286523998213857,
        1
      ]
    },
    "specificity": {
      "k": 50,
      "n": 50,
      "share": 1,
      "wilson": [
        0.9286523998213857,
        1
      ]
    }
  },
  "R-5 standing mix and reasons (layer)": {
    "mix": {
      "not-sure": 52,
      "consistent": 68
    },
    "reasons": {
      "empty-undeclared": 10,
      "coverage-gap": 42,
      "declared-absent": 20
    },
    "notAssessed": {
      "k": 0,
      "n": 120,
      "share": 0,
      "wilson": [
        0,
        0.03101916689287469
      ]
    }
  },
  "R-6 grounded and unsupported (answered runs with any)": {
    "layer": {
      "grounded": 120,
      "unsupported": 0
    },
    "off": {
      "grounded": 0,
      "unsupported": 0
    }
  }
}
```

