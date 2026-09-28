# Answer bench — mock · mock · arms off, layer, line · seed 20260928

Spend: $0.0000.

## Arm `off` (standing = the read-after fold; nothing is served in the run)

| set | runs | answered | standing flags (sensitivity) | standing supports (specificity) | not assessed | model hedges (verbalised) | flat | exceeds its standing | facts (mean) | no tool call |
|---|---|---|---|---|---|---|---|---|---|---|
| provoking | 11 | 11 | 91% (10/11) [62–98] | — | 9% (1/11) [2–38] | 27% (3/11) [10–57] | 45% (5/11) [21–72] | 45% (5/11) [21–72] | — | 9% (1/11) [2–38] |
| control | 6 | 6 | — | 100% (5/5) [57–100] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 1.00 | 0% (0/6) [0–39] |
| gap | 3 | 3 | 33% (1/3) [6–79] | — | 0% (0/3) [0–56] | 0% (0/3) [0–56] | 67% (2/3) [21–94] | 33% (1/3) [6–79] | — | 0% (0/3) [0–56] |
| all | 20 | 20 | 79% (11/14) [52–92] | 100% (5/5) [57–100] | 5% (1/20) [1–24] | 15% (3/20) [5–36] | 35% (7/20) [18–57] | 30% (6/20) [15–52] | 1.00 | 5% (1/20) [1–24] |

| case | answered | standing mix | reasons | hedges | flat | exceeds |
|---|---|---|---|---|---|---|
| absent-undeclared | 3/3 | {"not-sure":2,"not-assessed":1} | {"empty-undeclared":2} | 0 | 1 | 1 |
| absent-declared | 2/2 | {"not-sure":2} | {"coverage-gap":2,"declared-absent":2} | 1 | 1 | 1 |
| absent-coverage | 2/2 | {"not-sure":2} | {"coverage-gap":2,"declared-absent":2} | 1 | 1 | 1 |
| overclaim-all-alerts | 2/2 | {"not-sure":2} | {"coverage-gap":2} | 0 | 1 | 1 |
| overclaim-week-errors | 2/2 | {"not-sure":2} | {"coverage-gap":2} | 1 | 1 | 1 |
| found-incidents | 2/2 | {"consistent":1,"not-sure":1} | {"value-unsupported":1} | 0 | 0 | 0 |
| found-deploys | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-alerts | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-hosts | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-followup | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| wrong-kind-entity | 2/2 | {"not-sure":1,"consistent":1} | {"empty-undeclared":1} | 0 | 1 | 1 |
| overclaim-undeclared | 1/1 | {"consistent":1} | {} | 0 | 1 | 0 |

Model calls per run 2.10 · input tokens per call 75 · output per call 9 · $0.0000.
Guards: no `answer.assessed` event on any run: true; answer = the model's text 100% (20/20) [84–100].

## Arm `layer`

| set | runs | answered | standing flags (sensitivity) | standing supports (specificity) | not assessed | model hedges (verbalised) | flat | exceeds its standing | facts (mean) | no tool call |
|---|---|---|---|---|---|---|---|---|---|---|
| provoking | 11 | 11 | 91% (10/11) [62–98] | — | 9% (1/11) [2–38] | 27% (3/11) [10–57] | 45% (5/11) [21–72] | 45% (5/11) [21–72] | — | 9% (1/11) [2–38] |
| control | 6 | 6 | — | 100% (5/5) [57–100] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 1.00 | 0% (0/6) [0–39] |
| gap | 3 | 3 | 33% (1/3) [6–79] | — | 0% (0/3) [0–56] | 0% (0/3) [0–56] | 67% (2/3) [21–94] | 33% (1/3) [6–79] | — | 0% (0/3) [0–56] |
| all | 20 | 20 | 79% (11/14) [52–92] | 100% (5/5) [57–100] | 5% (1/20) [1–24] | 15% (3/20) [5–36] | 35% (7/20) [18–57] | 30% (6/20) [15–52] | 1.00 | 5% (1/20) [1–24] |

