/* GENERATED — do not edit by hand. Produced by demo/gen-backtrack-board.ts from a REAL
 * localizeContextBug → toBacktrackTrace run (example-05 scenario, deterministic mock provider).
 * Every score, rank, verdict, honesty line, and custody pane is computed, not authored.
 * Regenerate: TSX_TSCONFIG_PATH=examples/runtime.tsconfig.json npx tsx demo/gen-backtrack-board.ts */
window.BACKTRACK_TRACES = {
  "rank": {
    "pick": "1 · backtrack — ranking only",
    "order": 1,
    "claim": "The agent approved a refund 47 days past the 30-day window — why?",
    "mode": "correlational",
    "agent": "refunds-assistant",
    "model": "mock-1",
    "answer": {
      "text": "Refund APPROVED: Dana Reyes holds VIP tier override status, so the 47-day-old order qualifies for a refund beyond the 30-day window.",
      "label": "the wrong answer"
    },
    "decidedAt": {
      "id": "call-llm#40",
      "label": "CallLLM",
      "kind": "llm"
    },
    "suspects": [
      {
        "kind": "arg",
        "name": "seed#0",
        "score": 1,
        "rank": 1,
        "upperBound": true,
        "edge": {
          "key": "iteration",
          "weight": 1,
          "kind": "data"
        },
        "path": [
          {
            "key": "",
            "kind": "control",
            "via": "call-llm#40 ← sf-route#21"
          },
          {
            "key": "iteration",
            "kind": "data",
            "via": "sf-route#21 ← seed#0"
          }
        ],
        "bornAt": {
          "id": "seed#0",
          "label": "Initialize",
          "via": "run args/env (untracked)"
        }
      },
      {
        "kind": "stage",
        "name": "call-llm#18",
        "score": 1,
        "rank": 2,
        "upperBound": true,
        "edge": {
          "key": "llmLatestToolCalls",
          "weight": 1,
          "kind": "data"
        },
        "path": [
          {
            "key": "",
            "kind": "control",
            "via": "call-llm#40 ← sf-route#21"
          },
          {
            "key": "llmLatestToolCalls",
            "kind": "data",
            "via": "sf-route#21 ← call-llm#18"
          }
        ],
        "bornAt": {
          "id": "call-llm#18",
          "label": "CallLLM",
          "via": "stage commit"
        }
      },
      {
        "kind": "stage",
        "name": "sf-route#21",
        "score": 1,
        "rank": 3,
        "upperBound": true,
        "edge": {
          "weight": 1,
          "kind": "control"
        },
        "bornAt": {
          "id": "sf-route#21",
          "label": "Route",
          "via": "stage commit"
        }
      },
      {
        "kind": "injection",
        "flavor": "fact",
        "name": "vip-override-fact",
        "text": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.",
        "score": 0.8496744297169786,
        "rank": 5,
        "edge": {
          "key": "systemPromptInjections",
          "weight": 0.9225806074910801,
          "kind": "data"
        },
        "bornAt": {
          "id": "context#6",
          "label": "Context",
          "via": "injection engine"
        },
        "custody": [
          {
            "step": "born",
            "detail": "defined as a fact injection (who wrote it)",
            "at": "context#6",
            "content": "data: \"Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\"",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "landed",
            "detail": "the Context stage WROTE it into systemPromptInjections (who mutated state)",
            "at": "context#6",
            "variable": "systemPromptInjections",
            "content": "{ source: \"fact\", sourceId: \"vip-override-fact\",\n  rawContent: \"Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\" }",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "read",
            "detail": "call-llm#40 READ it into the system prompt — exactly what the model saw",
            "at": "call-llm#40",
            "variable": "systemPrompt",
            "content": "You are a refunds assistant. Policy: refunds only within 30 days of purchase.\n\nCustomer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\n\nStyle rule #12: limit replies to two (2) sentences / 40 words max.",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "answer",
            "detail": "the wrong decision came out of this call — the bug"
          }
        ]
      },
      {
        "kind": "injection",
        "flavor": "fact",
        "name": "style-fact",
        "text": "Style rule #12: limit replies to two (2) sentences / 40 words max.",
        "score": 0.8403713019112581,
        "rank": 6,
        "edge": {
          "key": "systemPromptInjections",
          "weight": 0.9225806074910801,
          "kind": "data"
        },
        "bornAt": {
          "id": "context#6",
          "label": "Context",
          "via": "injection engine"
        },
        "custody": [
          {
            "step": "born",
            "detail": "defined as a fact injection (who wrote it)",
            "at": "context#6",
            "content": "data: \"Style rule #12: limit replies to two (2) sentences / 40 words max.\"",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "landed",
            "detail": "the Context stage WROTE it into systemPromptInjections (who mutated state)",
            "at": "context#6",
            "variable": "systemPromptInjections",
            "content": "{ source: \"fact\", sourceId: \"style-fact\",\n  rawContent: \"Style rule #12: limit replies to two (2) sentences / 40 words max.\" }",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "read",
            "detail": "call-llm#40 READ it into the system prompt — exactly what the model saw",
            "at": "call-llm#40",
            "variable": "systemPrompt",
            "content": "You are a refunds assistant. Policy: refunds only within 30 days of purchase.\n\nCustomer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\n\nStyle rule #12: limit replies to two (2) sentences / 40 words max.",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "answer",
            "detail": "the wrong decision came out of this call — the bug"
          }
        ]
      },
      {
        "kind": "tool",
        "name": "lookup_order",
        "text": "Order A-1001: purchased 47 days ago, price $480, category electronics.",
        "score": 0.7137507718720595,
        "rank": 7,
        "edge": {
          "key": "history",
          "weight": 0.7988661014532927,
          "kind": "data"
        },
        "bornAt": {
          "id": "tool-calls#22",
          "label": "ToolCalls",
          "via": "tool result"
        }
      }
    ],
    "folded": "1 more suspect folded — #4 sf-cache#14 (path-only upper bounds) — every id drillable with the trace toolpack",
    "scoreNote": "top-2 margin 0.00 — proxy scores alone cannot separate them.",
    "honesty": [
      "⚠ untracked-sources: 1 slice node(s) also consumed untracked inputs (args/env/silent reads) — those inputs produce no edges; the slice through them is incomplete.",
      "scores/weights are deterministic embedding-geometry proxies — semantic alignment, not model internals.",
      "only ablation verdicts make causal claims."
    ]
  },
  "answer": {
    "pick": "2 · + ablation — the proof",
    "order": 2,
    "claim": "The agent approved a refund 47 days past the 30-day window — why?",
    "mode": "causal",
    "agent": "refunds-assistant",
    "model": "mock-1",
    "answer": {
      "text": "Refund APPROVED: Dana Reyes holds VIP tier override status, so the 47-day-old order qualifies for a refund beyond the 30-day window.",
      "label": "the wrong answer"
    },
    "decidedAt": {
      "id": "call-llm#40",
      "label": "CallLLM",
      "kind": "llm"
    },
    "suspects": [
      {
        "kind": "arg",
        "name": "seed#0",
        "score": 1,
        "rank": 1,
        "upperBound": true,
        "edge": {
          "key": "iteration",
          "weight": 1,
          "kind": "data"
        },
        "path": [
          {
            "key": "",
            "kind": "control",
            "via": "call-llm#40 ← sf-route#21"
          },
          {
            "key": "iteration",
            "kind": "data",
            "via": "sf-route#21 ← seed#0"
          }
        ],
        "bornAt": {
          "id": "seed#0",
          "label": "Initialize",
          "via": "run args/env (untracked)"
        }
      },
      {
        "kind": "stage",
        "name": "call-llm#18",
        "score": 1,
        "rank": 2,
        "upperBound": true,
        "edge": {
          "key": "llmLatestToolCalls",
          "weight": 1,
          "kind": "data"
        },
        "path": [
          {
            "key": "",
            "kind": "control",
            "via": "call-llm#40 ← sf-route#21"
          },
          {
            "key": "llmLatestToolCalls",
            "kind": "data",
            "via": "sf-route#21 ← call-llm#18"
          }
        ],
        "bornAt": {
          "id": "call-llm#18",
          "label": "CallLLM",
          "via": "stage commit"
        }
      },
      {
        "kind": "stage",
        "name": "sf-route#21",
        "score": 1,
        "rank": 3,
        "upperBound": true,
        "edge": {
          "weight": 1,
          "kind": "control"
        },
        "bornAt": {
          "id": "sf-route#21",
          "label": "Route",
          "via": "stage commit"
        }
      },
      {
        "kind": "injection",
        "flavor": "fact",
        "name": "vip-override-fact",
        "text": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.",
        "score": 0.8496744297169786,
        "rank": 5,
        "edge": {
          "key": "systemPromptInjections",
          "weight": 0.9225806074910801,
          "kind": "data"
        },
        "bornAt": {
          "id": "context#6",
          "label": "Context",
          "via": "injection engine"
        },
        "custody": [
          {
            "step": "born",
            "detail": "defined as a fact injection (who wrote it)",
            "at": "context#6",
            "content": "data: \"Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\"",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "landed",
            "detail": "the Context stage WROTE it into systemPromptInjections (who mutated state)",
            "at": "context#6",
            "variable": "systemPromptInjections",
            "content": "{ source: \"fact\", sourceId: \"vip-override-fact\",\n  rawContent: \"Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\" }",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "read",
            "detail": "call-llm#40 READ it into the system prompt — exactly what the model saw",
            "at": "call-llm#40",
            "variable": "systemPrompt",
            "content": "You are a refunds assistant. Policy: refunds only within 30 days of purchase.\n\nCustomer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\n\nStyle rule #12: limit replies to two (2) sentences / 40 words max.",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "answer",
            "detail": "the wrong decision came out of this call — the bug"
          }
        ],
        "verdict": {
          "kind": "confirmed",
          "flips": 3,
          "samples": 3,
          "claim": "CAUSAL: ablating injection 'vip-override-fact' flipped the outcome in 3/3 seeded reruns (mean similarity to original 0.970 ± 0.000)."
        }
      },
      {
        "kind": "injection",
        "flavor": "fact",
        "name": "style-fact",
        "text": "Style rule #12: limit replies to two (2) sentences / 40 words max.",
        "score": 0.8403713019112581,
        "rank": 6,
        "edge": {
          "key": "systemPromptInjections",
          "weight": 0.9225806074910801,
          "kind": "data"
        },
        "bornAt": {
          "id": "context#6",
          "label": "Context",
          "via": "injection engine"
        },
        "custody": [
          {
            "step": "born",
            "detail": "defined as a fact injection (who wrote it)",
            "at": "context#6",
            "content": "data: \"Style rule #12: limit replies to two (2) sentences / 40 words max.\"",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "landed",
            "detail": "the Context stage WROTE it into systemPromptInjections (who mutated state)",
            "at": "context#6",
            "variable": "systemPromptInjections",
            "content": "{ source: \"fact\", sourceId: \"style-fact\",\n  rawContent: \"Style rule #12: limit replies to two (2) sentences / 40 words max.\" }",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "read",
            "detail": "call-llm#40 READ it into the system prompt — exactly what the model saw",
            "at": "call-llm#40",
            "variable": "systemPrompt",
            "content": "You are a refunds assistant. Policy: refunds only within 30 days of purchase.\n\nCustomer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\n\nStyle rule #12: limit replies to two (2) sentences / 40 words max.",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "answer",
            "detail": "the wrong decision came out of this call — the bug"
          }
        ],
        "verdict": {
          "kind": "not-confirmed",
          "flips": 0,
          "samples": 3,
          "claim": "NOT CONFIRMED: ablating injection 'style-fact' did not change the outcome in 3 seeded reruns — its ranking remains a correlational proxy only."
        }
      },
      {
        "kind": "tool",
        "name": "lookup_order",
        "text": "Order A-1001: purchased 47 days ago, price $480, category electronics.",
        "score": 0.7137507718720595,
        "rank": 7,
        "edge": {
          "key": "history",
          "weight": 0.7988661014532927,
          "kind": "data"
        },
        "bornAt": {
          "id": "tool-calls#22",
          "label": "ToolCalls",
          "via": "tool result"
        },
        "verdict": {
          "kind": "not-confirmed",
          "flips": 0,
          "samples": 3,
          "claim": "NOT CONFIRMED: ablating tool 'lookup_order' did not change the outcome in 3 seeded reruns — its ranking remains a correlational proxy only."
        }
      }
    ],
    "folded": "1 more suspect folded — #4 sf-cache#14 (path-only upper bounds) — every id drillable with the trace toolpack",
    "scoreNote": "top-2 margin 0.00 — proxy scores alone cannot separate them; the ablation test can.",
    "baseline": "0/3 flipped with no ablation",
    "honesty": [
      "⚠ untracked-sources: 1 slice node(s) also consumed untracked inputs (args/env/silent reads) — those inputs produce no edges; the slice through them is incomplete.",
      "scores/weights are deterministic embedding-geometry proxies — semantic alignment, not model internals.",
      "only ablation verdicts make causal claims."
    ]
  },
  "tool": {
    "pick": "tool choice — first call",
    "order": 3,
    "claim": "Iteration 1 — the agent chose lookup_order. What was it given?",
    "mode": "correlational",
    "agent": "refunds-assistant",
    "model": "mock-1",
    "answer": {
      "text": "tool call → lookup_order(...) — chosen before any tool result existed.",
      "label": "the decision under investigation",
      "tone": "question"
    },
    "decidedAt": {
      "id": "call-llm#18",
      "label": "CallLLM",
      "kind": "llm"
    },
    "suspects": [
      {
        "kind": "arg",
        "name": "seed#0",
        "score": 0.9140360411399588,
        "rank": 1,
        "upperBound": true,
        "edge": {
          "key": "dynamicToolSchemas",
          "weight": 0.9140360411399588,
          "kind": "data"
        },
        "bornAt": {
          "id": "seed#0",
          "label": "Initialize",
          "via": "run args/env (untracked)"
        }
      },
      {
        "kind": "stage",
        "name": "sf-cache#14",
        "score": 0.879951123568186,
        "rank": 2,
        "upperBound": true,
        "edge": {
          "key": "cacheMarkers",
          "weight": 0.879951123568186,
          "kind": "data"
        },
        "bornAt": {
          "id": "sf-cache#14",
          "label": "Cache",
          "via": "stage commit"
        }
      },
      {
        "kind": "injection",
        "flavor": "fact",
        "name": "vip-override-fact",
        "text": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.",
        "score": 0.539391228812346,
        "rank": 3,
        "edge": {
          "key": "systemPromptInjections",
          "weight": 0.8496535072623708,
          "kind": "data"
        },
        "bornAt": {
          "id": "context#6",
          "label": "Context",
          "via": "injection engine"
        },
        "custody": [
          {
            "step": "born",
            "detail": "defined as a fact injection (who wrote it)",
            "at": "context#6",
            "content": "data: \"Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\"",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "landed",
            "detail": "the Context stage WROTE it into systemPromptInjections (who mutated state)",
            "at": "context#6",
            "variable": "systemPromptInjections",
            "content": "{ source: \"fact\", sourceId: \"vip-override-fact\",\n  rawContent: \"Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\" }",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "read",
            "detail": "call-llm#18 READ it into the system prompt — exactly what the model saw",
            "at": "call-llm#18",
            "variable": "systemPrompt",
            "content": "You are a refunds assistant. Policy: refunds only within 30 days of purchase.\n\nCustomer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\n\nStyle rule #12: limit replies to two (2) sentences / 40 words max.",
            "highlight": "Customer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window."
          },
          {
            "step": "answer",
            "detail": "the wrong decision came out of this call — the bug"
          }
        ]
      },
      {
        "kind": "injection",
        "flavor": "fact",
        "name": "style-fact",
        "text": "Style rule #12: limit replies to two (2) sentences / 40 words max.",
        "score": 0.530855584531744,
        "rank": 4,
        "edge": {
          "key": "systemPromptInjections",
          "weight": 0.8496535072623708,
          "kind": "data"
        },
        "bornAt": {
          "id": "context#6",
          "label": "Context",
          "via": "injection engine"
        },
        "custody": [
          {
            "step": "born",
            "detail": "defined as a fact injection (who wrote it)",
            "at": "context#6",
            "content": "data: \"Style rule #12: limit replies to two (2) sentences / 40 words max.\"",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "landed",
            "detail": "the Context stage WROTE it into systemPromptInjections (who mutated state)",
            "at": "context#6",
            "variable": "systemPromptInjections",
            "content": "{ source: \"fact\", sourceId: \"style-fact\",\n  rawContent: \"Style rule #12: limit replies to two (2) sentences / 40 words max.\" }",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "read",
            "detail": "call-llm#18 READ it into the system prompt — exactly what the model saw",
            "at": "call-llm#18",
            "variable": "systemPrompt",
            "content": "You are a refunds assistant. Policy: refunds only within 30 days of purchase.\n\nCustomer Dana Reyes holds VIP tier override status: refunds are approved beyond the 30-day window.\n\nStyle rule #12: limit replies to two (2) sentences / 40 words max.",
            "highlight": "Style rule #12: limit replies to two (2) sentences / 40 words max."
          },
          {
            "step": "answer",
            "detail": "the wrong decision came out of this call — the bug"
          }
        ]
      }
    ],
    "scoreNote": "top-2 margin 0.03 — proxy scores alone cannot separate them.",
    "honesty": [
      "⚠ untracked-sources: 1 slice node(s) also consumed untracked inputs (args/env/silent reads) — those inputs produce no edges; the slice through them is incomplete.",
      "scores/weights are deterministic embedding-geometry proxies — semantic alignment, not model internals.",
      "only ablation verdicts make causal claims."
    ]
  },
  "rule": {
    "pick": "rule decision — decide()",
    "order": 4,
    "claim": "The pipeline approved an unaffordable loan — why?",
    "mode": "correlational",
    "agent": "loan-pipeline",
    "model": "decide()",
    "answer": {
      "text": "decision = approve (DTI computed against ANNUAL income — should be DECLINE)",
      "label": "the rule decision",
      "tone": "question"
    },
    "decidedAt": {
      "id": "approve#3",
      "label": "Approve",
      "kind": "llm"
    },
    "suspects": [
      {
        "kind": "stage",
        "name": "adjudicate#2",
        "score": 1,
        "rank": 1,
        "upperBound": true,
        "edge": {
          "key": "Prime credit within affordability policy",
          "weight": 1,
          "kind": "control"
        },
        "bornAt": {
          "id": "adjudicate#2",
          "label": "Adjudicate",
          "via": "stage commit"
        }
      },
      {
        "kind": "stage",
        "name": "intake#0",
        "score": 1,
        "rank": 2,
        "upperBound": true,
        "edge": {
          "key": "creditScore",
          "weight": 1,
          "kind": "data"
        },
        "path": [
          {
            "key": "Prime credit within affordability policy",
            "kind": "control",
            "via": "approve#3 ← adjudicate#2"
          },
          {
            "key": "creditScore",
            "kind": "data",
            "via": "adjudicate#2 ← intake#0"
          }
        ],
        "bornAt": {
          "id": "intake#0",
          "label": "Intake",
          "via": "stage commit"
        }
      },
      {
        "kind": "stage",
        "name": "normalize#1",
        "score": 1,
        "rank": 3,
        "upperBound": true,
        "edge": {
          "key": "dti",
          "weight": 1,
          "kind": "data"
        },
        "path": [
          {
            "key": "Prime credit within affordability policy",
            "kind": "control",
            "via": "approve#3 ← adjudicate#2"
          },
          {
            "key": "dti",
            "kind": "data",
            "via": "adjudicate#2 ← normalize#1"
          }
        ],
        "bornAt": {
          "id": "normalize#1",
          "label": "Normalize",
          "via": "stage commit"
        }
      }
    ],
    "scoreNote": "top-2 margin 0.00 — proxy scores alone cannot separate them.",
    "honesty": [
      "⚠ no-llm-call-ids: no LLM-call step ids (pass llmCallIds or captured events) — no edge received an influence weight; the ranking is structure-only.",
      "scores/weights are deterministic embedding-geometry proxies — semantic alignment, not model internals.",
      "only ablation verdicts make causal claims."
    ]
  }
};