| case | answered | standing mix | reasons | hedges | flat | exceeds |
|---|---|---|---|---|---|---|
| absent-undeclared | 3/3 | {"not-sure":2,"not-assessed":1} | {"empty-undeclared":2} | 0 | 1 | 1 |
| absent-declared | 2/2 | {"not-sure":2} | {"coverage-gap":2,"declared-absent":2} | 1 | 1 | 1 |
| absent-coverage | 2/2 | {"not-sure":2} | {"coverage-gap":2,"declared-absent":2} | 1 | 1 | 1 |
| overclaim-all-alerts | 2/2 | {"not-sure":2} | {"coverage-gap":2} | 0 | 1 | 1 |
| overclaim-week-errors | 2/2 | {"not-sure":2} | {"coverage-gap":2} | 1 | 1 | 1 |
| found-incidents | 2/2 | {"consistent":1,"not-sure":1} | {"value-unsupported":1} | 0 | 0 | 0 |
| found-deploys | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-alerts | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-hosts | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-followup | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| wrong-kind-entity | 2/2 | {"not-sure":1,"consistent":1} | {"empty-undeclared":1} | 0 | 1 | 1 |
| overclaim-undeclared | 1/1 | {"consistent":1} | {} | 0 | 1 | 0 |

Model calls per run 2.10 · input tokens per call 75 · output per call 9 · $0.0000.
Guards: in-run = read-after 100% (20/20) [84–100]; answer = the model's text 100% (20/20) [84–100].

## Arm `line`

| set | runs | answered | standing flags (sensitivity) | standing supports (specificity) | not assessed | model hedges (verbalised) | flat | exceeds its standing | facts (mean) | no tool call |
|---|---|---|---|---|---|---|---|---|---|---|
| provoking | 11 | 11 | 91% (10/11) [62–98] | — | 9% (1/11) [2–38] | 27% (3/11) [10–57] | 45% (5/11) [21–72] | 45% (5/11) [21–72] | — | 9% (1/11) [2–38] |
| control | 6 | 6 | — | 100% (5/5) [57–100] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 0% (0/6) [0–39] | 1.00 | 0% (0/6) [0–39] |
| gap | 3 | 3 | 33% (1/3) [6–79] | — | 0% (0/3) [0–56] | 0% (0/3) [0–56] | 67% (2/3) [21–94] | 33% (1/3) [6–79] | — | 0% (0/3) [0–56] |
| all | 20 | 20 | 79% (11/14) [52–92] | 100% (5/5) [57–100] | 5% (1/20) [1–24] | 15% (3/20) [5–36] | 35% (7/20) [18–57] | 30% (6/20) [15–52] | 1.00 | 5% (1/20) [1–24] |

| case | answered | standing mix | reasons | hedges | flat | exceeds |
|---|---|---|---|---|---|---|
| absent-undeclared | 3/3 | {"not-sure":2,"not-assessed":1} | {"empty-undeclared":2} | 0 | 1 | 1 |
| absent-declared | 2/2 | {"not-sure":2} | {"coverage-gap":2,"declared-absent":2} | 1 | 1 | 1 |
| absent-coverage | 2/2 | {"not-sure":2} | {"coverage-gap":2,"declared-absent":2} | 1 | 1 | 1 |
| overclaim-all-alerts | 2/2 | {"not-sure":2} | {"coverage-gap":2} | 0 | 1 | 1 |
| overclaim-week-errors | 2/2 | {"not-sure":2} | {"coverage-gap":2} | 1 | 1 | 1 |
| found-incidents | 2/2 | {"consistent":1,"not-sure":1} | {"value-unsupported":1} | 0 | 0 | 0 |
| found-deploys | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-alerts | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-hosts | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| found-followup | 1/1 | {"consistent":1} | {} | 0 | 0 | 0 |
| wrong-kind-entity | 2/2 | {"not-sure":1,"consistent":1} | {"empty-undeclared":1} | 0 | 1 | 1 |
| overclaim-undeclared | 1/1 | {"consistent":1} | {} | 0 | 1 | 0 |

Model calls per run 2.10 · input tokens per call 76 · output per call 9 · $0.0000.
Guards: in-run = read-after 100% (20/20) [84–100]; answer = the model's text 0% (0/20) [0–16].

First request identical across arms: 12/12 cases.


## Verdict — answer-rule-step6: **NOT-MEASURABLE**

| clause | says | measured | threshold | result |
|---|---|---|---|---|
| A-1 | in-run standing flags (not sure / ask) the provoking answers | 0.909 (10/11) | ≥ 0.8 (n ≥ 20) | NOT-MEASURABLE |
| A-2 | in-run standing supports (consistent / known) the control answers | 1.000 (5/5) | ≥ 0.9 (n ≥ 20) | NOT-MEASURABLE |
| A-3 | in-run == read-after on every answered layer run (event = turn_end = assessAnswer = agent.assessment(), one event per answer); off fires no event | 1.000 (20/20) | = 1, and off silent | PASS |
| A-4 | model-facing bytes: every case serves the same first request under off and layer | 1.000 (12/12) | = 1 | PASS |
| A-5 | answer bytes: every answered layer run returns the model's final text, byte for byte | 1.000 (20/20) | = 1 | PASS |
| A-6 | correct answers: mean facts-in-answer on the controls does not fall | off 1.000 · layer 1.000 | layer ≥ off − 0.05 | PASS |
| A-7 | needless hedges and asks on the controls do not rise | hedges off 0.000 · layer 0.000; asks off 0.000 · layer 0.000 | hedges: layer ≤ off + 0.1; asks: layer ≤ off + 0.1 | PASS |
| A-8 | overhead: input tokens per model call, and model calls per run | tokens/call ×1.000 · calls/run ×1.000 | ≤ 1.1 × off; ≤ 1.15 × off | PASS |

### Reported, not gated

```json
{
  "R-1 exceeds its standing": {
    "layer": {
      "provoking": {
        "k": 5,
        "n": 11,
        "share": 0.45454545454545453,
        "wilson": [
          0.21271271487637833,
          0.7199084642140241
        ]
      },
      "gap": {
        "k": 1,
        "n": 3,
        "share": 0.3333333333333333,
        "wilson": [
          0.06149194402093078,
          0.7923404011921757
        ]
      },
      "control": {
        "k": 0,
        "n": 6,
        "share": 0,
        "wilson": [
          0,
          0.39033429165637346
        ]
      }
    },
    "off": {
      "provoking": {
        "k": 5,
        "n": 11,
        "share": 0.45454545454545453,
        "wilson": [
          0.21271271487637833,
          0.7199084642140241
        ]
      },
      "gap": {
        "k": 1,
        "n": 3,
        "share": 0.3333333333333333,
        "wilson": [
          0.06149194402093078,
          0.7923404011921757
        ]
      },
      "control": {
        "k": 0,
        "n": 6,
        "share": 0,
        "wilson": [
          0,
          0.39033429165637346
        ]
      }
    },
    "layerAmongFlat": {
      "k": 6,
      "n": 7,
      "share": 0.8571428571428571,
      "wilson": [
        0.486872167860775,
        0.9743203759421759
      ]
    }
  },
  "R-2 the model’s words as the reader (verbalised baseline, same runs)": {
    "layer": {
      "sensitivity": {
        "k": 3,
        "n": 11,
        "share": 0.2727272727272727,
        "wilson": [
          0.09746059213308628,
          0.5656453033189257
        ]
      },
      "specificity": {
        "k": 5,
        "n": 5,
        "share": 1,
        "wilson": [
          0.5655175313406071,
          1
        ]
      }
    },
    "off": {
      "sensitivity": {
        "k": 3,
        "n": 11,
        "share": 0.2727272727272727,
        "wilson": [
          0.09746059213308628,
          0.5656453033189257
        ]
      },
      "specificity": {
        "k": 5,
        "n": 5,
        "share": 1,
        "wilson": [
          0.5655175313406071,
          1
        ]
      }
    }
  },
  "R-3 every case that does not vouch (provoking + gap)": {
    "layer": {
      "k": 11,
      "n": 14,
      "share": 0.7857142857142857,
      "wilson": [
        0.5241076920169465,
        0.9242861334670647
      ]
    },
    "gap": {
      "k": 1,
      "n": 3,
      "share": 0.3333333333333333,
      "wilson": [
        0.06149194402093078,
        0.7923404011921757
      ]
    }
  },
  "R-4 the off arm read after (what the layer would have served)": {
    "sensitivity": {
      "k": 10,
      "n": 11,
      "share": 0.9090909090909091,
      "wilson": [
        0.6226415608917041,
        0.9837678272946745
      ]
    },
    "specificity": {
      "k": 5,
      "n": 5,
      "share": 1,
      "wilson": [
        0.5655175313406071,
        1
      ]
    }
  },
  "R-5 standing mix and reasons (layer)": {
    "mix": {
      "not-sure": 12,
      "not-assessed": 1,
      "consistent": 7
    },
    "reasons": {
      "empty-undeclared": 3,
      "coverage-gap": 8,
      "declared-absent": 4,
      "value-unsupported": 1
    },
    "notAssessed": {
      "k": 1,
      "n": 20,
      "share": 0.05,
      "wilson": [
        0.008881448702335523,
        0.23613119546428119
      ]
    }
  },
  "R-6 grounded and unsupported (answered runs with any)": {
    "layer": {
      "grounded": 19,
      "unsupported": 1
    },
    "off": {
      "grounded": 0,
      "unsupported": 1
    }
  }
}
```

