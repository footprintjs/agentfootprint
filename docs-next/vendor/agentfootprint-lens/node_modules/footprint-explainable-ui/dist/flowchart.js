// src/components/StageNode/StageNode.tsx
import { memo, useEffect as useEffect2, useRef } from "react";
import { Handle, Position } from "@xyflow/react";

// src/theme/ThemeProvider.tsx
import { createContext, useContext } from "react";

// src/theme/tokens.ts
var rawDefaults = {
  colors: {
    primary: "#6366f1",
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    bgPrimary: "#0f172a",
    bgSecondary: "#1e293b",
    bgTertiary: "#334155",
    textPrimary: "#f8fafc",
    textSecondary: "#94a3b8",
    textMuted: "#64748b",
    border: "#334155"
  },
  radius: "8px",
  fontFamily: {
    sans: "Inter, system-ui, -apple-system, sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace"
  }
};
var defaultTokens = {
  colors: {
    primary: `var(--fp-color-primary, ${rawDefaults.colors.primary})`,
    success: `var(--fp-color-success, ${rawDefaults.colors.success})`,
    error: `var(--fp-color-error, ${rawDefaults.colors.error})`,
    warning: `var(--fp-color-warning, ${rawDefaults.colors.warning})`,
    bgPrimary: `var(--fp-bg-primary, ${rawDefaults.colors.bgPrimary})`,
    bgSecondary: `var(--fp-bg-secondary, ${rawDefaults.colors.bgSecondary})`,
    bgTertiary: `var(--fp-bg-tertiary, ${rawDefaults.colors.bgTertiary})`,
    textPrimary: `var(--fp-text-primary, ${rawDefaults.colors.textPrimary})`,
    textSecondary: `var(--fp-text-secondary, ${rawDefaults.colors.textSecondary})`,
    textMuted: `var(--fp-text-muted, ${rawDefaults.colors.textMuted})`,
    border: `var(--fp-border, ${rawDefaults.colors.border})`
  },
  radius: `var(--fp-radius, ${rawDefaults.radius})`,
  fontFamily: {
    sans: `var(--fp-font-sans, ${rawDefaults.fontFamily.sans})`,
    mono: `var(--fp-font-mono, ${rawDefaults.fontFamily.mono})`
  }
};

// src/theme/ThemeProvider.tsx
import { jsx } from "react/jsx-runtime";
var ThemeContext = createContext({});

// src/theme/styles.ts
function v(varName, fallback) {
  return `var(${varName}, ${fallback})`;
}
var theme = {
  primary: v("--fp-color-primary", "#6366f1"),
  success: v("--fp-color-success", "#22c55e"),
  error: v("--fp-color-error", "#ef4444"),
  warning: v("--fp-color-warning", "#f59e0b"),
  bgPrimary: v("--fp-bg-primary", "#0f172a"),
  bgSecondary: v("--fp-bg-secondary", "#1e293b"),
  bgTertiary: v("--fp-bg-tertiary", "#334155"),
  textPrimary: v("--fp-text-primary", "#f8fafc"),
  textSecondary: v("--fp-text-secondary", "#94a3b8"),
  textMuted: v("--fp-text-muted", "#64748b"),
  border: v("--fp-border", "#334155"),
  radius: v("--fp-radius", "8px"),
  fontSans: v("--fp-font-sans", "Inter, system-ui, -apple-system, sans-serif"),
  fontMono: v("--fp-font-mono", "'JetBrains Mono', 'Fira Code', monospace")
};
var fontSize = {
  compact: { label: 10, body: 11, small: 9 },
  default: { label: 11, body: 12, small: 10 },
  detailed: { label: 12, body: 13, small: 11 }
};
var padding = {
  compact: 8,
  default: 12,
  detailed: 16
};

// src/theme/useDarkModeTokens.ts
import { useState, useEffect } from "react";

// src/components/StageNode/StageNode.tsx
import { Fragment, jsx as jsx2, jsxs } from "react/jsx-runtime";
var KEYFRAMES_ID = "fp-stage-node-keyframes";
var KEYFRAMES_CSS = `
@media (prefers-reduced-motion: no-preference) {
  @keyframes fp-pulse {
    0%, 100% { opacity: 0.4; transform: scale(1); }
    50% { opacity: 0.15; transform: scale(1.06); }
  }
  @keyframes fp-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }
}
@media (prefers-reduced-motion: reduce) {
  @keyframes fp-pulse { 0%, 100% { opacity: 0.3; } }
  @keyframes fp-blink { 0%, 100% { opacity: 1; } }
}
`;
var ICON_SIZE = 16;
function StageIcon({ type, color }) {
  const s = ICON_SIZE;
  const props = { width: s, height: s, viewBox: `0 0 ${s} ${s}`, fill: "none", style: { flexShrink: 0 } };
  switch (type) {
    // LLM / AI call — brain/sparkle
    case "llm":
    case "ai":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("circle", { cx: "8", cy: "8", r: "6", stroke: color, strokeWidth: "1.5" }),
        /* @__PURE__ */ jsx2("path", { d: "M5.5 8C5.5 6.5 6.5 5 8 5S10.5 6.5 10.5 8", stroke: color, strokeWidth: "1.2", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("circle", { cx: "8", cy: "9.5", r: "1", fill: color }),
        /* @__PURE__ */ jsx2("line", { x1: "8", y1: "2", x2: "8", y2: "3.5", stroke: color, strokeWidth: "1", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "12.5", y1: "4", x2: "11.2", y2: "5", stroke: color, strokeWidth: "1", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "3.5", y1: "4", x2: "4.8", y2: "5", stroke: color, strokeWidth: "1", strokeLinecap: "round" })
      ] });
    // Tool / function call — gear
    case "tool":
    case "function":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("circle", { cx: "8", cy: "8", r: "3", stroke: color, strokeWidth: "1.5" }),
        [0, 45, 90, 135, 180, 225, 270, 315].map((angle) => {
          const rad = angle * Math.PI / 180;
          const x1 = 8 + Math.cos(rad) * 4.5;
          const y1 = 8 + Math.sin(rad) * 4.5;
          const x2 = 8 + Math.cos(rad) * 6;
          const y2 = 8 + Math.sin(rad) * 6;
          return /* @__PURE__ */ jsx2("line", { x1, y1, x2, y2, stroke: color, strokeWidth: "1.5", strokeLinecap: "round" }, angle);
        })
      ] });
    // RAG / retrieval — magnifying glass + doc
    case "rag":
    case "search":
    case "retrieval":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("circle", { cx: "7", cy: "7", r: "4", stroke: color, strokeWidth: "1.5" }),
        /* @__PURE__ */ jsx2("line", { x1: "10", y1: "10", x2: "13.5", y2: "13.5", stroke: color, strokeWidth: "1.5", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "5.5", y1: "6", x2: "8.5", y2: "6", stroke: color, strokeWidth: "1", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "5.5", y1: "8", x2: "7.5", y2: "8", stroke: color, strokeWidth: "1", strokeLinecap: "round" })
      ] });
    // Parse / process — diamond with arrows
    case "parse":
    case "process":
    case "transform":
      return /* @__PURE__ */ jsx2("svg", { ...props, children: /* @__PURE__ */ jsx2("rect", { x: "4", y: "4", width: "8", height: "8", rx: "1.5", stroke: color, strokeWidth: "1.5", transform: "rotate(45 8 8)" }) });
    // Start / seed — play triangle
    case "start":
    case "seed":
    case "init":
      return /* @__PURE__ */ jsx2("svg", { ...props, children: /* @__PURE__ */ jsx2("path", { d: "M5 3.5L12.5 8L5 12.5V3.5Z", fill: color, opacity: "0.8" }) });
    // End / finalize — stop square
    case "end":
    case "finalize":
    case "output":
      return /* @__PURE__ */ jsx2("svg", { ...props, children: /* @__PURE__ */ jsx2("rect", { x: "4", y: "4", width: "8", height: "8", rx: "1.5", fill: color, opacity: "0.8" }) });
    // Agent — person silhouette
    case "agent":
    case "orchestrator":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("circle", { cx: "8", cy: "5", r: "2.5", stroke: color, strokeWidth: "1.5" }),
        /* @__PURE__ */ jsx2("path", { d: "M3.5 14C3.5 11 5.5 9 8 9S12.5 11 12.5 14", stroke: color, strokeWidth: "1.5", strokeLinecap: "round" })
      ] });
    // Swarm — multi-agent
    case "swarm":
    case "multi-agent":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("circle", { cx: "5", cy: "5", r: "2", stroke: color, strokeWidth: "1.2" }),
        /* @__PURE__ */ jsx2("circle", { cx: "11", cy: "5", r: "2", stroke: color, strokeWidth: "1.2" }),
        /* @__PURE__ */ jsx2("circle", { cx: "8", cy: "11", r: "2", stroke: color, strokeWidth: "1.2" }),
        /* @__PURE__ */ jsx2("line", { x1: "5", y1: "7", x2: "8", y2: "9", stroke: color, strokeWidth: "1", opacity: "0.5" }),
        /* @__PURE__ */ jsx2("line", { x1: "11", y1: "7", x2: "8", y2: "9", stroke: color, strokeWidth: "1", opacity: "0.5" })
      ] });
    // Guard / guardrail — shield
    case "guard":
    case "guardrail":
    case "validate":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("path", { d: "M8 2L3 5V9C3 11.5 5 13.5 8 14.5C11 13.5 13 11.5 13 9V5L8 2Z", stroke: color, strokeWidth: "1.5", strokeLinejoin: "round" }),
        /* @__PURE__ */ jsx2("path", { d: "M6 8L7.5 9.5L10 6.5", stroke: color, strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round" })
      ] });
    // Stream — wave
    case "stream":
    case "streaming":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("path", { d: "M2 8C4 5 6 11 8 8S12 5 14 8", stroke: color, strokeWidth: "1.5", strokeLinecap: "round", fill: "none" }),
        /* @__PURE__ */ jsx2("path", { d: "M2 11C4 8 6 14 8 11S12 8 14 11", stroke: color, strokeWidth: "1", strokeLinecap: "round", fill: "none", opacity: "0.5" })
      ] });
    // Memory / state — database cylinder
    case "memory":
    case "state":
    case "db":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("ellipse", { cx: "8", cy: "4.5", rx: "5", ry: "2", stroke: color, strokeWidth: "1.3" }),
        /* @__PURE__ */ jsx2("line", { x1: "3", y1: "4.5", x2: "3", y2: "11.5", stroke: color, strokeWidth: "1.3" }),
        /* @__PURE__ */ jsx2("line", { x1: "13", y1: "4.5", x2: "13", y2: "11.5", stroke: color, strokeWidth: "1.3" }),
        /* @__PURE__ */ jsx2("ellipse", { cx: "8", cy: "11.5", rx: "5", ry: "2", stroke: color, strokeWidth: "1.3" })
      ] });
    // System prompt — document with lines
    case "system-prompt":
    case "prompt":
    case "instructions":
    case "document":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("rect", { x: "3.5", y: "2", width: "9", height: "12", rx: "1.5", stroke: color, strokeWidth: "1.3", fill: "none" }),
        /* @__PURE__ */ jsx2("line", { x1: "5.5", y1: "5", x2: "10.5", y2: "5", stroke: color, strokeWidth: "1", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "5.5", y1: "7.5", x2: "10.5", y2: "7.5", stroke: color, strokeWidth: "1", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "5.5", y1: "10", x2: "8.5", y2: "10", stroke: color, strokeWidth: "1", strokeLinecap: "round" })
      ] });
    // Messages / conversation — chat bubble
    case "messages":
    case "chat":
    case "conversation":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("rect", { x: "2.5", y: "3", width: "11", height: "8", rx: "2", stroke: color, strokeWidth: "1.3", fill: "none" }),
        /* @__PURE__ */ jsx2("path", { d: "M5.5 11L5.5 13.5L8.5 11", stroke: color, strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" }),
        /* @__PURE__ */ jsx2("line", { x1: "5", y1: "6", x2: "11", y2: "6", stroke: color, strokeWidth: "1", strokeLinecap: "round" }),
        /* @__PURE__ */ jsx2("line", { x1: "5", y1: "8.5", x2: "9", y2: "8.5", stroke: color, strokeWidth: "1", strokeLinecap: "round" })
      ] });
    // Loop — circular arrow
    case "loop":
    case "retry":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("path", { d: "M12 8A4 4 0 1 1 8 4", stroke: color, strokeWidth: "1.5", strokeLinecap: "round", fill: "none" }),
        /* @__PURE__ */ jsx2("path", { d: "M8 1.5L10.5 4L8 6.5", stroke: color, strokeWidth: "1.3", strokeLinecap: "round", strokeLinejoin: "round", fill: "none" })
      ] });
    // Lazy / service — cloud (deferred resolution, loaded on demand)
    case "lazy":
    case "service":
    case "cloud":
      return /* @__PURE__ */ jsx2("svg", { ...props, children: /* @__PURE__ */ jsx2(
        "path",
        {
          d: "M4.5 12C2.8 12 1.5 10.7 1.5 9C1.5 7.5 2.5 6.3 3.8 6C4 4 5.8 2.5 8 2.5C9.8 2.5 11.3 3.5 11.9 5C13.9 5.2 15.5 6.8 15.5 8.8C15.5 10.8 13.9 12.5 11.8 12.5H4.5",
          stroke: color,
          strokeWidth: "1.3",
          strokeLinecap: "round",
          fill: "none"
        }
      ) });
    // Decision — diamond (already handled by isDecider shape)
    case "decision":
    case "router":
      return /* @__PURE__ */ jsxs("svg", { ...props, children: [
        /* @__PURE__ */ jsx2("path", { d: "M8 2L14 8L8 14L2 8Z", stroke: color, strokeWidth: "1.5", fill: "none" }),
        /* @__PURE__ */ jsx2("circle", { cx: "8", cy: "8", r: "1.5", fill: color })
      ] });
    default:
      return null;
  }
}
var StageNode = memo(function StageNode2({
  data
}) {
  const { label, active, done, error, linked, icon, stepNumbers, dimmed, isSubflow, isLazy, isDecider, isFork, description, stageId, showStageId } = data;
  const effectiveIcon = icon || (isLazy ? "lazy" : void 0);
  const isLazyUnresolved = isLazy && !done && !active;
  const injectedRef = useRef(false);
  useEffect2(() => {
    if (injectedRef.current) return;
    if (typeof document !== "undefined" && !document.getElementById(KEYFRAMES_ID)) {
      const styleEl = document.createElement("style");
      styleEl.id = KEYFRAMES_ID;
      styleEl.textContent = KEYFRAMES_CSS;
      document.head.appendChild(styleEl);
    }
    injectedRef.current = true;
  }, []);
  const isOnPath = active || done;
  const isHero = data.emphasis === "hero";
  const isMuted = data.emphasis === "muted";
  const sizeScale = data.size === "lg" ? 1.3 : data.size === "sm" ? 0.85 : 1;
  const restingBg = isHero ? `color-mix(in srgb, ${theme.primary} 12%, ${theme.bgSecondary})` : theme.bgSecondary;
  const restingBorder = isHero ? theme.primary : theme.border;
  const restingShadow = isHero ? `0 0 10px color-mix(in srgb, ${theme.primary} 22%, transparent)` : `0 2px 8px rgba(0,0,0,0.15)`;
  const bg = active ? theme.primary : done ? theme.success : error ? theme.error : restingBg;
  const borderColor = active ? theme.primary : done ? theme.success : error ? theme.error : restingBorder;
  const shadow = active ? `0 0 22px color-mix(in srgb, ${theme.primary} 55%, transparent)` : done ? `0 0 8px color-mix(in srgb, ${theme.success} 20%, transparent)` : error ? `0 0 12px color-mix(in srgb, ${theme.error} 30%, transparent)` : restingShadow;
  const textColor = active || done || error ? "#fff" : theme.textPrimary;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx2(Handle, { type: "target", position: Position.Top, style: { opacity: 0 } }),
    /* @__PURE__ */ jsx2("div", { style: { width: "100%", display: "flex", justifyContent: "center" }, children: /* @__PURE__ */ jsxs(
      "div",
      {
        style: {
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 6,
          // Plumbing recedes. Layers with the run-overlay `dimmed` (not-yet-run)
          // — a muted AND not-run node is faintest, which is correct.
          opacity: isMuted ? 0.5 : void 0
        },
        children: [
          stepNumbers && stepNumbers.length > 0 && isOnPath && /* @__PURE__ */ jsx2(
            "div",
            {
              style: {
                position: "absolute",
                top: -10,
                left: -10,
                display: "flex",
                gap: 3,
                zIndex: 10
              },
              children: stepNumbers.map((num, i) => {
                const isLatest = i === stepNumbers.length - 1;
                const badgeBg = isLatest && active ? theme.primary : theme.success;
                const glow = isLatest && active ? `color-mix(in srgb, ${theme.primary} 50%, transparent)` : `color-mix(in srgb, ${theme.success} 40%, transparent)`;
                return /* @__PURE__ */ jsx2(
                  "div",
                  {
                    style: {
                      width: 22,
                      height: 22,
                      borderRadius: "50%",
                      background: badgeBg,
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: `0 0 8px ${glow}`
                    },
                    children: num
                  },
                  num
                );
              })
            }
          ),
          linked && /* @__PURE__ */ jsx2(
            "div",
            {
              style: {
                position: "absolute",
                inset: -6,
                borderRadius: isDecider ? 0 : `calc(${theme.radius} + 4px)`,
                clipPath: isDecider ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : void 0,
                border: `2px solid ${theme.primary}`,
                opacity: 0.4,
                animation: "fp-pulse 2s ease-in-out infinite"
              }
            }
          ),
          active && /* @__PURE__ */ jsx2(
            "div",
            {
              style: {
                position: "absolute",
                inset: -6,
                borderRadius: isDecider ? 0 : `calc(${theme.radius} + 4px)`,
                clipPath: isDecider ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : void 0,
                border: `2px solid ${theme.primary}`,
                opacity: 0.3,
                animation: "fp-pulse 1.5s ease-out infinite"
              }
            }
          ),
          active && /* @__PURE__ */ jsx2(
            "div",
            {
              style: {
                position: "absolute",
                top: -9,
                right: -8,
                zIndex: 11,
                background: theme.warning,
                color: "#1a1a1a",
                fontSize: 9,
                fontWeight: 800,
                letterSpacing: 0.6,
                padding: "2px 6px",
                borderRadius: 10,
                boxShadow: `0 0 10px color-mix(in srgb, ${theme.warning} 60%, transparent)`
              },
              children: "NOW"
            }
          ),
          isDecider ? /* @__PURE__ */ jsxs("div", { style: { position: "relative", width: 120, height: 72 }, children: [
            /* @__PURE__ */ jsx2(
              "div",
              {
                style: {
                  position: "absolute",
                  inset: 0,
                  background: bg,
                  clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
                  border: "none",
                  boxShadow: shadow,
                  transition: "all 0.3s ease"
                }
              }
            ),
            /* @__PURE__ */ jsx2(
              "div",
              {
                style: {
                  position: "absolute",
                  inset: -2,
                  clipPath: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
                  background: borderColor,
                  zIndex: -1,
                  ...isLazyUnresolved ? {
                    background: "transparent"
                    // Dashed border via SVG for clip-path (CSS border doesn't work with clip-path)
                  } : {}
                }
              }
            ),
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  fontFamily: theme.fontSans,
                  zIndex: 1
                },
                children: [
                  /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
                    effectiveIcon && /* @__PURE__ */ jsx2(StageIcon, { type: effectiveIcon, color: textColor }),
                    !effectiveIcon && /* @__PURE__ */ jsx2("span", { style: { fontSize: 9, color: textColor }, children: "\u25C7" }),
                    /* @__PURE__ */ jsx2(
                      "span",
                      {
                        style: {
                          fontSize: 11,
                          fontWeight: 600,
                          color: textColor,
                          whiteSpace: "nowrap"
                        },
                        children: label
                      }
                    )
                  ] }),
                  description && /* @__PURE__ */ jsx2(
                    "span",
                    {
                      style: {
                        fontSize: 8,
                        fontWeight: 400,
                        color: textColor,
                        opacity: 0.7,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 100
                      },
                      children: description
                    }
                  ),
                  showStageId && stageId && /* @__PURE__ */ jsx2(
                    "span",
                    {
                      style: {
                        fontSize: 8,
                        fontFamily: "ui-monospace, monospace",
                        color: textColor,
                        opacity: 0.55,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 100
                      },
                      title: `stageId: ${stageId}`,
                      children: stageId
                    }
                  )
                ]
              }
            )
          ] }) : (
            /* Standard rectangular node */
            /* @__PURE__ */ jsxs(
              "div",
              {
                style: {
                  background: bg,
                  border: `${isHero ? "2.5px" : isMuted ? "1px" : "2px"} ${isLazyUnresolved ? "dashed" : "solid"} ${borderColor}`,
                  borderRadius: theme.radius,
                  padding: description ? `${Math.round(8 * sizeScale)}px ${Math.round(16 * sizeScale)}px` : `${Math.round(10 * sizeScale)}px ${Math.round(20 * sizeScale)}px`,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: description ? 2 : 0,
                  boxShadow: shadow,
                  transition: "all 0.3s ease",
                  fontFamily: theme.fontSans,
                  minWidth: 100,
                  justifyContent: "center"
                },
                children: [
                  /* @__PURE__ */ jsxs("div", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
                    effectiveIcon && /* @__PURE__ */ jsx2(StageIcon, { type: effectiveIcon, color: textColor }),
                    done && !effectiveIcon && /* @__PURE__ */ jsx2("span", { style: { fontSize: 10, color: textColor }, children: "\u2713" }),
                    active && !effectiveIcon && /* @__PURE__ */ jsx2(
                      "span",
                      {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#fff",
                          animation: "fp-blink 1s ease-in-out infinite",
                          flexShrink: 0
                        }
                      }
                    ),
                    error && !effectiveIcon && /* @__PURE__ */ jsx2("span", { style: { fontSize: 10, color: textColor }, children: "\u2717" }),
                    /* @__PURE__ */ jsx2(
                      "span",
                      {
                        style: {
                          fontSize: Math.round(13 * sizeScale),
                          fontWeight: isHero ? 700 : 500,
                          color: textColor,
                          whiteSpace: "nowrap"
                        },
                        children: label
                      }
                    ),
                    isSubflow && /* @__PURE__ */ jsx2(
                      "span",
                      {
                        style: {
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 16,
                          height: 16,
                          borderRadius: 3,
                          border: `1.5px solid ${textColor}`,
                          position: "relative",
                          opacity: 0.7,
                          flexShrink: 0
                        },
                        children: /* @__PURE__ */ jsx2(
                          "span",
                          {
                            style: {
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              border: `1px solid ${textColor}`
                            }
                          }
                        )
                      }
                    )
                  ] }),
                  description && /* @__PURE__ */ jsx2(
                    "span",
                    {
                      style: {
                        fontSize: 10,
                        fontWeight: 400,
                        color: textColor,
                        opacity: 0.7,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 160
                      },
                      children: description
                    }
                  ),
                  showStageId && stageId && /* @__PURE__ */ jsx2(
                    "span",
                    {
                      style: {
                        fontSize: 9,
                        fontFamily: "ui-monospace, monospace",
                        color: textColor,
                        opacity: 0.55,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 160
                      },
                      title: `stageId: ${stageId}`,
                      children: stageId
                    }
                  )
                ]
              }
            )
          )
        ]
      }
    ) }),
    /* @__PURE__ */ jsx2(Handle, { type: "source", position: Position.Bottom, style: { opacity: 0 } })
  ] });
});

// src/components/TimeTravelDebugger/TimeTravelDebugger.tsx
import { useState as useState5 } from "react";

// src/components/MemoryInspector/MemoryInspector.tsx
import { useMemo, useRef as useRef2 } from "react";
import { jsx as jsx3, jsxs as jsxs2 } from "react/jsx-runtime";
function MemoryInspector({
  data,
  snapshots,
  selectedIndex = 0,
  showTypes = false,
  highlightNew = true,
  size = "default",
  unstyled = false,
  className,
  style
}) {
  const cacheRef = useRef2(null);
  const { memory, newKeys } = useMemo(() => {
    if (data) {
      return { memory: data, newKeys: /* @__PURE__ */ new Set() };
    }
    if (!snapshots || snapshots.length === 0) {
      return { memory: {}, newKeys: /* @__PURE__ */ new Set() };
    }
    const safeIdx = Math.min(selectedIndex, snapshots.length - 1);
    let merged;
    const cache = cacheRef.current;
    if (cache && cache.snapshots === snapshots && cache.index <= safeIdx) {
      merged = { ...cache.accumulated };
      for (let i = cache.index + 1; i <= safeIdx; i++) {
        Object.assign(merged, snapshots[i]?.memory);
      }
    } else {
      merged = {};
      for (let i = 0; i <= safeIdx; i++) {
        Object.assign(merged, snapshots[i]?.memory);
      }
    }
    cacheRef.current = { snapshots, index: safeIdx, accumulated: merged };
    const nk = /* @__PURE__ */ new Set();
    if (highlightNew && safeIdx > 0) {
      let prev;
      if (cache && cache.snapshots === snapshots && cache.index === safeIdx - 1) {
        prev = cache.accumulated;
      } else {
        prev = {};
        for (let i = 0; i < safeIdx; i++) {
          Object.assign(prev, snapshots[i]?.memory);
        }
      }
      const current = snapshots[safeIdx]?.memory ?? {};
      for (const k of Object.keys(current)) {
        if (!(k in prev)) nk.add(k);
      }
    } else if (highlightNew && safeIdx === 0 && snapshots[0]) {
      for (const k of Object.keys(snapshots[0].memory)) nk.add(k);
    }
    return { memory: merged, newKeys: nk };
  }, [data, snapshots, selectedIndex, highlightNew]);
  const entries = Object.entries(memory);
  const fs = fontSize[size];
  const pad = padding[size];
  if (unstyled) {
    return /* @__PURE__ */ jsxs2("div", { className, style, "data-fp": "memory-inspector", role: "region", "aria-label": "Memory state", children: [
      /* @__PURE__ */ jsx3("div", { "data-fp": "memory-label", children: "Memory State" }),
      /* @__PURE__ */ jsx3("pre", { "data-fp": "memory-json", children: /* @__PURE__ */ jsx3("code", { children: JSON.stringify(memory, null, 2) }) })
    ] });
  }
  return /* @__PURE__ */ jsxs2(
    "div",
    {
      className,
      style: {
        padding: pad,
        fontFamily: theme.fontSans,
        ...style
      },
      "data-fp": "memory-inspector",
      role: "region",
      "aria-label": "Memory state",
      children: [
        /* @__PURE__ */ jsx3(
          "span",
          {
            style: {
              fontSize: fs.label,
              fontWeight: 600,
              color: theme.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.08em"
            },
            children: "Memory State"
          }
        ),
        /* @__PURE__ */ jsxs2(
          "div",
          {
            style: {
              marginTop: 8,
              background: theme.bgSecondary,
              border: `1px solid ${theme.border}`,
              borderRadius: theme.radius,
              padding: `${pad}px ${pad + 4}px`,
              fontFamily: theme.fontMono,
              fontSize: fs.body,
              lineHeight: 1.8
            },
            children: [
              /* @__PURE__ */ jsx3("span", { style: { color: theme.textMuted }, children: "{" }),
              entries.length === 0 && /* @__PURE__ */ jsx3(
                "div",
                {
                  style: {
                    paddingLeft: 16,
                    color: theme.textMuted,
                    fontStyle: "italic"
                  },
                  children: "// empty"
                }
              ),
              entries.map(([key, value], i) => {
                const isNew = newKeys.has(key);
                const isLast = i === entries.length - 1;
                return /* @__PURE__ */ jsxs2(
                  "div",
                  {
                    style: {
                      paddingLeft: 16,
                      background: isNew ? `color-mix(in srgb, ${theme.success} 10%, transparent)` : "transparent",
                      borderRadius: 4,
                      marginLeft: -4,
                      marginRight: -4,
                      paddingRight: 4
                    },
                    children: [
                      /* @__PURE__ */ jsxs2("span", { style: { color: theme.primary }, children: [
                        '"',
                        key,
                        '"'
                      ] }),
                      /* @__PURE__ */ jsx3("span", { style: { color: theme.textMuted }, children: ": " }),
                      /* @__PURE__ */ jsx3("span", { style: { color: theme.success }, children: formatValue(value) }),
                      showTypes && /* @__PURE__ */ jsxs2(
                        "span",
                        {
                          style: {
                            color: theme.textMuted,
                            fontSize: fs.small,
                            marginLeft: 8,
                            opacity: 0.6
                          },
                          children: [
                            "(",
                            typeof value,
                            ")"
                          ]
                        }
                      ),
                      !isLast && /* @__PURE__ */ jsx3("span", { style: { color: theme.textMuted }, children: "," })
                    ]
                  },
                  key
                );
              }),
              /* @__PURE__ */ jsx3("span", { style: { color: theme.textMuted }, children: "}" })
            ]
          }
        )
      ]
    }
  );
}
function formatValue(value) {
  if (typeof value === "string") return `"${value}"`;
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

// src/components/NarrativeLog/NarrativeLog.tsx
import { useMemo as useMemo2 } from "react";
import { jsx as jsx4, jsxs as jsxs3 } from "react/jsx-runtime";
function NarrativeLog({
  snapshots,
  selectedIndex,
  narrative,
  size = "default",
  unstyled = false,
  className,
  style
}) {
  const entries = useMemo2(() => {
    if (narrative) {
      return [{ label: "Output", text: narrative, isCurrent: true }];
    }
    const idx = selectedIndex ?? snapshots.length - 1;
    return snapshots.slice(0, idx + 1).map((s, i) => ({
      label: s.stageLabel,
      text: s.narrative,
      isCurrent: i === idx
    }));
  }, [snapshots, selectedIndex, narrative]);
  const fs = fontSize[size];
  const pad = padding[size];
  if (unstyled) {
    return /* @__PURE__ */ jsx4("div", { className, style, "data-fp": "narrative-log", children: entries.map((entry, i) => /* @__PURE__ */ jsxs3("div", { "data-fp": "narrative-entry", "data-current": entry.isCurrent, children: [
      /* @__PURE__ */ jsx4("strong", { children: entry.label }),
      /* @__PURE__ */ jsx4("p", { children: entry.text })
    ] }, i)) });
  }
  return /* @__PURE__ */ jsxs3(
    "div",
    {
      className,
      style: { padding: pad, fontFamily: theme.fontSans, ...style },
      "data-fp": "narrative-log",
      children: [
        /* @__PURE__ */ jsx4(
          "span",
          {
            style: {
              fontSize: fs.label,
              fontWeight: 600,
              color: theme.textMuted,
              textTransform: "uppercase",
              letterSpacing: "0.08em"
            },
            children: "Execution Log"
          }
        ),
        /* @__PURE__ */ jsx4("div", { style: { marginTop: 8, display: "flex", flexDirection: "column" }, children: entries.map((entry, i) => /* @__PURE__ */ jsxs3(
          "div",
          {
            style: {
              display: "flex",
              gap: 10,
              padding: `${pad}px 0`,
              borderBottom: i < entries.length - 1 ? `1px solid ${theme.border}` : "none"
            },
            children: [
              /* @__PURE__ */ jsxs3(
                "div",
                {
                  style: {
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    width: 12,
                    flexShrink: 0,
                    paddingTop: 5
                  },
                  children: [
                    /* @__PURE__ */ jsx4(
                      "div",
                      {
                        style: {
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: entry.isCurrent ? theme.primary : theme.success,
                          flexShrink: 0
                        }
                      }
                    ),
                    i < entries.length - 1 && /* @__PURE__ */ jsx4(
                      "div",
                      {
                        style: {
                          width: 1,
                          flex: 1,
                          background: theme.border,
                          marginTop: 4
                        }
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ jsxs3("div", { style: { flex: 1, minWidth: 0 }, children: [
                /* @__PURE__ */ jsx4(
                  "span",
                  {
                    style: {
                      fontSize: fs.label,
                      fontWeight: 600,
                      color: entry.isCurrent ? theme.primary : theme.textMuted
                    },
                    children: entry.label
                  }
                ),
                /* @__PURE__ */ jsx4(
                  "div",
                  {
                    style: {
                      fontSize: fs.body,
                      lineHeight: 1.5,
                      color: entry.isCurrent ? theme.textPrimary : theme.textSecondary,
                      marginTop: 2
                    },
                    children: entry.text
                  }
                )
              ] })
            ]
          },
          i
        )) })
      ]
    }
  );
}

// src/components/GanttTimeline/GanttTimeline.tsx
import { useState as useState2, useMemo as useMemo3, useRef as useRef3, useEffect as useEffect3 } from "react";
import { jsx as jsx5, jsxs as jsxs4 } from "react/jsx-runtime";
function GanttTimeline({
  snapshots,
  selectedIndex = 0,
  onSelect,
  size = "default",
  unstyled = false,
  className,
  style,
  maxVisibleRows = 5
}) {
  const [expanded, setExpanded] = useState2(false);
  const activeRowRef = useRef3(null);
  const scrollContainerRef = useRef3(null);
  const totalWallTime = useMemo3(
    () => Math.max(...snapshots.map((s) => s.startMs + s.durationMs), 1),
    [snapshots]
  );
  const fs = fontSize[size];
  const pad = padding[size];
  const labelWidth = size === "compact" ? 50 : size === "detailed" ? 100 : 80;
  const msWidth = size === "compact" ? 28 : 36;
  const rowHeight = size === "compact" ? 18 : 22;
  const collapsible = maxVisibleRows > 0 && snapshots.length > maxVisibleRows;
  const showAll = expanded || !collapsible;
  useEffect3(() => {
    if (!showAll && activeRowRef.current && scrollContainerRef.current) {
      activeRowRef.current.scrollIntoView({
        block: "nearest",
        behavior: "smooth"
      });
    }
  }, [selectedIndex, showAll]);
  if (unstyled) {
    return /* @__PURE__ */ jsx5("div", { className, style, "data-fp": "gantt-timeline", role: "listbox", "aria-label": "Execution timeline", children: snapshots.map((snap, idx) => /* @__PURE__ */ jsxs4(
      "div",
      {
        "data-fp": "gantt-bar",
        "data-selected": idx === selectedIndex,
        "data-visible": idx <= selectedIndex,
        role: "option",
        "aria-selected": idx === selectedIndex,
        "aria-label": `${snap.stageLabel}, ${snap.durationMs}ms`,
        onClick: () => onSelect?.(idx),
        children: [
          /* @__PURE__ */ jsx5("span", { "data-fp": "gantt-label", children: snap.stageLabel }),
          /* @__PURE__ */ jsxs4("span", { "data-fp": "gantt-duration", children: [
            snap.durationMs,
            "ms"
          ] })
        ]
      },
      `${snap.stageName}-${idx}`
    )) });
  }
  return /* @__PURE__ */ jsxs4(
    "div",
    {
      className,
      style: { padding: pad, fontFamily: theme.fontSans, ...style },
      "data-fp": "gantt-timeline",
      children: [
        /* @__PURE__ */ jsxs4(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between"
            },
            children: [
              /* @__PURE__ */ jsx5(
                "span",
                {
                  style: {
                    fontSize: fs.label,
                    fontWeight: 600,
                    color: theme.textMuted,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em"
                  },
                  children: size === "compact" ? "Timeline" : "Execution Timeline"
                }
              ),
              collapsible && /* @__PURE__ */ jsx5(
                "button",
                {
                  onClick: () => setExpanded((e) => !e),
                  style: {
                    background: "none",
                    border: `1px solid ${theme.border}`,
                    borderRadius: 4,
                    color: theme.textSecondary,
                    fontSize: fs.small,
                    padding: "2px 8px",
                    cursor: "pointer",
                    fontFamily: theme.fontSans
                  },
                  children: expanded ? "Collapse" : `${snapshots.length - maxVisibleRows} more...`
                }
              )
            ]
          }
        ),
        /* @__PURE__ */ jsx5(
          "div",
          {
            ref: scrollContainerRef,
            role: "listbox",
            "aria-label": "Execution timeline",
            style: {
              marginTop: 8,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              ...showAll ? {} : {
                maxHeight: maxVisibleRows * (rowHeight + 4),
                overflowY: "auto",
                scrollbarWidth: "thin"
              }
            },
            children: snapshots.map((snap, idx) => {
              const leftPct = snap.startMs / totalWallTime * 100;
              const widthPct = Math.max(snap.durationMs / totalWallTime * 100, 1);
              const isSelected = idx === selectedIndex;
              const isVisible = idx <= selectedIndex;
              return /* @__PURE__ */ jsxs4(
                "div",
                {
                  ref: isSelected ? activeRowRef : void 0,
                  role: "option",
                  "aria-selected": isSelected,
                  "aria-label": `${snap.stageLabel}, ${snap.durationMs}ms`,
                  onClick: () => onSelect?.(idx),
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: size === "compact" ? 4 : 8,
                    cursor: onSelect ? "pointer" : "default",
                    opacity: isVisible ? 1 : 0.3,
                    transition: "opacity 0.3s ease",
                    height: rowHeight,
                    flexShrink: 0
                  },
                  children: [
                    /* @__PURE__ */ jsx5(
                      "span",
                      {
                        title: snap.stageLabel,
                        style: {
                          width: labelWidth,
                          fontSize: fs.small,
                          color: isSelected ? theme.primary : theme.textMuted,
                          fontWeight: isSelected ? 600 : 400,
                          textAlign: "right",
                          flexShrink: 0,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap"
                        },
                        children: snap.stageLabel
                      }
                    ),
                    /* @__PURE__ */ jsx5(
                      "div",
                      {
                        style: {
                          flex: 1,
                          height: size === "compact" ? 6 : 8,
                          position: "relative",
                          background: theme.bgTertiary,
                          borderRadius: 3
                        },
                        children: isVisible && /* @__PURE__ */ jsx5(
                          "div",
                          {
                            style: {
                              position: "absolute",
                              left: `${leftPct}%`,
                              top: 0,
                              width: `${widthPct}%`,
                              height: "100%",
                              borderRadius: 3,
                              background: isSelected ? theme.primary : theme.success,
                              transition: "width 0.3s ease"
                            }
                          }
                        )
                      }
                    ),
                    /* @__PURE__ */ jsxs4(
                      "span",
                      {
                        style: {
                          fontSize: fs.small,
                          color: theme.textMuted,
                          fontFamily: theme.fontMono,
                          width: msWidth,
                          flexShrink: 0
                        },
                        children: [
                          snap.durationMs,
                          "ms"
                        ]
                      }
                    )
                  ]
                },
                `${snap.stageName}-${idx}`
              );
            })
          }
        ),
        /* @__PURE__ */ jsxs4(
          "div",
          {
            style: {
              marginTop: 4,
              marginLeft: labelWidth + (size === "compact" ? 4 : 8),
              marginRight: msWidth + (size === "compact" ? 4 : 8),
              display: "flex",
              justifyContent: "space-between",
              fontSize: fs.small - 1,
              color: theme.textMuted,
              fontFamily: theme.fontMono
            },
            children: [
              /* @__PURE__ */ jsx5("span", { children: "0ms" }),
              size !== "compact" && /* @__PURE__ */ jsxs4("span", { children: [
                (totalWallTime / 2).toFixed(1),
                "ms"
              ] }),
              /* @__PURE__ */ jsxs4("span", { children: [
                totalWallTime.toFixed(1),
                "ms"
              ] })
            ]
          }
        )
      ]
    }
  );
}

// src/components/FlowchartView/TraceFlow.tsx
import { useMemo as useMemo4, useCallback, useSyncExternalStore } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  MarkerType
} from "@xyflow/react";

// src/components/LoopBackEdge/LoopBackEdge.tsx
import { BaseEdge, useStore } from "@xyflow/react";

// src/components/FlowchartView/_internal/loopRouting.ts
var LOOP_LANE_GAP = 56;
function loopLaneX(contentRights, gap = LOOP_LANE_GAP) {
  let max = -Infinity;
  for (const r of contentRights) if (r > max) max = r;
  if (!Number.isFinite(max)) max = 0;
  return max + gap;
}
function loopBackPath(source, target, laneX, radius = 22) {
  const { right: sx, centerY: sy } = source;
  const { right: tx, centerY: ty } = target;
  const r = Math.max(
    0,
    Math.min(radius, Math.abs(sy - ty) / 2, laneX - sx, laneX - tx)
  );
  const up = ty <= sy;
  const vy1 = up ? sy - r : sy + r;
  const vy2 = up ? ty + r : ty - r;
  return [
    `M ${sx},${sy}`,
    `L ${laneX - r},${sy}`,
    `Q ${laneX},${sy} ${laneX},${vy1}`,
    `L ${laneX},${vy2}`,
    `Q ${laneX},${ty} ${laneX - r},${ty}`,
    `L ${tx},${ty}`
  ].join(" ");
}

// src/components/FlowchartView/_internal/groupLayout.ts
var GROUP_CONTAINER_NODE_TYPE = "groupContainer";
var DEFAULT_PADDING = 16;
var DEFAULT_HEADER = 44;
var DEFAULT_NODE_W = 200;
var DEFAULT_NODE_H = 80;
function footprintOf(node, fallbackW, fallbackH) {
  const style = node.style ?? {};
  const w = typeof style.width === "number" ? style.width : fallbackW;
  const h = typeof style.height === "number" ? style.height : fallbackH;
  return { width: w, height: h };
}
function applyGroupLayout(graph, opts) {
  const padding2 = opts.padding ?? DEFAULT_PADDING;
  const headerHeight = opts.headerHeight ?? DEFAULT_HEADER;
  const nodeW = opts.nodeWidth ?? DEFAULT_NODE_W;
  const nodeH = opts.nodeHeight ?? DEFAULT_NODE_H;
  const baseLayout = opts.baseLayout;
  const requested = new Set(opts.groupedSubflowIds);
  const membersBySubflow = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) {
    const of = n.data?.subflowOf;
    if (of !== void 0 && requested.has(of)) {
      const arr = membersBySubflow.get(of) ?? [];
      arr.push(n);
      membersBySubflow.set(of, arr);
    }
  }
  const mountBySubflow = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) {
    const sfId = n.data?.subflowId;
    if (n.data?.isSubflow && sfId !== void 0 && requested.has(sfId) && membersBySubflow.has(sfId)) {
      mountBySubflow.set(sfId, n);
    }
  }
  const activeGroups = /* @__PURE__ */ new Set();
  for (const sfId of mountBySubflow.keys()) activeGroups.add(sfId);
  if (activeGroups.size === 0) {
    return graph;
  }
  const memberIds = /* @__PURE__ */ new Set();
  for (const sfId of activeGroups) {
    for (const m of membersBySubflow.get(sfId) ?? []) memberIds.add(m.id);
  }
  const containerNodes = [];
  const nestedMembers = [];
  const groupBox = /* @__PURE__ */ new Map();
  for (const sfId of activeGroups) {
    const members = membersBySubflow.get(sfId);
    const innerOnlyEdges = graph.edges.filter((e) => {
      const s = members.some((m) => m.id === e.source);
      const t = members.some((m) => m.id === e.target);
      return s && t;
    });
    const innerPositioned = baseLayout({ nodes: members, edges: innerOnlyEdges });
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of innerPositioned.nodes) {
      const p = m.position;
      const { width, height } = footprintOf(m, nodeW, nodeH);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x + width > maxX) maxX = p.x + width;
      if (p.y + height > maxY) maxY = p.y + height;
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    const boxWidth = maxX - minX + padding2 * 2;
    const boxHeight = maxY - minY + headerHeight + padding2 * 2;
    groupBox.set(sfId, { width: boxWidth, height: boxHeight, minX, minY, members: innerPositioned.nodes });
  }
  const outerNodes = graph.nodes.filter((n) => !memberIds.has(n.id)).map((n) => {
    const box = n.data?.subflowId ? groupBox.get(n.data.subflowId) : void 0;
    return box ? {
      ...n,
      style: { ...n.style ?? {}, width: box.width, height: box.height },
      data: { ...n.data, isGroupContainer: true }
    } : n;
  });
  const outerEdges = graph.edges.filter(
    (e) => !memberIds.has(e.source) && !memberIds.has(e.target)
  );
  const outerPositioned = baseLayout({ nodes: outerNodes, edges: outerEdges });
  const outerPosById = new Map(outerPositioned.nodes.map((n) => [n.id, n.position]));
  for (const sfId of activeGroups) {
    const mount = mountBySubflow.get(sfId);
    const box = groupBox.get(sfId);
    const { width: boxWidth, height: boxHeight, minX, minY } = box;
    const mountPos = outerPosById.get(mount.id) ?? mount.position ?? { x: 0, y: 0 };
    containerNodes.push({
      ...mount,
      type: GROUP_CONTAINER_NODE_TYPE,
      position: mountPos,
      style: { ...mount.style ?? {}, width: boxWidth, height: boxHeight },
      data: { ...mount.data, isGroupContainer: true }
    });
    for (const m of box.members) {
      const relX = m.position.x - minX + padding2;
      const relY = m.position.y - minY + headerHeight + padding2;
      nestedMembers.push({
        ...m,
        parentId: mount.id,
        extent: "parent",
        position: { x: relX, y: relY }
      });
    }
  }
  const containerById = new Map(containerNodes.map((c) => [c.id, c]));
  const outerOut = outerPositioned.nodes.map(
    (n) => containerById.get(n.id) ?? n
  );
  return {
    nodes: [...outerOut, ...nestedMembers],
    edges: graph.edges
  };
}
function createGroupedLayout(opts) {
  return (graph) => applyGroupLayout(graph, opts);
}
var MAIN_CHART_BOX_ID = "__main_chart__";
function wrapInMainChartBox(graph, opts) {
  if (graph.nodes.length === 0) return graph;
  const padding2 = opts.padding ?? DEFAULT_PADDING;
  const headerHeight = opts.headerHeight ?? DEFAULT_HEADER;
  const nodeW = opts.nodeWidth ?? DEFAULT_NODE_W;
  const nodeH = opts.nodeHeight ?? DEFAULT_NODE_H;
  const mainId = opts.id ?? MAIN_CHART_BOX_ID;
  const positioned = opts.baseLayout(graph);
  const topLevel = positioned.nodes.filter((n) => n.parentId === void 0);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of topLevel) {
    const p = n.position;
    const { width, height } = footprintOf(n, nodeW, nodeH);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x + width > maxX) maxX = p.x + width;
    if (p.y + height > maxY) maxY = p.y + height;
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 0;
    maxY = 0;
  }
  const hasLoopEdge = graph.edges.some((e) => e.data?.kind === "loop");
  const loopReserve = hasLoopEdge ? LOOP_LANE_GAP : 0;
  const boxWidth = maxX - minX + padding2 * 2 + loopReserve;
  const boxHeight = maxY - minY + headerHeight + padding2 * 2;
  const container = {
    id: mainId,
    type: GROUP_CONTAINER_NODE_TYPE,
    position: { x: 0, y: 0 },
    style: { width: boxWidth, height: boxHeight },
    data: {
      label: opts.label ?? "Chart",
      isDecider: false,
      isFork: false,
      isStreaming: false,
      isSubflow: false,
      isGroupContainer: true,
      isMainChart: true,
      ...opts.kind !== void 0 && { kind: opts.kind },
      prevIds: [],
      nextIds: []
    }
  };
  const topLevelIds = new Set(topLevel.map((n) => n.id));
  const reparented = positioned.nodes.map((n) => {
    if (!topLevelIds.has(n.id)) return n;
    return {
      ...n,
      parentId: mainId,
      extent: "parent",
      position: {
        x: n.position.x - minX + padding2,
        y: n.position.y - minY + headerHeight + padding2
      }
    };
  });
  return { nodes: [container, ...reparented], edges: graph.edges };
}
function createMainChartBoxLayout(opts) {
  return (graph) => wrapInMainChartBox(graph, opts);
}

// src/components/LoopBackEdge/LoopBackEdge.tsx
import { jsx as jsx6 } from "react/jsx-runtime";
var LOOP_DASH = "5 5";
var LOOP_STROKE_OPACITY_CAP = 0.55;
var LOOP_STROKE_WIDTH = 1.5;
function softenLoopStyle(style) {
  const passedStrokeOpacity = typeof style?.strokeOpacity === "number" ? style.strokeOpacity : 1;
  return {
    ...style,
    strokeDasharray: style?.strokeDasharray ?? LOOP_DASH,
    strokeOpacity: Math.min(passedStrokeOpacity, LOOP_STROKE_OPACITY_CAP),
    strokeWidth: LOOP_STROKE_WIDTH
  };
}
var LOOP_CORNER_RADIUS = 28;
function rightEdge(node) {
  return node.internals.positionAbsolute.x + (node.measured.width ?? 0);
}
function centerY(node) {
  return node.internals.positionAbsolute.y + (node.measured.height ?? 0) / 2;
}
function LoopBackEdge({ id, source, target, markerEnd, style }) {
  const path = useStore((s) => {
    const src = s.nodeLookup.get(source);
    const tgt = s.nodeLookup.get(target);
    if (!src || !tgt) return "";
    const contentRights = [];
    for (const n of s.nodeLookup.values()) {
      if (n.type === GROUP_CONTAINER_NODE_TYPE) continue;
      contentRights.push(rightEdge(n));
    }
    const laneX = loopLaneX([...contentRights, rightEdge(src), rightEdge(tgt)], LOOP_LANE_GAP);
    return loopBackPath(
      { right: rightEdge(src), centerY: centerY(src) },
      { right: rightEdge(tgt), centerY: centerY(tgt) },
      laneX,
      LOOP_CORNER_RADIUS
    );
  });
  if (!path) return null;
  return /* @__PURE__ */ jsx6(
    BaseEdge,
    {
      id,
      path,
      markerEnd,
      style: softenLoopStyle(style),
      "aria-label": "Loop back"
    }
  );
}

// src/components/SmartStepEdge/SmartStepEdge.tsx
import { BaseEdge as BaseEdge2, getSmoothStepPath, useStore as useStore2 } from "@xyflow/react";
import { Position as Position2 } from "@xyflow/react";

// src/components/FlowchartView/_internal/stepRouting.ts
function staggeredBendY(sourceBottom, targetTop, others, minGapFromTarget = 8) {
  let lowestSkippedBottom = -Infinity;
  for (const n of others) {
    const cy = (n.top + n.bottom) / 2;
    if (cy > sourceBottom && cy < targetTop && n.bottom > lowestSkippedBottom) {
      lowestSkippedBottom = n.bottom;
    }
  }
  if (lowestSkippedBottom === -Infinity) return null;
  return Math.min((lowestSkippedBottom + targetTop) / 2, targetTop - minGapFromTarget);
}

// src/components/SmartStepEdge/SmartStepEdge.tsx
import { jsx as jsx7 } from "react/jsx-runtime";
function SmartStepEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style
}) {
  const bendY = useStore2((s) => {
    const src = s.nodeLookup.get(source);
    const tgt = s.nodeLookup.get(target);
    if (!src || !tgt) return null;
    const sourceBottom = src.internals.positionAbsolute.y + (src.measured.height ?? 0);
    const targetTop = tgt.internals.positionAbsolute.y;
    const others = [];
    for (const n of s.nodeLookup.values()) {
      if (n.id === source || n.id === target) continue;
      if (n.type === GROUP_CONTAINER_NODE_TYPE) continue;
      const top = n.internals.positionAbsolute.y;
      others.push({ top, bottom: top + (n.measured.height ?? 0) });
    }
    return staggeredBendY(sourceBottom, targetTop, others);
  });
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition: sourcePosition ?? Position2.Bottom,
    targetX,
    targetY,
    targetPosition: targetPosition ?? Position2.Top,
    // Override the bend only for a staggered edge; otherwise let getSmoothStepPath
    // use its default centerY (== the built-in `smoothstep` path, byte-for-byte).
    ...bendY !== null ? { centerY: bendY } : {}
  });
  return /* @__PURE__ */ jsx7(BaseEdge2, { id, path, markerEnd, style });
}

// src/components/FlowchartView/_internal/dagreTraceLayout.ts
import dagre from "dagre";
var DEFAULT_NODE_W2 = 200;
var DEFAULT_NODE_H2 = 80;
function sizeOf(node, fallbackW, fallbackH, resolver) {
  const style = node.style ?? {};
  const styleW = typeof style.width === "number" ? style.width : void 0;
  const styleH = typeof style.height === "number" ? style.height : void 0;
  if (node.data?.isGroupContainer && styleW !== void 0 && styleH !== void 0) {
    return { width: styleW, height: styleH };
  }
  const resolved = resolver?.(node);
  if (resolved) return { width: resolved.width, height: resolved.height };
  return {
    width: styleW ?? fallbackW,
    height: styleH ?? fallbackH
  };
}
function reorderSiblingEdges(edges, siblingOrder) {
  const bySource = /* @__PURE__ */ new Map();
  for (const e of edges) {
    if (e.data?.kind === "loop") continue;
    const arr = bySource.get(e.source);
    if (arr) arr.push(e);
    else bySource.set(e.source, [e]);
  }
  const out = [];
  for (const [src, group] of bySource) {
    if (group.length < 2) {
      out.push(...group);
      continue;
    }
    const ordered = siblingOrder(src, group.map((e) => e.target));
    const byTarget = new Map(group.map((e) => [e.target, e]));
    const used = /* @__PURE__ */ new Set();
    for (const t of ordered) {
      const e = byTarget.get(t);
      if (e && !used.has(t)) {
        out.push(e);
        used.add(t);
      }
    }
    for (const e of group) if (!used.has(e.target)) out.push(e);
  }
  return out;
}
function dagreTraceLayout(graph, options = {}) {
  if (graph.nodes.length === 0) return graph;
  const direction = options.direction ?? "TB";
  const rankSep = options.rankSep ?? 80;
  const nodeSep = options.nodeSep ?? 60;
  const edgeSep = options.edgeSep ?? 20;
  const fallbackW = options.nodeWidth ?? DEFAULT_NODE_W2;
  const fallbackH = options.nodeHeight ?? DEFAULT_NODE_H2;
  const g = new dagre.graphlib.Graph({ compound: true });
  g.setGraph({ rankdir: direction, ranksep: rankSep, nodesep: nodeSep, edgesep: edgeSep });
  g.setDefaultEdgeLabel(() => ({}));
  const sizes = /* @__PURE__ */ new Map();
  const resolvedStyleSizes = /* @__PURE__ */ new Map();
  for (const node of graph.nodes) {
    const resolved = options.nodeSize?.(node);
    const size = sizeOf(node, fallbackW, fallbackH, options.nodeSize);
    sizes.set(node.id, size);
    if (resolved && resolved.width === size.width && resolved.height === size.height) {
      resolvedStyleSizes.set(node.id, resolved);
    }
    g.setNode(node.id, { width: size.width, height: size.height });
    if (node.parentId) {
      g.setParent(node.id, node.parentId);
    }
  }
  const layoutEdges = options.siblingOrder ? reorderSiblingEdges(graph.edges, options.siblingOrder) : graph.edges;
  for (const e of layoutEdges) {
    if (e.data?.kind === "loop") continue;
    if (g.hasNode(e.source) && g.hasNode(e.target)) {
      const label = {};
      const weight = options.edgeWeight?.(e);
      const minlen = options.edgeMinLen?.(e);
      if (typeof weight === "number") label.weight = weight;
      if (typeof minlen === "number") label.minlen = minlen;
      g.setEdge(e.source, e.target, label);
    }
  }
  dagre.layout(g);
  const positioned = graph.nodes.map((node) => {
    const laidOut = g.node(node.id);
    if (!laidOut) return node;
    const size = sizes.get(node.id);
    let x = laidOut.x - size.width / 2;
    let y = laidOut.y - size.height / 2;
    if (node.parentId) {
      const parent = g.node(node.parentId);
      const parentSize = sizes.get(node.parentId);
      if (parent && parentSize) {
        x -= parent.x - parentSize.width / 2;
        y -= parent.y - parentSize.height / 2;
      }
    }
    const styleSize = resolvedStyleSizes.get(node.id);
    if (styleSize) {
      return {
        ...node,
        position: { x, y },
        style: { ...node.style ?? {}, width: styleSize.width, height: styleSize.height }
      };
    }
    return { ...node, position: { x, y } };
  });
  return { nodes: positioned, edges: graph.edges };
}
function createDagreTraceLayout(options = {}) {
  return (graph) => dagreTraceLayout(graph, options);
}

// src/components/FlowchartView/TraceFlow.tsx
import { jsx as jsx8, jsxs as jsxs5 } from "react/jsx-runtime";
var Y_STEP = 100;
var X_SPREAD = 200;
var defaultTraceFlowLayout = (graph) => {
  if (graph.nodes.length === 0) return { nodes: [], edges: graph.edges };
  const branchChildrenOf = /* @__PURE__ */ new Map();
  const nextChildrenOf = /* @__PURE__ */ new Map();
  const hasIncomingForward = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    const kind = e.data?.kind;
    if (kind === "loop") continue;
    hasIncomingForward.add(e.target);
    if (kind === "fork-branch" || kind === "decision-branch") {
      const arr = branchChildrenOf.get(e.source) ?? [];
      arr.push(e.target);
      branchChildrenOf.set(e.source, arr);
    } else {
      const arr = nextChildrenOf.get(e.source) ?? [];
      arr.push(e.target);
      nextChildrenOf.set(e.source, arr);
    }
  }
  const seed = graph.nodes.find((n) => !hasIncomingForward.has(n.id)) ?? graph.nodes[0];
  const positions = /* @__PURE__ */ new Map();
  function layoutSubtree(nodeId, x, y) {
    if (positions.has(nodeId)) {
      return positions.get(nodeId).y;
    }
    positions.set(nodeId, { x, y });
    let deepestBranchY = y;
    const branches = branchChildrenOf.get(nodeId) ?? [];
    if (branches.length > 0) {
      const childY = y + Y_STEP;
      const totalWidth = (branches.length - 1) * X_SPREAD;
      const startX = x - totalWidth / 2;
      for (let i = 0; i < branches.length; i++) {
        const childId = branches[i];
        const childX = startX + i * X_SPREAD;
        const subtreeBottom = layoutSubtree(childId, childX, childY);
        if (subtreeBottom > deepestBranchY) deepestBranchY = subtreeBottom;
      }
    }
    const nextChildren = nextChildrenOf.get(nodeId) ?? [];
    if (nextChildren.length > 0) {
      const nextY = branches.length > 0 ? deepestBranchY + Y_STEP : y + Y_STEP;
      const totalWidth = (nextChildren.length - 1) * X_SPREAD;
      const startX = x - totalWidth / 2;
      let deepestNextY = nextY;
      for (let i = 0; i < nextChildren.length; i++) {
        const childId = nextChildren[i];
        const childX = startX + i * X_SPREAD;
        const subtreeBottom = layoutSubtree(childId, childX, nextY);
        if (subtreeBottom > deepestNextY) deepestNextY = subtreeBottom;
      }
      return deepestNextY;
    }
    return deepestBranchY;
  }
  layoutSubtree(seed.id, 0, 0);
  let maxY = 0;
  for (const p of positions.values()) {
    if (p.y > maxY) maxY = p.y;
  }
  let orphanY = maxY + Y_STEP;
  for (const n of graph.nodes) {
    if (!positions.has(n.id)) {
      positions.set(n.id, { x: 0, y: orphanY });
      orphanY += Y_STEP;
    }
  }
  return {
    nodes: graph.nodes.map((n) => ({
      ...n,
      position: positions.get(n.id) ?? n.position
    })),
    edges: graph.edges
  };
};
var DEFAULT_EDGE_COLORS = {
  next: rawDefaults.colors.textMuted,
  forkBranch: rawDefaults.colors.textMuted,
  decisionBranch: rawDefaults.colors.primary,
  loop: rawDefaults.colors.warning
};
function styleEdge(edge, colors) {
  const kind = edge.data?.kind ?? "next";
  const color = kind === "loop" ? colors.loop : kind === "fork-branch" ? colors.forkBranch : kind === "decision-branch" ? colors.decisionBranch : colors.next;
  const styled = {
    ...edge,
    // Loop back-edges use the custom `loopBack` edge — a curve routed along the
    // right margin (clear of the spine) instead of a straight/step center line.
    // Every other edge uses `smartStep`: a smoothstep superset that routes a
    // RANK-SKIPPING edge around the node it skips (else identical to smoothstep).
    type: kind === "loop" ? "loopBack" : "smartStep",
    animated: false,
    style: { stroke: color, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }
  };
  if (kind === "loop") {
    styled.style = { ...styled.style, strokeDasharray: "4 3" };
  }
  return styled;
}
var DEFAULT_NODE_TYPES = { stageNode: StageNode };
var DEFAULT_EDGE_TYPES = { loopBack: LoopBackEdge, smartStep: SmartStepEdge };
function toStageNode(node) {
  if (node.type !== void 0 && node.type !== "stage") {
    return node;
  }
  const data = node.data;
  const stageData = {
    label: data.label,
    isDecider: data.isDecider,
    isFork: data.isFork,
    isSubflow: data.isSubflow,
    active: false,
    done: false,
    error: false,
    ...data.description !== void 0 && { description: data.description },
    ...data.icon !== void 0 && { icon: data.icon },
    ...data.subflowId !== void 0 && { subflowId: data.subflowId },
    ...data.isLazy === true && { isLazy: true },
    ...data.emphasis !== void 0 && { emphasis: data.emphasis },
    ...data.size !== void 0 && { size: data.size }
  };
  return {
    ...node,
    type: "stageNode",
    data: stageData
  };
}
var EMPTY_GRAPH = { nodes: [], edges: [] };
function subscribeToRecorder(recorder) {
  return (listener) => {
    if (!recorder) return () => {
    };
    return recorder.subscribe(listener);
  };
}
function getRecorderVersion(recorder) {
  return () => {
    if (!recorder) return 0;
    return recorder.version();
  };
}
function TraceFlow(props) {
  const proc = globalThis.process;
  const isDev = proc?.env?.NODE_ENV !== "production";
  if (isDev && !props.recorder && !props.graph) {
    console.warn(
      "[TraceFlow] neither `recorder` nor `graph` prop was provided \u2014 rendering an empty chart. Pass one of: <TraceFlow recorder={handle} /> OR <TraceFlow graph={{nodes, edges}} />."
    );
  }
  const layout = props.layout ?? dagreTraceLayout;
  const edgeColors = useMemo4(
    () => ({ ...DEFAULT_EDGE_COLORS, ...props.edgeColors ?? {} }),
    [props.edgeColors]
  );
  const subscribe = useMemo4(
    () => subscribeToRecorder(props.recorder),
    [props.recorder]
  );
  const getVersion = useMemo4(
    () => getRecorderVersion(props.recorder),
    [props.recorder]
  );
  const version = useSyncExternalStore(subscribe, getVersion, getVersion);
  const { recorder, graph: graphProp } = props;
  const graph = useMemo4(() => {
    if (recorder) return recorder.getGraph();
    if (graphProp) return graphProp;
    return EMPTY_GRAPH;
  }, [recorder, graphProp, version]);
  const positioned = useMemo4(() => {
    if (layout === "passthrough") return graph;
    return layout(graph);
  }, [graph, layout]);
  const reactFlowNodes = useMemo4(
    () => positioned.nodes.map(toStageNode),
    [positioned.nodes]
  );
  const reactFlowEdges = useMemo4(
    () => positioned.edges.map((e) => styleEdge(e, edgeColors)),
    [positioned.edges, edgeColors]
  );
  const onNodeClickRef = props.onNodeClick;
  const handleNodeClick = useCallback(
    (_, node) => {
      onNodeClickRef?.(node.id);
    },
    [onNodeClickRef]
  );
  const { nodeTypes: userNodeTypes, edgeTypes: userEdgeTypes } = props;
  const mergedNodeTypes = useMemo4(
    () => userNodeTypes ? { ...DEFAULT_NODE_TYPES, ...userNodeTypes } : DEFAULT_NODE_TYPES,
    [userNodeTypes]
  );
  const mergedEdgeTypes = useMemo4(
    () => userEdgeTypes ? { ...DEFAULT_EDGE_TYPES, ...userEdgeTypes } : DEFAULT_EDGE_TYPES,
    [userEdgeTypes]
  );
  return /* @__PURE__ */ jsx8(
    "div",
    {
      className: props.className,
      style: {
        width: "100%",
        height: "100%",
        minHeight: 300,
        ...props.style
      },
      children: /* @__PURE__ */ jsxs5(
        ReactFlow,
        {
          nodes: reactFlowNodes,
          edges: reactFlowEdges,
          nodeTypes: mergedNodeTypes,
          edgeTypes: mergedEdgeTypes,
          onNodeClick: handleNodeClick,
          fitView: true,
          proOptions: { hideAttribution: true },
          children: [
            /* @__PURE__ */ jsx8(Background, { variant: BackgroundVariant.Dots, gap: 20, size: 1 }),
            props.children
          ]
        }
      )
    }
  );
}

// src/components/FlowchartView/TracedFlow.tsx
import { useCallback as useCallback3, useMemo as useMemo5, useRef as useRef5, useState as useState4 } from "react";
import {
  ReactFlow as ReactFlow2,
  Background as Background2,
  BackgroundVariant as BackgroundVariant2,
  MarkerType as MarkerType2
} from "@xyflow/react";

// src/components/FlowchartView/_internal/devWarn.ts
function isDevModeEnv() {
  const proc = globalThis.process;
  return proc?.env?.NODE_ENV !== "production";
}
function devWarn(messageFn, ...extras) {
  if (!isDevModeEnv()) return;
  console.warn(messageFn(), ...extras);
}

// src/components/FlowchartView/_internal/notifyChange.ts
function createNotifier(label = "notifier") {
  const listeners = /* @__PURE__ */ new Set();
  let v2 = 0;
  let pending = false;
  function flush() {
    if (!pending) return;
    pending = false;
    const snapshot = Array.from(listeners);
    for (const l of snapshot) {
      try {
        l();
      } catch (err) {
        devWarn(
          () => `[${label}] subscribe() listener threw \u2014 isolated; other subscribers continue.`,
          err
        );
      }
    }
  }
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    version() {
      return v2;
    },
    notify() {
      v2 += 1;
      if (pending) return;
      pending = true;
      queueMicrotask(flush);
    },
    flushPending() {
      flush();
    }
  };
}

// src/components/FlowchartView/createTraceRuntimeOverlay.ts
function parseStageIdFromRuntimeStageId(runtimeStageId) {
  const hashIdx = runtimeStageId.indexOf("#");
  return hashIdx >= 0 ? runtimeStageId.slice(0, hashIdx) : runtimeStageId;
}
function createTraceRuntimeOverlay(options = {}) {
  const id = options.id ?? "trace-runtime-overlay";
  const startTime = performance.now();
  let executionOrder = [];
  const recordedRuntimeStageIds = /* @__PURE__ */ new Set();
  const errors = /* @__PURE__ */ new Map();
  let running = false;
  const notifier = createNotifier("traceRuntimeOverlay");
  const notifyChange = notifier.notify;
  function pushStep(runtimeStageId, stageId, stageName) {
    if (recordedRuntimeStageIds.has(runtimeStageId)) return;
    recordedRuntimeStageIds.add(runtimeStageId);
    executionOrder.push({
      runtimeStageId,
      stageId,
      stageName,
      timestampMs: performance.now() - startTime
    });
    notifyChange();
  }
  const recorder = {
    id,
    onRunStart() {
      running = true;
      notifyChange();
    },
    onRunEnd() {
      running = false;
      notifyChange();
    },
    onStageExecuted(event) {
      const runtimeStageId = event.traversalContext.runtimeStageId;
      const baseStageId = parseStageIdFromRuntimeStageId(runtimeStageId);
      pushStep(runtimeStageId, baseStageId, event.stageName);
    },
    onError(event) {
      const fallbackId = event.stageId ?? (event.traversalContext ? parseStageIdFromRuntimeStageId(event.traversalContext.runtimeStageId) : event.stageName);
      errors.set(fallbackId, event.message ?? "error");
      notifyChange();
    }
  };
  return {
    recorder,
    getOverlay() {
      return {
        executionOrder: executionOrder.map((s) => ({ ...s })),
        errors: new Map(errors),
        running
      };
    },
    subscribe: notifier.subscribe,
    version: notifier.version,
    reset() {
      executionOrder = [];
      recordedRuntimeStageIds.clear();
      errors.clear();
      running = false;
    }
  };
}
function sliceOverlay(overlay, index) {
  const order = overlay.executionOrder;
  if (order.length === 0) {
    return {
      doneStageIds: /* @__PURE__ */ new Set(),
      activeStageId: null,
      executedStageIds: /* @__PURE__ */ new Set(),
      executedOrderIds: [],
      errors: overlay.errors
    };
  }
  const clampedIndex = Math.max(0, Math.min(index, order.length - 1));
  const doneStageIds = /* @__PURE__ */ new Set();
  for (let i = 0; i < clampedIndex; i++) {
    doneStageIds.add(order[i].stageId);
  }
  const activeStep = order[clampedIndex];
  const activeStageId = activeStep ? activeStep.stageId : null;
  const executedStageIds = new Set(doneStageIds);
  if (activeStageId) executedStageIds.add(activeStageId);
  const executedOrderIds = order.slice(0, clampedIndex + 1).map((s) => s.stageId);
  return {
    doneStageIds,
    activeStageId,
    executedStageIds,
    executedOrderIds,
    errors: overlay.errors
  };
}

// src/components/FlowchartView/_internal/subflowDrill.ts
function filterGraphForDrill(graph, currentSubflowId) {
  if (graph.nodes.length === 0) return graph;
  const matchesScope = (subflowOf) => currentSubflowId === null ? subflowOf === void 0 : subflowOf === currentSubflowId;
  const visibleIds = /* @__PURE__ */ new Set();
  for (const n of graph.nodes) {
    if (matchesScope(n.data?.subflowOf)) visibleIds.add(n.id);
  }
  if (visibleIds.size === graph.nodes.length) return graph;
  return {
    nodes: graph.nodes.filter((n) => visibleIds.has(n.id)),
    edges: graph.edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target))
  };
}
function buildSubflowBreadcrumb(graph, currentSubflowId) {
  const out = [{ subflowId: null, label: "Chart" }];
  if (currentSubflowId !== null) {
    const mount = graph.nodes.find((n) => n.data?.subflowId === currentSubflowId);
    out.push({
      subflowId: currentSubflowId,
      label: mount?.data?.label ?? currentSubflowId
    });
  }
  return out;
}

// src/components/FlowchartView/_internal/overlayProjection.ts
function aggregateMountStatus(slice, graph, currentSubflowId) {
  if (graph.nodes.length === 0) return slice;
  const mounts = graph.nodes.filter((n) => n.data?.isSubflow && n.data?.subflowId);
  if (mounts.length === 0) return slice;
  const doneIds = new Set(slice.doneStageIds);
  let activeId = slice.activeStageId;
  for (const mount of mounts) {
    const sfId = mount.data.subflowId;
    const members = graph.nodes.filter((n) => n.data?.subflowOf === sfId);
    if (members.length === 0) continue;
    const anyActive = members.some((m) => m.id === slice.activeStageId);
    const allDone = members.every((m) => slice.doneStageIds.has(m.id));
    if (allDone) doneIds.add(mount.id);
    else if (anyActive && currentSubflowId === null) {
      activeId = mount.id;
    }
  }
  return { ...slice, doneStageIds: doneIds, activeStageId: activeId };
}

// src/components/FlowchartView/_internal/useSubflowDrill.ts
import { useCallback as useCallback2, useEffect as useEffect4, useRef as useRef4, useState as useState3 } from "react";
function useSubflowDrill(graph, onSubflowChange) {
  const [currentSubflowId, setCurrentSubflowId] = useState3(null);
  const lastGraphRef = useRef4(null);
  if (lastGraphRef.current !== graph) {
    lastGraphRef.current = graph;
    if (currentSubflowId !== null && !graph.nodes.some((n) => n.data?.subflowId === currentSubflowId)) {
      queueMicrotask(() => setCurrentSubflowId(null));
    }
  }
  const lastNotifiedRef = useRef4(void 0);
  useEffect4(() => {
    if (lastNotifiedRef.current === currentSubflowId) return;
    lastNotifiedRef.current = currentSubflowId;
    if (currentSubflowId === null) {
      onSubflowChange?.(null);
    } else {
      const mount = graph.nodes.find((n) => n.data?.subflowId === currentSubflowId);
      if (mount) onSubflowChange?.(mount.id);
    }
  }, [currentSubflowId, graph, onSubflowChange]);
  const drillInto = useCallback2((subflowId) => {
    setCurrentSubflowId(subflowId);
  }, []);
  const drillUp = useCallback2(() => {
    setCurrentSubflowId(null);
  }, []);
  return { currentSubflowId, drillInto, drillUp, setCurrentSubflowId };
}

// src/components/FlowchartView/_internal/useChartAutoRefit.ts
import { useEffect as useEffect5 } from "react";
function useChartAutoRefit(wrapperRef, rfInstance, options = {}) {
  const duration = options.duration ?? 200;
  const padding2 = options.padding ?? 0.1;
  const refitKey = options.refitKey;
  useEffect5(() => {
    const el = wrapperRef.current;
    if (!el || !rfInstance) return;
    let raf = 0;
    const refit = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        rfInstance.fitView({ duration, padding: padding2 });
      });
    };
    const ro = new ResizeObserver(refit);
    ro.observe(el);
    window.addEventListener("resize", refit);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", refit);
      cancelAnimationFrame(raf);
    };
  }, [rfInstance, wrapperRef, duration, padding2]);
  useEffect5(() => {
    if (!rfInstance) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        rfInstance.fitView({ duration, padding: padding2 });
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [rfInstance, refitKey, duration, padding2]);
}

// src/components/FlowchartView/SubflowBreadcrumbBar.tsx
import { jsx as jsx9, jsxs as jsxs6 } from "react/jsx-runtime";
function SubflowBreadcrumbBar({ entries, onNavigate }) {
  return /* @__PURE__ */ jsx9(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        fontSize: 11,
        background: rawDefaults.colors.bgSecondary,
        borderBottom: `1px solid ${rawDefaults.colors.border}`,
        flexShrink: 0
      },
      "aria-label": "Subflow breadcrumb",
      children: entries.map((entry, i) => {
        const isLast = i === entries.length - 1;
        return /* @__PURE__ */ jsxs6(
          "span",
          {
            style: { display: "inline-flex", alignItems: "center", gap: 6 },
            children: [
              /* @__PURE__ */ jsx9(
                "button",
                {
                  type: "button",
                  onClick: () => onNavigate(entry.subflowId),
                  disabled: isLast,
                  style: {
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    fontSize: 11,
                    fontWeight: isLast ? 600 : 500,
                    color: isLast ? rawDefaults.colors.textPrimary : rawDefaults.colors.primary,
                    cursor: isLast ? "default" : "pointer",
                    textDecoration: isLast ? "none" : "underline",
                    fontFamily: "inherit"
                  },
                  children: entry.label
                }
              ),
              !isLast && /* @__PURE__ */ jsx9("span", { style: { color: rawDefaults.colors.textMuted }, children: "\u203A" })
            ]
          },
          entry.subflowId ?? "__top__"
        );
      })
    }
  );
}

// src/components/GroupContainerNode/GroupContainerNode.tsx
import { Handle as Handle2, Position as Position3 } from "@xyflow/react";
import { jsx as jsx10, jsxs as jsxs7 } from "react/jsx-runtime";
var C = rawDefaults.colors;
function GroupContainerNode({ data }) {
  const d = data;
  const borderColor = d.error ? C.error : d.active ? C.primary : d.done ? C.success : C.border;
  return /* @__PURE__ */ jsxs7(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        border: `1.5px ${d.active || d.done || d.error ? "solid" : "dashed"} ${borderColor}`,
        borderRadius: 12,
        // Translucent so the dotted background + nested children read clearly.
        background: "rgba(148, 163, 184, 0.06)",
        opacity: d.dimmed ? 0.4 : 1,
        position: "relative"
      },
      children: [
        /* @__PURE__ */ jsxs7(
          "div",
          {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 12px",
              fontSize: 12,
              fontWeight: 600,
              color: C.textMuted,
              letterSpacing: 0.2
            },
            children: [
              d.icon ? /* @__PURE__ */ jsx10("span", { "aria-hidden": true, children: d.icon }) : null,
              /* @__PURE__ */ jsx10("span", { children: d.label })
            ]
          }
        ),
        /* @__PURE__ */ jsx10(Handle2, { type: "target", position: Position3.Top, style: { opacity: 0 } }),
        /* @__PURE__ */ jsx10(Handle2, { type: "source", position: Position3.Bottom, style: { opacity: 0 } })
      ]
    }
  );
}

// src/components/FlowchartView/TracedFlow.tsx
import { jsx as jsx11, jsxs as jsxs8 } from "react/jsx-runtime";
var DEFAULT_COLORS = {
  default: rawDefaults.colors.textMuted,
  done: rawDefaults.colors.success,
  active: rawDefaults.colors.primary,
  error: rawDefaults.colors.error,
  loop: rawDefaults.colors.warning
};
var EMPTY_SET = /* @__PURE__ */ new Set();
function deriveOverlayFields(node, doneStageIds, activeStageId, errorMessage, executedOrderIds, coActiveStageIds) {
  const isDone = doneStageIds.has(node.id);
  const isActive = activeStageId === node.id || coActiveStageIds.has(node.id);
  const wasExecuted = isDone || isActive;
  const hasError = !!errorMessage;
  const dimmed = !wasExecuted && executedOrderIds.length > 0;
  let stepNumbers;
  if (executedOrderIds.length > 0) {
    const nums = [];
    for (let i = 0; i < executedOrderIds.length; i++) {
      if (executedOrderIds[i] === node.id) nums.push(i + 1);
    }
    if (nums.length > 0) stepNumbers = nums;
  }
  return {
    active: isActive,
    done: isDone,
    error: hasError,
    dimmed,
    ...errorMessage && { errorMessage },
    ...stepNumbers && { stepNumbers }
  };
}
function toStageNodeWithOverlay(node, doneStageIds, activeStageId, errorMessage, executedOrderIds, coActiveStageIds) {
  const overlayFields = deriveOverlayFields(
    node,
    doneStageIds,
    activeStageId,
    errorMessage,
    executedOrderIds,
    coActiveStageIds
  );
  const { dimmed } = overlayFields;
  if (node.type !== void 0 && node.type !== "stage") {
    const consumerData = node.data ?? {};
    const consumerActive = consumerData.active === true;
    const consumerDone = consumerData.done === true;
    const consumerError = consumerData.error === true;
    const finalActive = consumerActive || overlayFields.active;
    const finalDone = consumerDone || overlayFields.done;
    const finalError = consumerError || overlayFields.error;
    const finalDimmed = !finalActive && !finalDone && dimmed;
    return {
      ...node,
      data: {
        ...node.data,
        active: finalActive,
        done: finalDone,
        error: finalError,
        ...overlayFields.errorMessage !== void 0 && consumerData.errorMessage === void 0 && {
          errorMessage: overlayFields.errorMessage
        },
        ...finalDimmed && { dimmed: true },
        ...overlayFields.stepNumbers && { stepNumbers: overlayFields.stepNumbers }
      },
      ...finalDimmed && { style: { ...node.style ?? {}, opacity: 0.35 } }
    };
  }
  const stageData = {
    label: node.data.label,
    isDecider: node.data.isDecider,
    isFork: node.data.isFork,
    isSubflow: node.data.isSubflow,
    ...overlayFields,
    ...node.data.description !== void 0 && { description: node.data.description },
    ...node.data.icon !== void 0 && { icon: node.data.icon },
    ...node.data.subflowId !== void 0 && { subflowId: node.data.subflowId },
    ...node.data.isLazy === true && { isLazy: true },
    ...node.data.emphasis !== void 0 && { emphasis: node.data.emphasis },
    ...node.data.size !== void 0 && { size: node.data.size }
  };
  return {
    ...node,
    type: "stageNode",
    data: stageData,
    ...dimmed && { style: { opacity: 0.35 } }
  };
}
function styleEdgeWithOverlay(edge, doneStageIds, activeStageId, colors) {
  const kind = edge.data?.kind ?? "next";
  const sourceExecuted = doneStageIds.has(edge.source) || activeStageId === edge.source;
  const targetExecuted = doneStageIds.has(edge.target) || activeStageId === edge.target;
  const traversed = sourceExecuted && targetExecuted;
  const isLeadingEdge = activeStageId === edge.source && !doneStageIds.has(edge.target);
  let color = colors.default;
  if (kind === "loop") color = colors.loop;
  else if (isLeadingEdge) color = colors.active;
  else if (traversed) color = colors.done;
  const styled = {
    ...edge,
    // Loop back-edges use the custom `loopBack` edge — a curve routed along the
    // right margin (clear of the spine). It reads node bounds from the store
    // and anchors on right edges itself, so it needs NO dedicated loop handles
    // on the node (the old approach broke for any node missing them).
    // Every other edge uses `smartStep`: a smoothstep superset that routes a
    // RANK-SKIPPING edge around the node it skips (else identical to smoothstep).
    type: kind === "loop" ? "loopBack" : "smartStep",
    animated: isLeadingEdge,
    style: { stroke: color, strokeWidth: traversed ? 2 : 1.5 },
    markerEnd: { type: MarkerType2.ArrowClosed, color, width: 16, height: 16 }
  };
  if (kind === "loop") {
    styled.style = { ...styled.style, strokeDasharray: "4 3" };
  }
  return styled;
}
var DEFAULT_NODE_TYPES2 = {
  stageNode: StageNode,
  groupContainer: GroupContainerNode
};
var DEFAULT_EDGE_TYPES2 = { loopBack: LoopBackEdge, smartStep: SmartStepEdge };
function TracedFlow({
  graph,
  overlay,
  scrubIndex,
  layout: layoutProp,
  colors: colorOverrides,
  onNodeClick,
  onSubflowChange,
  groupedSubflows,
  mainChartBox,
  nodeTypes: userNodeTypes,
  edgeTypes: userEdgeTypes,
  coActiveStageIds,
  children,
  className,
  style
}) {
  const layout = layoutProp ?? dagreTraceLayout;
  const colors = useMemo5(
    () => ({ ...DEFAULT_COLORS, ...colorOverrides ?? {} }),
    [colorOverrides]
  );
  const mergedNodeTypes = useMemo5(
    () => userNodeTypes ? { ...DEFAULT_NODE_TYPES2, ...userNodeTypes } : DEFAULT_NODE_TYPES2,
    [userNodeTypes]
  );
  const mergedEdgeTypes = useMemo5(
    () => userEdgeTypes ? { ...DEFAULT_EDGE_TYPES2, ...userEdgeTypes } : DEFAULT_EDGE_TYPES2,
    [userEdgeTypes]
  );
  const drill = useSubflowDrill(graph, onSubflowChange);
  const groupedSet = useMemo5(() => new Set(groupedSubflows ?? []), [groupedSubflows]);
  const filteredGraph = useMemo5(() => {
    const base = filterGraphForDrill(graph, drill.currentSubflowId);
    if (groupedSet.size === 0) return base;
    const baseIds = new Set(base.nodes.map((n) => n.id));
    const extraNodes = graph.nodes.filter(
      (n) => n.data?.subflowOf !== void 0 && groupedSet.has(n.data.subflowOf) && !baseIds.has(n.id)
    );
    if (extraNodes.length === 0) return base;
    const allIds = /* @__PURE__ */ new Set([...baseIds, ...extraNodes.map((n) => n.id)]);
    const baseEdgeIds = new Set(base.edges.map((e) => e.id));
    const extraEdges = graph.edges.filter(
      (e) => !baseEdgeIds.has(e.id) && allIds.has(e.source) && allIds.has(e.target)
    );
    return { nodes: [...base.nodes, ...extraNodes], edges: [...base.edges, ...extraEdges] };
  }, [graph, drill.currentSubflowId, groupedSet]);
  const breadcrumb = useMemo5(
    () => buildSubflowBreadcrumb(graph, drill.currentSubflowId),
    [graph, drill.currentSubflowId]
  );
  const positioned = useMemo5(() => {
    const realBase = layout === "passthrough" ? (g) => g : layout;
    if (groupedSet.size > 0) {
      const grouped = applyGroupLayout(filteredGraph, {
        groupedSubflowIds: [...groupedSet],
        baseLayout: realBase
      });
      return mainChartBox ? wrapInMainChartBox(grouped, { baseLayout: (g) => g, ...mainChartBox }) : grouped;
    }
    if (mainChartBox) {
      return wrapInMainChartBox(filteredGraph, { baseLayout: realBase, ...mainChartBox });
    }
    return layout === "passthrough" ? filteredGraph : layout(filteredGraph);
  }, [filteredGraph, layout, groupedSet, mainChartBox]);
  const slice = useMemo5(() => {
    const empty = {
      doneStageIds: /* @__PURE__ */ new Set(),
      activeStageId: null,
      executedStageIds: /* @__PURE__ */ new Set(),
      executedOrderIds: [],
      errors: /* @__PURE__ */ new Map()
    };
    if (!overlay) return empty;
    const idx = scrubIndex ?? Math.max(0, overlay.executionOrder.length - 1);
    return aggregateMountStatus(sliceOverlay(overlay, idx), graph, drill.currentSubflowId);
  }, [overlay, scrubIndex, graph, drill.currentSubflowId]);
  const reactFlowNodes = useMemo5(
    () => positioned.nodes.map(
      (n) => toStageNodeWithOverlay(
        n,
        slice.doneStageIds,
        slice.activeStageId,
        slice.errors.get(n.id),
        slice.executedOrderIds,
        coActiveStageIds ?? EMPTY_SET
      )
    ),
    [positioned.nodes, slice, coActiveStageIds]
  );
  const reactFlowEdges = useMemo5(
    () => positioned.edges.map(
      (e) => styleEdgeWithOverlay(e, slice.doneStageIds, slice.activeStageId, colors)
    ),
    [positioned.edges, slice, colors]
  );
  const handleNodeClick = useCallback3(
    (_, node) => {
      const data = node.data ?? {};
      if (data.isSubflow && data.subflowId && !groupedSet.has(data.subflowId)) {
        drill.drillInto(data.subflowId);
      }
      onNodeClick?.(node.id);
    },
    [drill, onNodeClick, groupedSet]
  );
  const wrapperRef = useRef5(null);
  const [rfInstance, setRfInstance] = useState4(null);
  useChartAutoRefit(wrapperRef, rfInstance, { refitKey: drill.currentSubflowId });
  return /* @__PURE__ */ jsxs8(
    "div",
    {
      ref: wrapperRef,
      className,
      style: {
        width: "100%",
        height: "100%",
        minHeight: 300,
        display: "flex",
        flexDirection: "column",
        ...style
      },
      children: [
        breadcrumb.length > 1 && /* @__PURE__ */ jsx11(
          SubflowBreadcrumbBar,
          {
            entries: breadcrumb,
            onNavigate: drill.setCurrentSubflowId
          }
        ),
        /* @__PURE__ */ jsx11("div", { style: { flex: 1, minHeight: 0 }, children: /* @__PURE__ */ jsxs8(
          ReactFlow2,
          {
            nodes: reactFlowNodes,
            edges: reactFlowEdges,
            nodeTypes: mergedNodeTypes,
            edgeTypes: mergedEdgeTypes,
            onNodeClick: handleNodeClick,
            onInit: setRfInstance,
            fitView: true,
            proOptions: { hideAttribution: true },
            children: [
              /* @__PURE__ */ jsx11(Background2, { variant: BackgroundVariant2.Dots, gap: 20, size: 1 }),
              children
            ]
          }
        ) })
      ]
    }
  );
}

// src/components/TimeTravelDebugger/TimeTravelDebugger.tsx
import { jsx as jsx12, jsxs as jsxs9 } from "react/jsx-runtime";
function TimeTravelDebugger({
  snapshots,
  graph,
  runtimeOverlay,
  showGantt = true,
  layout = "horizontal",
  title = "Time-Travel Debugger",
  size = "default",
  unstyled = false,
  className,
  style
}) {
  const [selectedIndex, setSelectedIndex] = useState5(0);
  const fs = fontSize[size];
  const pad = padding[size];
  if (snapshots.length === 0) {
    return /* @__PURE__ */ jsx12(
      "div",
      {
        className,
        style: {
          padding: pad * 2,
          textAlign: "center",
          color: theme.textMuted,
          ...style
        },
        children: "No snapshots to debug"
      }
    );
  }
  const isHorizontal = layout === "horizontal";
  const handleNodeClick = (stageId) => {
    const idx = snapshots.findIndex(
      (s) => s.stageName === stageId || s.stageLabel === stageId
    );
    if (idx >= 0) setSelectedIndex(idx);
  };
  const chart = runtimeOverlay ? /* @__PURE__ */ jsx12(
    TracedFlow,
    {
      graph,
      overlay: runtimeOverlay,
      scrubIndex: selectedIndex,
      onNodeClick: handleNodeClick
    }
  ) : /* @__PURE__ */ jsx12(TraceFlow, { graph, onNodeClick: handleNodeClick });
  if (unstyled) {
    return /* @__PURE__ */ jsxs9("div", { className, style, "data-fp": "time-travel-debugger", children: [
      /* @__PURE__ */ jsx12("h3", { children: title }),
      /* @__PURE__ */ jsx12(
        "input",
        {
          type: "range",
          min: 0,
          max: snapshots.length - 1,
          value: selectedIndex,
          onChange: (e) => setSelectedIndex(parseInt(e.target.value))
        }
      ),
      chart,
      /* @__PURE__ */ jsx12(
        MemoryInspector,
        {
          snapshots,
          selectedIndex,
          unstyled: true
        }
      ),
      /* @__PURE__ */ jsx12(
        NarrativeLog,
        {
          snapshots,
          selectedIndex,
          unstyled: true
        }
      ),
      showGantt && /* @__PURE__ */ jsx12(
        GanttTimeline,
        {
          snapshots,
          selectedIndex,
          onSelect: setSelectedIndex,
          unstyled: true
        }
      )
    ] });
  }
  return /* @__PURE__ */ jsxs9(
    "div",
    {
      className,
      style: {
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: theme.bgPrimary,
        fontFamily: theme.fontSans,
        overflow: "hidden",
        ...style
      },
      "data-fp": "time-travel-debugger",
      children: [
        /* @__PURE__ */ jsxs9(
          "div",
          {
            style: {
              padding: `${pad}px ${pad + 4}px`,
              borderBottom: `1px solid ${theme.border}`,
              background: theme.bgSecondary,
              flexShrink: 0
            },
            children: [
              /* @__PURE__ */ jsxs9(
                "div",
                {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 8
                  },
                  children: [
                    /* @__PURE__ */ jsx12(
                      "span",
                      {
                        style: {
                          fontSize: fs.body + 2,
                          fontWeight: 600,
                          color: theme.textPrimary
                        },
                        children: title
                      }
                    ),
                    /* @__PURE__ */ jsx12(
                      "span",
                      {
                        style: {
                          fontSize: fs.small,
                          color: theme.textMuted
                        },
                        children: "Scrub to replay execution"
                      }
                    )
                  ]
                }
              ),
              /* @__PURE__ */ jsxs9("div", { style: { display: "flex", alignItems: "center", gap: 8 }, children: [
                /* @__PURE__ */ jsx12(
                  ScrubButton,
                  {
                    label: "\u25C0",
                    disabled: selectedIndex === 0,
                    onClick: () => setSelectedIndex((i) => Math.max(0, i - 1))
                  }
                ),
                /* @__PURE__ */ jsx12(
                  "input",
                  {
                    type: "range",
                    min: 0,
                    max: snapshots.length - 1,
                    value: selectedIndex,
                    onChange: (e) => setSelectedIndex(parseInt(e.target.value)),
                    style: {
                      flex: 1,
                      height: 4,
                      accentColor: theme.primary,
                      cursor: "pointer"
                    }
                  }
                ),
                /* @__PURE__ */ jsx12(
                  ScrubButton,
                  {
                    label: "\u25B6",
                    disabled: selectedIndex === snapshots.length - 1,
                    onClick: () => setSelectedIndex((i) => Math.min(snapshots.length - 1, i + 1))
                  }
                ),
                /* @__PURE__ */ jsxs9(
                  "span",
                  {
                    style: {
                      fontSize: fs.small,
                      color: theme.textMuted,
                      flexShrink: 0,
                      fontFamily: theme.fontMono
                    },
                    children: [
                      selectedIndex + 1,
                      "/",
                      snapshots.length
                    ]
                  }
                )
              ] })
            ]
          }
        ),
        /* @__PURE__ */ jsxs9(
          "div",
          {
            style: {
              flex: 1,
              display: "flex",
              flexDirection: isHorizontal ? "row" : "column",
              overflow: "hidden"
            },
            children: [
              /* @__PURE__ */ jsx12(
                "div",
                {
                  style: {
                    flex: 1,
                    overflow: "hidden",
                    borderRight: isHorizontal ? `1px solid ${theme.border}` : "none",
                    borderBottom: !isHorizontal ? `1px solid ${theme.border}` : "none"
                  },
                  children: chart
                }
              ),
              /* @__PURE__ */ jsxs9("div", { style: { flex: 1, overflow: "auto" }, children: [
                /* @__PURE__ */ jsx12(
                  MemoryInspector,
                  {
                    snapshots,
                    selectedIndex,
                    size
                  }
                ),
                /* @__PURE__ */ jsx12(
                  "div",
                  {
                    style: {
                      height: 1,
                      background: theme.border,
                      margin: `0 ${pad}px`
                    }
                  }
                ),
                /* @__PURE__ */ jsx12(
                  NarrativeLog,
                  {
                    snapshots,
                    selectedIndex,
                    size
                  }
                )
              ] })
            ]
          }
        ),
        showGantt && /* @__PURE__ */ jsx12(
          "div",
          {
            style: {
              borderTop: `1px solid ${theme.border}`,
              background: theme.bgSecondary,
              flexShrink: 0
            },
            children: /* @__PURE__ */ jsx12(
              GanttTimeline,
              {
                snapshots,
                selectedIndex,
                onSelect: setSelectedIndex,
                size
              }
            )
          }
        )
      ]
    }
  );
}
function ScrubButton({
  label,
  disabled,
  onClick
}) {
  return /* @__PURE__ */ jsx12(
    "button",
    {
      onClick,
      disabled,
      style: {
        background: theme.bgTertiary,
        border: `1px solid ${theme.border}`,
        color: disabled ? theme.textMuted : theme.textPrimary,
        borderRadius: 6,
        width: 28,
        height: 28,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        fontSize: 12,
        flexShrink: 0
      },
      children: label
    }
  );
}

// src/components/FlowchartView/SubflowBreadcrumb.tsx
import { memo as memo2 } from "react";
import { jsx as jsx13, jsxs as jsxs10 } from "react/jsx-runtime";
var SubflowBreadcrumb = memo2(function SubflowBreadcrumb2({
  breadcrumbs,
  onNavigate
}) {
  if (breadcrumbs.length <= 1) return null;
  return /* @__PURE__ */ jsx13(
    "div",
    {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "6px 12px",
        background: theme.bgSecondary,
        borderBottom: `1px solid ${theme.border}`,
        fontSize: 12,
        fontFamily: theme.fontSans,
        flexShrink: 0,
        overflowX: "auto"
      },
      children: breadcrumbs.map((crumb, i) => {
        const isLast = i === breadcrumbs.length - 1;
        return /* @__PURE__ */ jsxs10("span", { style: { display: "flex", alignItems: "center", gap: 4 }, children: [
          i > 0 && /* @__PURE__ */ jsx13("span", { style: { color: theme.textMuted, fontSize: 10 }, children: "\u203A" }),
          isLast ? /* @__PURE__ */ jsxs10("span", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
            /* @__PURE__ */ jsx13(
              "span",
              {
                style: {
                  color: theme.primary,
                  fontWeight: 600
                },
                children: crumb.label
              }
            ),
            crumb.description && /* @__PURE__ */ jsxs10(
              "span",
              {
                style: {
                  color: theme.textMuted,
                  fontWeight: 400,
                  fontSize: 11
                },
                children: [
                  "\u2014 ",
                  crumb.description
                ]
              }
            )
          ] }) : /* @__PURE__ */ jsx13(
            "button",
            {
              onClick: () => onNavigate(i),
              style: {
                background: "none",
                border: "none",
                color: theme.textSecondary,
                cursor: "pointer",
                padding: "2px 4px",
                borderRadius: 4,
                fontSize: 12,
                fontFamily: "inherit",
                fontWeight: 500,
                transition: "color 0.15s"
              },
              onMouseEnter: (e) => {
                e.currentTarget.style.color = `${theme.primary}`;
              },
              onMouseLeave: (e) => {
                e.currentTarget.style.color = `${theme.textSecondary}`;
              },
              children: crumb.label
            }
          )
        ] }, `${crumb.label}-${i}`);
      })
    }
  );
});

// src/components/FlowchartView/useSubflowNavigation.ts
import { useState as useState6, useCallback as useCallback4, useMemo as useMemo6 } from "react";
var EMPTY_GRAPH2 = { nodes: [], edges: [] };
function useSubflowNavigation(rootGraph) {
  const [stack, setStack] = useState6([]);
  const safeRootGraph = rootGraph ?? EMPTY_GRAPH2;
  const subflowMounts = useMemo6(() => {
    const map = /* @__PURE__ */ new Map();
    for (const node of safeRootGraph.nodes) {
      if (!node.data?.isSubflow) continue;
      const subflowId = typeof node.data.subflowId === "string" ? node.data.subflowId : node.id;
      const label = typeof node.data.label === "string" ? node.data.label : node.id;
      const entry = {
        subflowId,
        label
      };
      if (typeof node.data.description === "string") {
        entry.description = node.data.description;
      }
      map.set(node.id, entry);
      map.set(subflowId, entry);
    }
    return map;
  }, [safeRootGraph]);
  const breadcrumbs = useMemo6(() => {
    const rootLabel = "Flowchart";
    const root = { label: rootLabel };
    return [root, ...stack];
  }, [stack]);
  const handleNodeClick = useCallback4(
    (nodeId) => {
      const mount = subflowMounts.get(nodeId);
      if (!mount) return false;
      setStack((prev) => {
        const entry = {
          label: mount.label,
          subflowId: mount.subflowId
        };
        if (mount.description !== void 0) entry.description = mount.description;
        return [...prev, entry];
      });
      return true;
    },
    [subflowMounts]
  );
  const navigateTo = useCallback4((level) => {
    if (level === 0) {
      setStack([]);
    } else {
      setStack((prev) => prev.slice(0, level));
    }
  }, []);
  const top = stack[stack.length - 1];
  return {
    breadcrumbs,
    // TODO(recorder-driven-nesting): swap to per-subflow graph when
    // child charts attach their own recorders.
    currentGraph: safeRootGraph,
    currentSubflowId: top?.subflowId ?? null,
    currentSubflowNodeName: top?.label ?? null,
    handleNodeClick,
    navigateTo,
    isInSubflow: stack.length > 0
  };
}

// src/components/FlowchartView/SubflowTree.tsx
import { memo as memo3, useState as useState7, useCallback as useCallback5, useMemo as useMemo7 } from "react";
import { Fragment as Fragment2, jsx as jsx14, jsxs as jsxs11 } from "react/jsx-runtime";
function graphToSubflowEntries(graph) {
  if (!graph?.nodes?.length) return [];
  const entries = [];
  for (const node of graph.nodes) {
    if (!node.data?.isSubflow) continue;
    const entry = {
      name: typeof node.data.label === "string" ? node.data.label : node.id,
      isSubflow: true
    };
    if (typeof node.data.description === "string") entry.description = node.data.description;
    if (typeof node.data.subflowId === "string") entry.subflowId = node.data.subflowId;
    entries.push(entry);
  }
  return entries;
}
var TreeNode = memo3(function TreeNode2({
  entry,
  depth,
  activeStage,
  doneStages,
  onNodeSelect
}) {
  const [expanded, setExpanded] = useState7(true);
  const hasChildren = entry.children && entry.children.length > 0;
  const isActive = activeStage === entry.name;
  const isDone = doneStages?.has(entry.name);
  const handleClick = useCallback5(() => {
    if (hasChildren) {
      setExpanded((prev) => !prev);
    }
    onNodeSelect?.(entry.name, !!entry.isSubflow);
  }, [hasChildren, onNodeSelect, entry.name, entry.isSubflow]);
  return /* @__PURE__ */ jsxs11(Fragment2, { children: [
    /* @__PURE__ */ jsxs11(
      "button",
      {
        onClick: handleClick,
        "data-fp": "subflow-tree-node",
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          border: "none",
          background: isActive ? `color-mix(in srgb, ${theme.primary} 15%, transparent)` : "transparent",
          cursor: "pointer",
          padding: `4px 8px 4px ${8 + depth * 16}px`,
          fontFamily: theme.fontSans,
          fontSize: 12,
          textAlign: "left",
          borderRadius: 4,
          transition: "background 0.15s"
        },
        onMouseEnter: (e) => {
          if (!isActive) {
            e.currentTarget.style.background = `color-mix(in srgb, ${theme.textMuted} 10%, transparent)`;
          }
        },
        onMouseLeave: (e) => {
          if (!isActive) {
            e.currentTarget.style.background = "transparent";
          }
        },
        children: [
          hasChildren ? /* @__PURE__ */ jsx14(
            "span",
            {
              style: {
                fontSize: 10,
                color: theme.textMuted,
                width: 12,
                textAlign: "center",
                flexShrink: 0,
                transition: "transform 0.15s",
                transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
                display: "inline-block"
              },
              children: "\u25B6"
            }
          ) : /* @__PURE__ */ jsx14("span", { style: { width: 12, flexShrink: 0 } }),
          /* @__PURE__ */ jsx14(
            "span",
            {
              style: {
                width: 6,
                height: 6,
                borderRadius: "50%",
                flexShrink: 0,
                background: isActive ? theme.primary : isDone ? theme.success : theme.border
              }
            }
          ),
          /* @__PURE__ */ jsxs11("span", { style: { display: "flex", flexDirection: "column", minWidth: 0 }, children: [
            /* @__PURE__ */ jsxs11(
              "span",
              {
                style: {
                  color: isActive ? theme.primary : isDone ? theme.textPrimary : theme.textSecondary,
                  fontWeight: isActive ? 600 : entry.isSubflow ? 500 : 400,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                },
                children: [
                  entry.name,
                  entry.isSubflow && /* @__PURE__ */ jsx14("span", { style: { opacity: 0.5, marginLeft: 4, fontSize: 10 }, children: "\u229E" })
                ]
              }
            ),
            entry.description && /* @__PURE__ */ jsx14(
              "span",
              {
                style: {
                  color: theme.textMuted,
                  fontSize: 10,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis"
                },
                children: entry.description
              }
            )
          ] })
        ]
      }
    ),
    hasChildren && expanded && /* @__PURE__ */ jsx14("div", { children: entry.children.map((child, i) => /* @__PURE__ */ jsx14(
      TreeNode2,
      {
        entry: child,
        depth: depth + 1,
        activeStage,
        doneStages,
        onNodeSelect
      },
      child.subflowId ?? `${child.name}-${i}`
    )) })
  ] });
});
var SectionLabel = memo3(function SectionLabel2({ children }) {
  return /* @__PURE__ */ jsx14(
    "div",
    {
      style: {
        padding: "4px 12px 8px",
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: theme.textMuted
      },
      children
    }
  );
});
var SubflowTree = memo3(function SubflowTree2({
  graph,
  activeStage,
  doneStages,
  onNodeSelect,
  unstyled = false,
  className,
  style
}) {
  const subflowStages = useMemo7(() => graphToSubflowEntries(graph), [graph]);
  if (subflowStages.length === 0) return null;
  return /* @__PURE__ */ jsxs11(
    "div",
    {
      className,
      "data-fp": "subflow-tree",
      style: {
        ...unstyled ? {} : {
          fontFamily: theme.fontSans,
          fontSize: 12,
          background: theme.bgPrimary,
          borderRight: `1px solid ${theme.border}`,
          overflowY: "auto",
          overflowX: "hidden",
          padding: "8px 0"
        },
        ...style
      },
      children: [
        !unstyled && /* @__PURE__ */ jsx14(SectionLabel, { children: "Subflows" }),
        subflowStages.map((entry, i) => /* @__PURE__ */ jsx14(
          TreeNode,
          {
            entry,
            depth: 0,
            activeStage,
            doneStages,
            onNodeSelect
          },
          entry.subflowId ?? `${entry.name}-${i}`
        ))
      ]
    }
  );
});

// src/components/FlowchartView/_internal/keys.ts
function asStageId(s) {
  return s;
}
function asRuntimeStageId(s) {
  return s;
}

// src/components/FlowchartView/_internal/walkSubflowSpecInto.ts
function walkSubflowSpecInto(spec, subflowPath, sink) {
  walkNode(spec, subflowPath, sink, /* @__PURE__ */ new Set());
}
function qid(subflowPath, localId) {
  return `${subflowPath}/${localId}`;
}
function walkNode(node, subflowPath, sink, visited) {
  const fullId = qid(subflowPath, node.id);
  if (visited.has(fullId)) return;
  visited.add(fullId);
  if (node.isLoopReference) return;
  if (node.isSubflowRoot && node.subflowId !== void 0 && node.subflowStructure) {
    const nestedPath = `${subflowPath}/${node.subflowId}`;
    walkNode(node.subflowStructure, nestedPath, sink, visited);
  }
  const type = node.type ?? "stage";
  const isDecider = type === "decider" || type === "selector";
  const isFork = type === "fork";
  const isStreaming = type === "streaming";
  const isSubflow = !!node.isSubflowRoot;
  const data = {
    label: node.name,
    isDecider,
    isFork,
    isStreaming,
    isSubflow,
    subflowOf: subflowPath,
    prevIds: [],
    nextIds: []
  };
  if (node.description !== void 0) data.description = node.description;
  if (node.icon !== void 0) data.icon = node.icon;
  if (node.subflowId !== void 0) data.subflowId = node.subflowId;
  if (node.isLazy === true) data.isLazy = true;
  if (node.isPausable === true) data.isPausable = true;
  sink.upsertNode({
    id: asStageId(fullId),
    type: "stage",
    position: { x: 0, y: 0 },
    data
  });
  if (node.children && node.children.length > 0) {
    const edgeKind = type === "fork" ? "fork-branch" : "decision-branch";
    for (const child of node.children) {
      const childFullId = qid(subflowPath, child.id);
      const edgeId = `${fullId}->${childFullId}:${edgeKind}${edgeKind === "decision-branch" ? `:${child.id}` : ""}`;
      const edgeData = { kind: edgeKind };
      if (edgeKind === "decision-branch") edgeData.label = child.id;
      const edge = {
        id: edgeId,
        source: fullId,
        target: childFullId,
        data: edgeData
      };
      if (edgeKind === "decision-branch") edge.label = child.id;
      sink.pushEdge(edge);
      walkNode(child, subflowPath, sink, visited);
    }
  }
  if (node.next) {
    if (node.next.isLoopReference && node.loopTarget) {
      const loopFullId = qid(subflowPath, node.loopTarget);
      sink.pushEdge({
        id: `${fullId}->${loopFullId}:loop`,
        source: fullId,
        target: loopFullId,
        data: { kind: "loop" }
      });
    } else {
      const nextFullId = qid(subflowPath, node.next.id);
      const edgeId = `${fullId}->${nextFullId}:next`;
      sink.pushEdge({
        id: edgeId,
        source: fullId,
        target: nextFullId,
        data: { kind: "next" }
      });
      walkNode(node.next, subflowPath, sink, visited);
    }
  }
}

// src/components/FlowchartView/traceStructureRecorder.ts
function createTraceStructureRecorder(options = {}) {
  const id = options.id ?? "trace-structure";
  const onChange = options.onChange;
  let nodes = [];
  let edges = [];
  const nodeIndex = /* @__PURE__ */ new Map();
  const seenEdgeIds = /* @__PURE__ */ new Set();
  const prevIdsOf = /* @__PURE__ */ new Map();
  const nextIdsOf = /* @__PURE__ */ new Map();
  const notifier = createNotifier("traceStructureRecorder");
  function notifyChange() {
    if (onChange) {
      try {
        onChange({ nodes, edges });
      } catch (err) {
        devWarn(
          () => "[traceStructureRecorder] onChange callback threw \u2014 isolated.",
          err
        );
      }
    }
    notifier.notify();
  }
  function upsertNode(node) {
    const existing = nodeIndex.get(node.id);
    if (existing !== void 0) {
      nodes[existing] = {
        ...nodes[existing],
        ...node,
        data: { ...nodes[existing].data, ...node.data }
      };
    } else {
      nodeIndex.set(node.id, nodes.length);
      nodes.push(node);
    }
  }
  function pushEdge(edge) {
    if (seenEdgeIds.has(edge.id)) return;
    seenEdgeIds.add(edge.id);
    edges.push(edge);
    const kind = edge.data?.kind;
    if (kind === "loop") return;
    const source = asStageId(edge.source);
    const target = asStageId(edge.target);
    const nextArr = nextIdsOf.get(source) ?? [];
    nextArr.push(target);
    nextIdsOf.set(source, nextArr);
    const prevArr = prevIdsOf.get(target) ?? [];
    prevArr.push(source);
    prevIdsOf.set(target, prevArr);
    syncNeighborsOnto(source);
    syncNeighborsOnto(target);
  }
  function syncNeighborsOnto(stageId) {
    const idx = nodeIndex.get(stageId);
    if (idx === void 0) return;
    const node = nodes[idx];
    const prevs = prevIdsOf.get(stageId);
    const nexts = nextIdsOf.get(stageId);
    node.data.prevIds = prevs ? prevs.slice() : [];
    node.data.nextIds = nexts ? nexts.slice() : [];
  }
  const recorder = {
    id,
    onStageAdded(event) {
      const spec = event.spec;
      const type = event.type;
      const isDecider = type === "decider" || type === "selector";
      const isFork = type === "fork";
      const isStreaming = type === "streaming";
      const isSubflow = !!spec.isSubflowRoot;
      const stageId = asStageId(event.stageId);
      const data = {
        label: event.name,
        isDecider,
        isFork,
        isStreaming,
        isSubflow,
        // L8.0 — seed prev/next from any edges that already fired
        // pointing AT this node. Convergence case: a fork-branch edge
        // from LoadOrder fires BEFORE the child's onStageAdded; this
        // line ensures the child's prevIds picks up the back-pointer.
        // Atomic copy (not shared ref) — see `syncNeighborsOnto` for
        // the panel-flagged consumer-safety rationale.
        prevIds: (prevIdsOf.get(stageId) ?? []).slice(),
        nextIds: (nextIdsOf.get(stageId) ?? []).slice()
      };
      if (spec.description !== void 0) data.description = spec.description;
      if (spec.icon !== void 0) data.icon = spec.icon;
      if (spec.subflowId !== void 0) data.subflowId = spec.subflowId;
      if (spec.isLazy === true) data.isLazy = true;
      if (event.isPausable === true) data.isPausable = true;
      upsertNode({
        id: event.stageId,
        type: "stage",
        // No layout here — downstream consumer applies positions.
        position: { x: 0, y: 0 },
        data
      });
      notifyChange();
    },
    onEdgeAdded(event) {
      const edgeId = `${event.from}->${event.to}:${event.kind}${event.label ? `:${event.label}` : ""}`;
      const data = { kind: event.kind };
      if (event.label !== void 0) data.label = event.label;
      const edge = {
        id: edgeId,
        source: event.from,
        target: event.to,
        data
      };
      if (event.label !== void 0) edge.label = event.label;
      pushEdge(edge);
      notifyChange();
    },
    onLoopEdgeAdded(event) {
      const edgeId = `${event.from}->${event.to}:loop`;
      pushEdge({
        id: edgeId,
        source: event.from,
        target: event.to,
        data: { kind: "loop" }
      });
      notifyChange();
    },
    onDeciderComplete(event) {
      const existing = nodeIndex.get(event.decider);
      if (existing === void 0) {
        devWarn(
          () => `[traceStructureRecorder] onDeciderComplete fired for unknown stageId "${event.decider}" \u2014 branch metadata dropped. Did the upstream fire onStageAdded for this id first?`
        );
        return;
      }
      const node = nodes[existing];
      const data = {
        ...node.data,
        branchIds: event.branchIds
      };
      if (event.defaultBranch !== void 0) data.defaultBranch = event.defaultBranch;
      nodes[existing] = { ...node, data };
      notifyChange();
    },
    onSubflowMounted(event) {
      const existing = nodeIndex.get(event.rootStageId);
      if (existing === void 0) {
        devWarn(
          () => `[traceStructureRecorder] onSubflowMounted fired for unknown rootStageId "${event.rootStageId}" (subflowId="${event.subflowId}") \u2014 subflow metadata dropped. Did the upstream fire onStageAdded for the mount node first?`
        );
        return;
      }
      const node = nodes[existing];
      const data = {
        ...node.data,
        isSubflow: true,
        subflowId: event.subflowId
      };
      if (event.isLazy === true) data.isLazy = true;
      nodes[existing] = { ...node, data };
      const subflowPath = event.subflowPath ?? event.subflowId;
      if (event.subflowSpec) {
        walkSubflowSpecInto(event.subflowSpec, subflowPath, {
          upsertNode,
          pushEdge
        });
      }
      notifyChange();
    }
  };
  return {
    recorder,
    getGraph() {
      return {
        nodes: nodes.map((n) => ({ ...n, data: { ...n.data } })),
        edges: edges.map((e) => ({ ...e, data: e.data ? { ...e.data } : void 0 }))
      };
    },
    getGraphRef() {
      return { nodes, edges };
    },
    subscribe: notifier.subscribe,
    version: notifier.version,
    reset() {
      nodes = [];
      edges = [];
      nodeIndex.clear();
      seenEdgeIds.clear();
      prevIdsOf.clear();
      nextIdsOf.clear();
    }
  };
}

// src/components/SlotPillNode/SlotPillNode.tsx
import { Handle as Handle3, Position as Position4 } from "@xyflow/react";
import { jsx as jsx15, jsxs as jsxs12 } from "react/jsx-runtime";
var C2 = rawDefaults.colors;
function SlotPillNode({ data }) {
  const d = data;
  const lit = !!(d.active || d.selected);
  const accent = lit ? C2.primary : d.done ? C2.success : C2.textMuted;
  const opacity = d.dimmed && !lit ? 0.45 : 1;
  return /* @__PURE__ */ jsxs12(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px",
        borderRadius: 999,
        // full pill
        border: `1.5px solid ${lit ? C2.primary : C2.border}`,
        background: lit ? "rgba(99, 102, 241, 0.14)" : "rgba(148, 163, 184, 0.06)",
        boxShadow: lit ? `0 0 0 2px rgba(99,102,241,0.25)` : "none",
        opacity,
        fontSize: 12,
        fontWeight: 600,
        color: lit ? C2.textPrimary : C2.textSecondary,
        whiteSpace: "nowrap",
        overflow: "hidden",
        transition: "opacity 120ms, box-shadow 120ms, border-color 120ms"
      },
      title: d.label,
      children: [
        /* @__PURE__ */ jsx15(
          "span",
          {
            "aria-hidden": true,
            style: {
              flexShrink: 0,
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: accent
            }
          }
        ),
        d.icon ? /* @__PURE__ */ jsx15("span", { "aria-hidden": true, style: { flexShrink: 0 }, children: d.icon }) : null,
        /* @__PURE__ */ jsx15("span", { style: { overflow: "hidden", textOverflow: "ellipsis" }, children: d.label }),
        /* @__PURE__ */ jsx15(Handle3, { type: "target", position: Position4.Top, style: { opacity: 0 } }),
        /* @__PURE__ */ jsx15(Handle3, { type: "source", position: Position4.Bottom, style: { opacity: 0 } })
      ]
    }
  );
}

// src/components/FlowchartView/_internal/snapLinearSuccessors.ts
function snapLinearSuccessors(graph, options = {}) {
  if (graph.nodes.length === 0) return graph;
  const fallbackW = options.nodeWidth ?? DEFAULT_NODE_W2;
  const fallbackH = options.nodeHeight ?? DEFAULT_NODE_H2;
  const byId = /* @__PURE__ */ new Map();
  const width = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) {
    byId.set(n.id, n);
    width.set(n.id, sizeOf(n, fallbackW, fallbackH, options.nodeSize).width);
  }
  const preds = /* @__PURE__ */ new Map();
  const outDegree = /* @__PURE__ */ new Map();
  const seenEdge = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    if (e.data?.kind === "loop") continue;
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    const key = `${e.source}\0${e.target}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    const list = preds.get(e.target);
    if (list) list.push(e.source);
    else preds.set(e.target, [e.source]);
    outDegree.set(e.source, (outDegree.get(e.source) ?? 0) + 1);
  }
  const workingX = /* @__PURE__ */ new Map();
  for (const n of graph.nodes) workingX.set(n.id, n.position.x);
  const centerX = (id) => workingX.get(id) + width.get(id) / 2;
  const order = [...graph.nodes].sort(
    (a, b) => a.position.y - b.position.y || a.position.x - b.position.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  for (const n of order) {
    const p = preds.get(n.id);
    if (!p || p.length !== 1) continue;
    const pid = p[0];
    if ((outDegree.get(pid) ?? 0) !== 1) continue;
    const P = byId.get(pid);
    if ((n.parentId ?? void 0) !== (P.parentId ?? void 0)) continue;
    workingX.set(n.id, centerX(pid) - width.get(n.id) / 2);
  }
  const nodes = graph.nodes.map((n) => {
    const nx = workingX.get(n.id);
    return nx === n.position.x ? n : { ...n, position: { x: nx, y: n.position.y } };
  });
  return { nodes, edges: graph.edges };
}
function createSnappedDagreLayout(base, options = {}) {
  return (graph) => snapLinearSuccessors(base(graph), options);
}

// src/components/FlowchartView/_internal/traceGroupLayout.ts
function buildAdjacency(graph, fallbackW, fallbackH, nodeSize) {
  const preds = /* @__PURE__ */ new Map();
  const branchSuccs = /* @__PURE__ */ new Map();
  const width = /* @__PURE__ */ new Map();
  const height = /* @__PURE__ */ new Map();
  const resolvedStyle = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set();
  for (const n of graph.nodes) {
    ids.add(n.id);
    const s = sizeOf(n, fallbackW, fallbackH, nodeSize);
    width.set(n.id, s.width);
    height.set(n.id, s.height);
    const resolved = nodeSize?.(n);
    if (resolved && resolved.width === s.width && resolved.height === s.height) {
      resolvedStyle.set(n.id, resolved);
    }
    preds.set(n.id, []);
    branchSuccs.set(n.id, []);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    if (e.data?.kind === "loop") continue;
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    const key = `${e.source}\0${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    preds.get(e.target).push(e.source);
    if (e.data?.kind === "fork-branch" || e.data?.kind === "decision-branch") {
      branchSuccs.get(e.source).push(e.target);
    }
  }
  return { preds, branchSuccs, width, height, resolvedStyle };
}
function assignRanks(preds, ids) {
  const rank = /* @__PURE__ */ new Map();
  const inProgress = /* @__PURE__ */ new Set();
  const visit = (id) => {
    const memo4 = rank.get(id);
    if (memo4 !== void 0) return memo4;
    if (inProgress.has(id)) return 0;
    inProgress.add(id);
    const ps = preds.get(id) ?? [];
    let r = 0;
    for (const p of ps) {
      const pr = visit(p);
      if (pr + 1 > r) r = pr + 1;
    }
    inProgress.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const id of ids) visit(id);
  return rank;
}
function spanCenter(ids, center, width) {
  let left = Infinity;
  let right = -Infinity;
  for (const id of ids) {
    const c = center.get(id);
    if (c === void 0) continue;
    const w = width.get(id) ?? 0;
    if (c - w / 2 < left) left = c - w / 2;
    if (c + w / 2 > right) right = c + w / 2;
  }
  if (!Number.isFinite(left)) return 0;
  return (left + right) / 2;
}
function ancestorsOf(start, preds) {
  const seen = /* @__PURE__ */ new Set();
  const stack = [start];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const p of preds.get(n) ?? []) if (!seen.has(p)) stack.push(p);
  }
  return seen;
}
function lowestCommonAncestor(inputs, preds, rank) {
  if (inputs.length === 0) return void 0;
  let common = ancestorsOf(inputs[0], preds);
  for (let i = 1; i < inputs.length && common.size > 0; i++) {
    const a = ancestorsOf(inputs[i], preds);
    common = new Set([...common].filter((x) => a.has(x)));
  }
  let best;
  let bestRank = -Infinity;
  for (const id of common) {
    const r = rank.get(id) ?? -Infinity;
    if (r > bestRank) bestRank = r, best = id;
  }
  return best;
}
function orderBand(ids, preds, center, insertionIndex, siblingOrder) {
  if (siblingOrder && ids.length > 1) {
    const parents = new Set(ids.map((id) => preds.get(id)?.[0]));
    if (parents.size === 1) {
      const parent = [...parents][0];
      if (parent !== void 0) {
        const ordered = siblingOrder(parent, ids);
        const used = /* @__PURE__ */ new Set();
        const out = [];
        for (const id of ordered) if (ids.includes(id) && !used.has(id)) out.push(id), used.add(id);
        for (const id of ids) if (!used.has(id)) out.push(id);
        return out;
      }
    }
  }
  return [...ids].sort((a, b) => {
    const pa = preds.get(a)?.[0];
    const pb = preds.get(b)?.[0];
    const ca = pa !== void 0 ? center.get(pa) : void 0;
    const cb = pb !== void 0 ? center.get(pb) : void 0;
    if (ca !== void 0 && cb !== void 0 && ca !== cb) return ca - cb;
    return (insertionIndex.get(a) ?? 0) - (insertionIndex.get(b) ?? 0);
  });
}
function traceGroupLayout(graph, options = {}) {
  if (graph.nodes.length === 0) return { nodes: graph.nodes, edges: graph.edges };
  if (graph.nodes.length === 1) {
    const only = graph.nodes[0];
    return { nodes: [{ ...only, position: { x: 0, y: 0 } }], edges: graph.edges };
  }
  const rankSep = options.rankSep ?? 80;
  const nodeSep = options.nodeSep ?? 60;
  const fallbackW = options.nodeWidth ?? DEFAULT_NODE_W2;
  const fallbackH = options.nodeHeight ?? DEFAULT_NODE_H2;
  const mergeCentering = options.enableMergeCentering ?? true;
  const mergeAlign = options.mergeAlign ?? "span";
  const ids = graph.nodes.map((n) => n.id);
  const insertionIndex = new Map(ids.map((id, i) => [id, i]));
  const { preds, branchSuccs, width, height, resolvedStyle } = buildAdjacency(
    graph,
    fallbackW,
    fallbackH,
    options.nodeSize
  );
  const rank = assignRanks(preds, ids);
  let maxRank = 0;
  for (const r of rank.values()) if (r > maxRank) maxRank = r;
  for (const id of ids) if (!rank.has(id)) rank.set(id, maxRank + 1);
  maxRank = 0;
  for (const r of rank.values()) if (r > maxRank) maxRank = r;
  const byRank = /* @__PURE__ */ new Map();
  const bandMaxH = /* @__PURE__ */ new Map();
  for (const id of ids) {
    const r = rank.get(id);
    (byRank.get(r) ?? byRank.set(r, []).get(r)).push(id);
    bandMaxH.set(r, Math.max(bandMaxH.get(r) ?? 0, height.get(id)));
  }
  const bandTop = /* @__PURE__ */ new Map();
  let yAcc = 0;
  for (let r = 0; r <= maxRank; r++) {
    bandTop.set(r, yAcc);
    yAcc += (bandMaxH.get(r) ?? fallbackH) + rankSep;
  }
  const center = /* @__PURE__ */ new Map();
  const mergeCenterX = (ps) => {
    if (mergeAlign === "fork-origin") {
      const lca = lowestCommonAncestor(ps, preds, rank);
      const lcaC = lca !== void 0 ? center.get(lca) : void 0;
      if (lcaC !== void 0) return lcaC;
    }
    return spanCenter(ps, center, width);
  };
  for (let r = 0; r <= maxRank; r++) {
    const band = orderBand(byRank.get(r) ?? [], preds, center, insertionIndex, options.siblingOrder);
    let cursor = -Infinity;
    let i = 0;
    while (i < band.length) {
      const id = band[i];
      const ps = preds.get(id) ?? [];
      const parent = ps.length === 1 ? ps[0] : void 0;
      const parentBranches = parent !== void 0 ? branchSuccs.get(parent) ?? [] : [];
      const isForkChild = parent !== void 0 && parentBranches.length >= 2 && parentBranches.includes(id);
      if (isForkChild) {
        const run = [];
        let j = i;
        while (j < band.length) {
          const cand = band[j];
          const cps = preds.get(cand) ?? [];
          if (cps.length === 1 && cps[0] === parent && parentBranches.includes(cand)) run.push(cand), j++;
          else break;
        }
        const totalW = run.reduce((s, rid) => s + width.get(rid), 0) + (run.length - 1) * nodeSep;
        let left = (center.get(parent) ?? 0) - totalW / 2;
        if (cursor !== -Infinity && left < cursor) left = cursor;
        let x = left;
        for (const rid of run) {
          const w = width.get(rid);
          center.set(rid, x + w / 2);
          x += w + nodeSep;
        }
        cursor = x;
        i = j;
      } else {
        const w = width.get(id);
        let desired;
        if (ps.length === 0) desired = (cursor === -Infinity ? 0 : cursor) + w / 2;
        else if (ps.length === 1) desired = center.get(ps[0]) ?? 0;
        else desired = mergeCenterX(ps);
        const cursorCenter = cursor === -Infinity ? -Infinity : cursor + w / 2;
        const c = Math.max(cursorCenter, desired);
        center.set(id, c);
        cursor = c + w / 2 + nodeSep;
        i++;
      }
    }
  }
  if (mergeCentering) {
    for (let r = maxRank; r >= 1; r--) {
      for (const id of byRank.get(r) ?? []) {
        const ps = preds.get(id) ?? [];
        if (ps.length > 1) center.set(id, mergeCenterX(ps));
      }
    }
  }
  const centerById = center;
  const positioned = graph.nodes.map((n) => {
    const r = rank.get(n.id);
    const w = width.get(n.id);
    const h = height.get(n.id);
    let x = (centerById.get(n.id) ?? 0) - w / 2;
    let y = (bandTop.get(r) ?? 0) + ((bandMaxH.get(r) ?? h) - h) / 2;
    if (n.parentId) {
      const pr = rank.get(n.parentId);
      const pw = width.get(n.parentId);
      const ph = height.get(n.parentId);
      if (pr !== void 0 && pw !== void 0 && ph !== void 0) {
        const parentX = (centerById.get(n.parentId) ?? 0) - pw / 2;
        const parentY = (bandTop.get(pr) ?? 0) + ((bandMaxH.get(pr) ?? ph) - ph) / 2;
        x -= parentX;
        y -= parentY;
      }
    }
    const styleSize = resolvedStyle.get(n.id);
    if (styleSize) {
      return { ...n, position: { x, y }, style: { ...n.style ?? {}, width: styleSize.width, height: styleSize.height } };
    }
    return { ...n, position: { x, y } };
  });
  return { nodes: positioned, edges: graph.edges };
}
function createTraceGroupLayout(options = {}) {
  return (graph) => traceGroupLayout(graph, options);
}

// src/components/FlowchartView/createNodeViewRecorder.ts
function baseStageIdOf(runtimeStageId) {
  const hashIdx = runtimeStageId.indexOf("#");
  return hashIdx >= 0 ? runtimeStageId.slice(0, hashIdx) : runtimeStageId;
}
function createNodeViewRecorder(options) {
  const id = options.id ?? "node-view";
  const structure = options.structure;
  if (!structure) {
    throw new Error(
      "[createNodeViewRecorder] `structure` option is required. Pass the handle returned by `createTraceStructureRecorder()`."
    );
  }
  let executionsOf = /* @__PURE__ */ new Map();
  let commitRefsOf = /* @__PURE__ */ new Map();
  let stageIdOfRuntimeStageId = /* @__PURE__ */ new Map();
  const notifier = createNotifier("node-view");
  const unsubStructure = structure.subscribe(() => notifier.notify());
  function recordExecution(event) {
    const rsid = event.traversalContext?.runtimeStageId;
    if (!rsid) {
      devWarn(
        () => `[createNodeViewRecorder] onStageExecuted event without traversalContext.runtimeStageId \u2014 execution attribution dropped (stage=${event.stageName}).`
      );
      return;
    }
    const stageId = asStageId(baseStageIdOf(rsid));
    const runtimeStageId = asRuntimeStageId(rsid);
    const execList = executionsOf.get(stageId) ?? [];
    const record = {
      runtimeStageId,
      ...event.traversalContext.iteration !== void 0 && {
        iteration: event.traversalContext.iteration
      },
      ...event.startTime !== void 0 && { startMs: event.startTime },
      ...event.endTime !== void 0 && { endMs: event.endTime }
    };
    execList.push(record);
    executionsOf.set(stageId, execList);
    stageIdOfRuntimeStageId.set(runtimeStageId, stageId);
    notifier.notify();
  }
  function recordError(event) {
    const rsid = event.traversalContext?.runtimeStageId;
    if (!rsid) {
      devWarn(
        () => `[createNodeViewRecorder] onError event without traversalContext.runtimeStageId \u2014 error attribution dropped (stage=${event.stageName}).`
      );
      return;
    }
    const stageId = asStageId(baseStageIdOf(rsid));
    const runtimeStageId = asRuntimeStageId(rsid);
    const execList = executionsOf.get(stageId);
    const matchIdx = execList ? execList.findIndex((e) => e.runtimeStageId === runtimeStageId) : -1;
    if (!execList || matchIdx === -1) {
      const synth = {
        runtimeStageId,
        errorMessage: event.message ?? "error"
      };
      if (execList) {
        execList.push(synth);
      } else {
        executionsOf.set(stageId, [synth]);
      }
    } else {
      const match = execList[matchIdx];
      execList[matchIdx] = { ...match, errorMessage: event.message ?? "error" };
    }
    stageIdOfRuntimeStageId.set(runtimeStageId, stageId);
    notifier.notify();
  }
  function recordCommit(event) {
    const rsid = event.runtimeStageId;
    if (!rsid) {
      devWarn(
        () => `[createNodeViewRecorder] onCommit event without runtimeStageId \u2014 commit attribution dropped (stage=${event.stage ?? event.stageId ?? "?"}).`
      );
      return;
    }
    const stageId = asStageId(baseStageIdOf(rsid));
    const refs = commitRefsOf.get(stageId) ?? [];
    refs.push(asRuntimeStageId(rsid));
    commitRefsOf.set(stageId, refs);
    stageIdOfRuntimeStageId.set(asRuntimeStageId(rsid), stageId);
    notifier.notify();
  }
  const recorder = {
    id,
    onStageExecuted: recordExecution,
    onError: recordError,
    onCommit: recordCommit,
    // onRunStart / onRunEnd — no-op for now (state stays alive across
    // runs; consumers call .reset() between runs if they want fresh
    // state). Listed for shape conformance with FlowRecorder.
    onRunStart() {
    },
    onRunEnd() {
    }
  };
  function buildView(structNode) {
    const stageId = asStageId(structNode.id);
    const execs = executionsOf.get(stageId) ?? [];
    const commitRefs = commitRefsOf.get(stageId) ?? [];
    const visitedInRun = execs.length > 0;
    const executionCount = execs.length;
    const firstExecutedAt = execs.length > 0 && execs[0].startMs !== void 0 ? execs[0].startMs : null;
    const lastExecutedAt = execs.length > 0 && execs[execs.length - 1].endMs !== void 0 ? execs[execs.length - 1].endMs : null;
    let totalDurationMs = 0;
    let errorCount = 0;
    for (const e of execs) {
      if (e.startMs !== void 0 && e.endMs !== void 0) {
        totalDurationMs += e.endMs - e.startMs;
      }
      if (e.errorMessage) errorCount++;
    }
    const d = structNode.data;
    return {
      stageId,
      label: d.label,
      type: structNode.type ?? "stage",
      isDecider: d.isDecider,
      isFork: d.isFork,
      isSubflow: d.isSubflow,
      isStreaming: d.isStreaming,
      isPausable: d.isPausable === true,
      ...d.description !== void 0 && { description: d.description },
      ...d.icon !== void 0 && { icon: d.icon },
      ...d.subflowId !== void 0 && { subflowId: d.subflowId },
      // L8.1 Panel 2 must-fix: branchIds is a live ref from the
      // structure translator's internal graph — defensive copy via
      // slice() prevents consumer mutation from corrupting it.
      ...d.branchIds !== void 0 && { branchIds: d.branchIds.slice() },
      ...d.defaultBranch !== void 0 && { defaultBranch: d.defaultBranch },
      // Note: structure translator always sets prevIds/nextIds (never
      // undefined). The slice() copies defend against consumer mutation.
      prevIds: d.prevIds.slice(),
      nextIds: d.nextIds.slice(),
      executions: execs.map((e) => ({ ...e })),
      visitedInRun,
      executionCount,
      firstExecutedAt,
      lastExecutedAt,
      totalDurationMs,
      errorCount,
      commitRuntimeStageIds: commitRefs.slice()
    };
  }
  let cachedIndex = null;
  let cachedOwnVersion = -1;
  let cachedStructureVersion = -1;
  return {
    recorder,
    getIndex() {
      const own = notifier.version();
      const struct = structure.version();
      if (cachedIndex !== null && cachedOwnVersion === own && cachedStructureVersion === struct) {
        return cachedIndex;
      }
      const graphRef = structure.getGraphRef();
      const byStageId = /* @__PURE__ */ new Map();
      const byRuntimeStageId = /* @__PURE__ */ new Map();
      const all = [];
      for (const structNode of graphRef.nodes) {
        const view = buildView(structNode);
        byStageId.set(view.stageId, view);
        all.push(view);
        for (const exec of view.executions) {
          byRuntimeStageId.set(exec.runtimeStageId, view);
        }
        for (const rsid of view.commitRuntimeStageIds) {
          byRuntimeStageId.set(rsid, view);
        }
      }
      cachedIndex = { byStageId, byRuntimeStageId, all };
      cachedOwnVersion = own;
      cachedStructureVersion = struct;
      return cachedIndex;
    },
    subscribe: notifier.subscribe,
    version: notifier.version,
    reset() {
      executionsOf = /* @__PURE__ */ new Map();
      commitRefsOf = /* @__PURE__ */ new Map();
      stageIdOfRuntimeStageId = /* @__PURE__ */ new Map();
      cachedIndex = null;
      cachedOwnVersion = -1;
      cachedStructureVersion = -1;
      void unsubStructure;
    }
  };
}

// src/components/FlowchartView/createCommitFlowRecorder.ts
function baseStageIdOf2(runtimeStageId) {
  const hashIdx = runtimeStageId.indexOf("#");
  return hashIdx >= 0 ? runtimeStageId.slice(0, hashIdx) : runtimeStageId;
}
function createCommitFlowRecorder(options) {
  const id = options.id ?? "commit-flow";
  const structure = options.structure;
  if (!structure) {
    throw new Error(
      "[createCommitFlowRecorder] `structure` option is required. Pass the handle returned by `createTraceStructureRecorder()`."
    );
  }
  let rawCommits = [];
  const notifier = createNotifier("commit-flow");
  const unsubStructure = structure.subscribe(() => notifier.notify());
  function recordCommit(event) {
    const rsid = event.runtimeStageId;
    if (!rsid) {
      devWarn(
        () => `[createCommitFlowRecorder] onCommit without runtimeStageId \u2014 commit dropped (stage=${event.stage ?? event.stageId ?? "?"}).`
      );
      return;
    }
    const stageId = asStageId(baseStageIdOf2(rsid));
    rawCommits.push({
      runtimeStageId: asRuntimeStageId(rsid),
      stageId,
      commitIdx: rawCommits.length,
      updates: event.updates ? { ...event.updates } : {},
      reads: event.reads ? [...event.reads] : []
    });
    notifier.notify();
  }
  const recorder = {
    id,
    onCommit: recordCommit,
    onStageExecuted() {
    },
    onError() {
    },
    onRunStart() {
    },
    onRunEnd() {
    }
  };
  function buildIndex() {
    const graphRef = structure.getGraphRef();
    const nodeByStageId = /* @__PURE__ */ new Map();
    for (const n of graphRef.nodes) nodeByStageId.set(n.id, n);
    const writersOf = /* @__PURE__ */ new Map();
    for (const rc of rawCommits) {
      for (const k of Object.keys(rc.updates)) {
        const list = writersOf.get(k) ?? [];
        list.push({ commitIdx: rc.commitIdx, runtimeStageId: rc.runtimeStageId });
        writersOf.set(k, list);
      }
    }
    const commitsOfStage = /* @__PURE__ */ new Map();
    for (const rc of rawCommits) {
      const list = commitsOfStage.get(rc.stageId) ?? [];
      list.push(rc.commitIdx);
      commitsOfStage.set(rc.stageId, list);
    }
    const commits = [];
    const byRuntimeStageId = /* @__PURE__ */ new Map();
    const dataEdges = [];
    for (const rc of rawCommits) {
      const structNode = nodeByStageId.get(rc.stageId);
      const structuralPrevIds = (structNode?.data.prevIds ?? []).slice();
      const structuralNextIds = (structNode?.data.nextIds ?? []).slice();
      const runtimePrevIds = [];
      for (const pStageId of structuralPrevIds) {
        const list = commitsOfStage.get(pStageId);
        if (!list) continue;
        let chosenIdx = null;
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i] < rc.commitIdx) {
            chosenIdx = list[i];
            break;
          }
        }
        if (chosenIdx !== null) {
          runtimePrevIds.push(rawCommits[chosenIdx].runtimeStageId);
        }
      }
      const runtimeNextIds = [];
      for (const nStageId of structuralNextIds) {
        const list = commitsOfStage.get(nStageId);
        if (!list) continue;
        let chosenIdx = null;
        for (let i = 0; i < list.length; i++) {
          if (list[i] > rc.commitIdx) {
            chosenIdx = list[i];
            break;
          }
        }
        if (chosenIdx !== null) {
          runtimeNextIds.push(rawCommits[chosenIdx].runtimeStageId);
        }
      }
      const dataDependencies = [];
      for (const key of rc.reads) {
        const writers = writersOf.get(key);
        let source = null;
        if (writers) {
          for (let i = writers.length - 1; i >= 0; i--) {
            if (writers[i].commitIdx < rc.commitIdx) {
              source = writers[i];
              break;
            }
          }
        }
        if (source) {
          dataDependencies.push({
            key,
            sourceRuntimeStageId: source.runtimeStageId,
            sourceCommitIdx: source.commitIdx
          });
          dataEdges.push(
            Object.freeze({ from: source.commitIdx, to: rc.commitIdx, key })
          );
        } else {
          dataDependencies.push({
            key,
            sourceRuntimeStageId: null,
            sourceCommitIdx: null
          });
        }
      }
      const view = {
        runtimeStageId: rc.runtimeStageId,
        stageId: rc.stageId,
        commitIdx: rc.commitIdx,
        structuralPrevIds,
        structuralNextIds,
        runtimePrevIds,
        runtimeNextIds,
        dataDependencies,
        updates: { ...rc.updates },
        reads: rc.reads.slice()
      };
      commits.push(view);
      byRuntimeStageId.set(view.runtimeStageId, view);
    }
    return { commits, byRuntimeStageId, dataEdges };
  }
  let cachedIndex = null;
  let cachedOwnVersion = -1;
  let cachedStructureVersion = -1;
  return {
    recorder,
    getIndex() {
      const own = notifier.version();
      const struct = structure.version();
      if (cachedIndex !== null && cachedOwnVersion === own && cachedStructureVersion === struct) {
        return cachedIndex;
      }
      cachedIndex = buildIndex();
      cachedOwnVersion = own;
      cachedStructureVersion = struct;
      return cachedIndex;
    },
    subscribe: notifier.subscribe,
    version: notifier.version,
    reset() {
      rawCommits = [];
      cachedIndex = null;
      cachedOwnVersion = -1;
      cachedStructureVersion = -1;
      void unsubStructure;
    }
  };
}
function backtraceDataFlow(index, startRuntimeStageId) {
  const start = index.byRuntimeStageId.get(startRuntimeStageId);
  if (!start) return [];
  const visitedIdx = /* @__PURE__ */ new Set([start.commitIdx]);
  const queue = [start.commitIdx];
  const collectedIdxs = /* @__PURE__ */ new Set([start.commitIdx]);
  let head = 0;
  while (head < queue.length) {
    const cur = index.commits[queue[head++]];
    if (!cur) continue;
    for (const dep of cur.dataDependencies) {
      if (dep.sourceCommitIdx === null) continue;
      if (visitedIdx.has(dep.sourceCommitIdx)) continue;
      visitedIdx.add(dep.sourceCommitIdx);
      collectedIdxs.add(dep.sourceCommitIdx);
      queue.push(dep.sourceCommitIdx);
    }
  }
  return Array.from(collectedIdxs).sort((a, b) => a - b).map((idx) => index.commits[idx]).filter((c) => c !== void 0);
}

// src/components/FlowchartView/createTraceBundle.ts
function createTraceBundle(options = {}) {
  const structure = createTraceStructureRecorder(options.structure);
  const runtimeOverlay = createTraceRuntimeOverlay(options.runtimeOverlay);
  const nodeView = createNodeViewRecorder({
    ...options.nodeView ?? {},
    structure
  });
  const commitFlow = createCommitFlowRecorder({
    ...options.commitFlow ?? {},
    structure
  });
  return {
    structure,
    runtimeOverlay,
    nodeView,
    commitFlow,
    attachTo(executor) {
      executor.attachFlowRecorder(runtimeOverlay.recorder);
      executor.attachFlowRecorder(nodeView.recorder);
      executor.attachFlowRecorder(commitFlow.recorder);
      if (typeof executor.attachScopeRecorder === "function") {
        executor.attachScopeRecorder(nodeView.recorder);
        executor.attachScopeRecorder(commitFlow.recorder);
      } else {
        devWarn(
          () => "[createTraceBundle] executor.attachScopeRecorder is missing \u2014 NodeView.commitRuntimeStageIds[] AND CommitFlow.commits[] will be empty. Upgrade to footprintjs v6.0+."
        );
      }
    }
  };
}

// src/components/FlowchartView/_internal/useTranslator.ts
import { useMemo as useMemo8, useSyncExternalStore as useSyncExternalStore2 } from "react";
function useTranslator(handle, getSnapshot) {
  const subscribe = useMemo8(() => handle.subscribe.bind(handle), [handle]);
  const getVersion = useMemo8(() => handle.version.bind(handle), [handle]);
  const version = useSyncExternalStore2(subscribe, getVersion, getVersion);
  return useMemo8(() => getSnapshot(), [version, getSnapshot]);
}

// src/components/FlowchartView/walkHelpers.ts
function walkForward(index, startId, options = {}) {
  return bfsWalk(index, startId, (n) => n.nextIds, options);
}
function walkBackward(index, startId, options = {}) {
  return bfsWalk(index, startId, (n) => n.prevIds, options);
}
function backtraceStructural(index, stageId, options = {}) {
  const start = index.byStageId.get(stageId);
  if (!start) return [];
  const chain = [start];
  const cap = options.maxDepth ?? index.all.length;
  const visited = /* @__PURE__ */ new Set([stageId]);
  let cur = start;
  let hops = 0;
  while (cur && hops < cap) {
    if (cur.prevIds.length === 0 || cur.prevIds.length > 1) {
      break;
    }
    const nextId = cur.prevIds[0];
    if (visited.has(nextId)) break;
    visited.add(nextId);
    const next = index.byStageId.get(nextId);
    if (!next) break;
    if (options.onlyVisited && !next.visitedInRun) break;
    chain.unshift(next);
    cur = next;
    hops++;
  }
  return chain;
}
function forwardtraceStructural(index, stageId, options = {}) {
  const start = index.byStageId.get(stageId);
  if (!start) return [];
  const chain = [start];
  const cap = options.maxDepth ?? index.all.length;
  const visited = /* @__PURE__ */ new Set([stageId]);
  let cur = start;
  let hops = 0;
  while (cur && hops < cap) {
    if (cur.nextIds.length === 0 || cur.nextIds.length > 1) break;
    const nextId = cur.nextIds[0];
    if (visited.has(nextId)) break;
    visited.add(nextId);
    const next = index.byStageId.get(nextId);
    if (!next) break;
    if (options.onlyVisited && !next.visitedInRun) break;
    chain.push(next);
    cur = next;
    hops++;
  }
  return chain;
}
function bfsWalk(index, startId, neighborsOf, options) {
  const start = index.byStageId.get(startId);
  if (!start) return [];
  const cap = options.maxDepth ?? index.all.length;
  const visited = /* @__PURE__ */ new Set();
  visited.add(startId);
  const out = [];
  if (options.includeStart) out.push(start);
  const queue = [[start, 0]];
  let head = 0;
  while (head < queue.length) {
    const [node, depth] = queue[head++];
    if (depth >= cap) continue;
    for (const neighborId of neighborsOf(node)) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      const neighbor = index.byStageId.get(neighborId);
      if (!neighbor) continue;
      if (options.onlyVisited && !neighbor.visitedInRun) continue;
      out.push(neighbor);
      queue.push([neighbor, depth + 1]);
    }
  }
  return out;
}

// src/components/FlowchartView/NodeInspector.tsx
import { useMemo as useMemo9 } from "react";
import { Fragment as Fragment3, jsx as jsx16, jsxs as jsxs13 } from "react/jsx-runtime";
function NodeInspector({
  index,
  selectedId,
  onNavigate,
  onlyVisited = false,
  className,
  style
}) {
  const view = selectedId ? index.byStageId.get(selectedId) ?? null : null;
  const prevChain = useMemo9(
    () => view ? backtraceStructural(index, view.stageId, { onlyVisited }) : [],
    [index, view, onlyVisited]
  );
  const nextChain = useMemo9(
    () => view ? forwardtraceStructural(index, view.stageId, { onlyVisited }) : [],
    [index, view, onlyVisited]
  );
  if (!view) {
    return /* @__PURE__ */ jsx16(
      "div",
      {
        className,
        style: {
          padding: 16,
          color: theme.textMuted,
          fontStyle: "italic",
          ...style
        },
        children: "Select a stage to inspect."
      }
    );
  }
  return /* @__PURE__ */ jsxs13(
    "div",
    {
      className,
      style: {
        padding: 14,
        color: theme.textPrimary,
        fontSize: 13,
        overflow: "auto",
        ...style
      },
      children: [
        /* @__PURE__ */ jsxs13("div", { style: { marginBottom: 16 }, children: [
          /* @__PURE__ */ jsx16("div", { style: { fontSize: 16, fontWeight: 700, color: theme.textPrimary }, children: view.label }),
          /* @__PURE__ */ jsxs13("div", { style: { fontSize: 11, fontFamily: "monospace", color: theme.textMuted, marginTop: 2 }, children: [
            view.stageId,
            " \xB7 ",
            view.type,
            view.isDecider && " \xB7 decider",
            view.isFork && " \xB7 fork",
            view.isSubflow && " \xB7 subflow",
            view.isStreaming && " \xB7 streaming",
            view.isPausable && " \xB7 pausable"
          ] }),
          view.description && /* @__PURE__ */ jsx16("div", { style: { fontSize: 12, color: theme.textSecondary, marginTop: 6 }, children: view.description })
        ] }),
        /* @__PURE__ */ jsxs13(Section, { title: "Runtime", children: [
          /* @__PURE__ */ jsx16(Row, { label: "Visited", value: view.visitedInRun ? "yes" : "no" }),
          view.visitedInRun && /* @__PURE__ */ jsxs13(Fragment3, { children: [
            /* @__PURE__ */ jsx16(Row, { label: "Executions", value: String(view.executionCount) }),
            view.firstExecutedAt !== null && /* @__PURE__ */ jsx16(Row, { label: "First at", value: `${view.firstExecutedAt.toFixed(1)}ms` }),
            view.lastExecutedAt !== null && /* @__PURE__ */ jsx16(Row, { label: "Last at", value: `${view.lastExecutedAt.toFixed(1)}ms` }),
            view.totalDurationMs > 0 && /* @__PURE__ */ jsx16(Row, { label: "Total", value: `${view.totalDurationMs.toFixed(1)}ms` }),
            view.errorCount > 0 && /* @__PURE__ */ jsx16(Row, { label: "Errors", value: String(view.errorCount), valueColor: theme.error })
          ] })
        ] }),
        prevChain.length > 1 && /* @__PURE__ */ jsx16(Section, { title: `Prev chain (${prevChain.length - 1} hops)`, children: /* @__PURE__ */ jsx16(Crumbs, { nodes: prevChain.slice(0, -1), onClick: onNavigate }) }),
        view.prevIds.length > 1 && /* @__PURE__ */ jsx16(Section, { title: "Multiple prev (convergence)", children: /* @__PURE__ */ jsx16(
          Crumbs,
          {
            nodes: view.prevIds.map((id) => index.byStageId.get(id)).filter((n) => n !== void 0),
            onClick: onNavigate
          }
        ) }),
        nextChain.length > 1 && /* @__PURE__ */ jsx16(Section, { title: `Next chain (${nextChain.length - 1} hops)`, children: /* @__PURE__ */ jsx16(Crumbs, { nodes: nextChain.slice(1), onClick: onNavigate }) }),
        view.nextIds.length > 1 && /* @__PURE__ */ jsx16(Section, { title: "Multiple next (fork/decider)", children: /* @__PURE__ */ jsx16(
          Crumbs,
          {
            nodes: view.nextIds.map((id) => index.byStageId.get(id)).filter((n) => n !== void 0),
            onClick: onNavigate
          }
        ) }),
        view.commitRuntimeStageIds.length > 0 && /* @__PURE__ */ jsx16(Section, { title: `Commits (${view.commitRuntimeStageIds.length})`, children: /* @__PURE__ */ jsx16("div", { style: { fontFamily: "monospace", fontSize: 11, color: theme.textSecondary }, children: view.commitRuntimeStageIds.map((rsid) => /* @__PURE__ */ jsx16("div", { children: rsid }, rsid)) }) })
      ]
    }
  );
}
function Section({ title, children }) {
  return /* @__PURE__ */ jsxs13("div", { style: { marginBottom: 14 }, children: [
    /* @__PURE__ */ jsx16(
      "div",
      {
        style: {
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: theme.textMuted,
          marginBottom: 6
        },
        children: title
      }
    ),
    children
  ] });
}
function Row({ label, value, valueColor }) {
  return /* @__PURE__ */ jsxs13("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 12, padding: "2px 0" }, children: [
    /* @__PURE__ */ jsx16("span", { style: { color: theme.textMuted }, children: label }),
    /* @__PURE__ */ jsx16("span", { style: { color: valueColor ?? theme.textSecondary, fontFamily: "monospace" }, children: value })
  ] });
}
function Crumbs({ nodes, onClick }) {
  if (nodes.length === 0) return null;
  return /* @__PURE__ */ jsx16("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: nodes.map((n, i) => /* @__PURE__ */ jsxs13("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
    /* @__PURE__ */ jsx16(
      "button",
      {
        onClick: onClick ? () => onClick(n.stageId) : void 0,
        style: {
          fontSize: 11,
          fontFamily: "monospace",
          padding: "3px 8px",
          borderRadius: 4,
          border: `1px solid ${theme.border}`,
          background: "transparent",
          color: n.visitedInRun ? theme.success : theme.textSecondary,
          cursor: onClick ? "pointer" : "default"
        },
        children: n.label
      }
    ),
    i < nodes.length - 1 && /* @__PURE__ */ jsx16("span", { style: { color: theme.textMuted, fontSize: 10 }, children: "\u203A" })
  ] }, n.stageId)) });
}

// src/components/FlowchartView/CommitInspector.tsx
import { useMemo as useMemo10 } from "react";
import { jsx as jsx17, jsxs as jsxs14 } from "react/jsx-runtime";
function CommitInspector({
  index,
  selectedRuntimeStageId,
  onNavigate,
  className,
  style
}) {
  const view = selectedRuntimeStageId ? index.byRuntimeStageId.get(selectedRuntimeStageId) ?? null : null;
  const lineage = useMemo10(
    () => view ? backtraceDataFlow(index, view.runtimeStageId) : [],
    [index, view]
  );
  if (!view) {
    return /* @__PURE__ */ jsx17(
      "div",
      {
        className,
        style: {
          padding: 16,
          color: theme.textMuted,
          fontStyle: "italic",
          ...style
        },
        children: "Select a commit to inspect."
      }
    );
  }
  return /* @__PURE__ */ jsxs14(
    "div",
    {
      className,
      style: {
        padding: 14,
        color: theme.textPrimary,
        fontSize: 13,
        overflow: "auto",
        ...style
      },
      children: [
        /* @__PURE__ */ jsxs14("div", { style: { marginBottom: 16 }, children: [
          /* @__PURE__ */ jsx17("div", { style: { fontSize: 16, fontWeight: 700, color: theme.textPrimary }, children: view.stageId }),
          /* @__PURE__ */ jsxs14(
            "div",
            {
              style: {
                fontSize: 11,
                fontFamily: "monospace",
                color: theme.textMuted,
                marginTop: 2
              },
              children: [
                view.runtimeStageId,
                " \xB7 commitIdx ",
                view.commitIdx
              ]
            }
          )
        ] }),
        view.structuralPrevIds.length > 0 && /* @__PURE__ */ jsx17(Section2, { title: "Structural prev (chart shape)", children: /* @__PURE__ */ jsx17(PlainTags, { labels: view.structuralPrevIds }) }),
        view.structuralNextIds.length > 0 && /* @__PURE__ */ jsx17(Section2, { title: "Structural next (chart shape)", children: /* @__PURE__ */ jsx17(PlainTags, { labels: view.structuralNextIds }) }),
        view.runtimePrevIds.length > 0 && /* @__PURE__ */ jsx17(Section2, { title: "Runtime prev (this execution)", children: /* @__PURE__ */ jsx17(RuntimeRefs, { refs: view.runtimePrevIds, onClick: onNavigate }) }),
        view.runtimeNextIds.length > 0 && /* @__PURE__ */ jsx17(Section2, { title: "Runtime next (this execution)", children: /* @__PURE__ */ jsx17(RuntimeRefs, { refs: view.runtimeNextIds, onClick: onNavigate }) }),
        Object.keys(view.updates).length > 0 && /* @__PURE__ */ jsx17(Section2, { title: `Updates (${Object.keys(view.updates).length})`, children: /* @__PURE__ */ jsx17(KeyValueGrid, { entries: Object.entries(view.updates) }) }),
        view.reads.length > 0 && /* @__PURE__ */ jsx17(Section2, { title: `Reads (${view.reads.length})`, children: /* @__PURE__ */ jsx17(PlainTags, { labels: view.reads }) }),
        view.dataDependencies.length > 0 && /* @__PURE__ */ jsx17(Section2, { title: `Data dependencies (${view.dataDependencies.length})`, children: /* @__PURE__ */ jsx17("table", { style: { fontSize: 11, fontFamily: "monospace", width: "100%", borderCollapse: "collapse" }, children: /* @__PURE__ */ jsx17("tbody", { children: view.dataDependencies.map((dep) => /* @__PURE__ */ jsxs14("tr", { children: [
          /* @__PURE__ */ jsx17("td", { style: { color: theme.textSecondary, padding: "2px 8px 2px 0" }, children: dep.key }),
          /* @__PURE__ */ jsx17("td", { style: { color: dep.sourceRuntimeStageId ? theme.textPrimary : theme.textMuted }, children: dep.sourceRuntimeStageId ? /* @__PURE__ */ jsxs14(
            "button",
            {
              onClick: onNavigate ? () => onNavigate(dep.sourceRuntimeStageId) : void 0,
              style: crumbButtonStyle(onNavigate !== void 0),
              children: [
                "\u2190 ",
                dep.sourceRuntimeStageId
              ]
            }
          ) : /* @__PURE__ */ jsx17("em", { children: "(no prior writer \u2014 default or external)" }) })
        ] }, dep.key)) }) }) }),
        lineage.length > 1 && /* @__PURE__ */ jsx17(Section2, { title: `Lineage chain (${lineage.length - 1} ancestor commits)`, children: /* @__PURE__ */ jsx17("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: lineage.slice(0, -1).map((c, i) => /* @__PURE__ */ jsxs14("span", { style: { display: "inline-flex", alignItems: "center", gap: 4 }, children: [
          /* @__PURE__ */ jsx17(
            "button",
            {
              onClick: onNavigate ? () => onNavigate(c.runtimeStageId) : void 0,
              style: crumbButtonStyle(onNavigate !== void 0),
              children: c.runtimeStageId
            }
          ),
          i < lineage.length - 2 && /* @__PURE__ */ jsx17("span", { style: { color: theme.textMuted, fontSize: 10 }, children: "\u2192" })
        ] }, c.runtimeStageId)) }) })
      ]
    }
  );
}
function Section2({ title, children }) {
  return /* @__PURE__ */ jsxs14("div", { style: { marginBottom: 14 }, children: [
    /* @__PURE__ */ jsx17(
      "div",
      {
        style: {
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: theme.textMuted,
          marginBottom: 6
        },
        children: title
      }
    ),
    children
  ] });
}
function PlainTags({ labels }) {
  return /* @__PURE__ */ jsx17("div", { style: { display: "flex", flexWrap: "wrap", gap: 4 }, children: labels.map((l) => /* @__PURE__ */ jsx17(
    "span",
    {
      style: {
        fontSize: 11,
        fontFamily: "monospace",
        padding: "2px 6px",
        borderRadius: 3,
        background: "var(--fp-bg-secondary, transparent)",
        color: theme.textSecondary
      },
      children: l
    },
    l
  )) });
}
function RuntimeRefs({
  refs,
  onClick
}) {
  return /* @__PURE__ */ jsx17("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 }, children: refs.map((r) => /* @__PURE__ */ jsx17(
    "button",
    {
      onClick: onClick ? () => onClick(r) : void 0,
      style: crumbButtonStyle(onClick !== void 0),
      children: r
    },
    r
  )) });
}
function KeyValueGrid({ entries }) {
  return /* @__PURE__ */ jsx17("table", { style: { fontSize: 11, fontFamily: "monospace", width: "100%", borderCollapse: "collapse" }, children: /* @__PURE__ */ jsx17("tbody", { children: entries.map(([k, v2]) => /* @__PURE__ */ jsxs14("tr", { children: [
    /* @__PURE__ */ jsx17("td", { style: { color: theme.textSecondary, padding: "2px 8px 2px 0", verticalAlign: "top" }, children: k }),
    /* @__PURE__ */ jsx17("td", { style: { color: theme.textPrimary, wordBreak: "break-word" }, children: typeof v2 === "object" ? JSON.stringify(v2) : String(v2) })
  ] }, k)) }) });
}
function crumbButtonStyle(clickable) {
  return {
    fontSize: 11,
    fontFamily: "monospace",
    padding: "3px 8px",
    borderRadius: 4,
    border: `1px solid ${theme.border}`,
    background: "transparent",
    color: theme.textSecondary,
    cursor: clickable ? "pointer" : "default"
  };
}

// src/components/FlowchartView/buildCommitChainTree.ts
function indexGraph(graph) {
  const byStageId = /* @__PURE__ */ new Map();
  const allNodeIds = [];
  for (const node of graph.nodes) {
    const stageId = asStageId(node.id);
    allNodeIds.push(stageId);
    byStageId.set(stageId, { branchChildren: [], linearNext: [] });
  }
  for (const edge of graph.edges) {
    const kind = edge.data?.kind;
    if (kind === "loop") continue;
    const sourceEntry = byStageId.get(asStageId(edge.source));
    if (!sourceEntry) continue;
    const target = asStageId(edge.target);
    if (!byStageId.has(target)) continue;
    if (kind === "fork-branch" || kind === "decision-branch") {
      sourceEntry.branchChildren.push(target);
    } else {
      sourceEntry.linearNext.push(target);
    }
  }
  return { byStageId, allNodeIds };
}
function findSeed(graph, fromStageId) {
  if (fromStageId) {
    const n = graph.nodes.find((n2) => n2.id === fromStageId);
    return n ? asStageId(n.id) : null;
  }
  const hasIncoming = /* @__PURE__ */ new Set();
  for (const e of graph.edges) {
    if (e.data?.kind !== "loop") hasIncoming.add(e.target);
  }
  const seed = graph.nodes.find((n) => !hasIncoming.has(n.id)) ?? graph.nodes[0];
  return seed ? asStageId(seed.id) : null;
}
function bfsReachable(startId, index) {
  const reachable = /* @__PURE__ */ new Set([startId]);
  const order = [startId];
  const queue = [startId];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const entry = index.byStageId.get(cur);
    if (!entry) continue;
    for (const next of [...entry.branchChildren, ...entry.linearNext]) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      order.push(next);
      queue.push(next);
    }
  }
  return { order, reachable };
}
function findConvergence(branches, index) {
  if (branches.length < 2) return null;
  const firstWalk = bfsReachable(branches[0], index);
  const reachableSets = [firstWalk.reachable];
  for (let i = 1; i < branches.length; i++) {
    reachableSets.push(bfsReachable(branches[i], index).reachable);
  }
  const startSet = new Set(branches);
  for (const candidate of firstWalk.order) {
    if (startSet.has(candidate)) continue;
    if (reachableSets.every((s) => s.has(candidate))) {
      return candidate;
    }
  }
  return null;
}
function walkChain(startId, untilId, index, visited) {
  const items = [];
  let cur = startId;
  while (cur !== null && cur !== untilId) {
    if (visited.has(cur)) break;
    visited.add(cur);
    const entry = index.byStageId.get(cur);
    if (!entry) break;
    const branches = entry.branchChildren;
    const linearNexts = entry.linearNext;
    items.push({ kind: "leaf", stageId: cur });
    if (branches.length >= 2) {
      const convergence = findConvergence(branches, index);
      const branchChains = [];
      for (const b of branches) {
        const branchVisited = new Set(visited);
        const sub = walkChain(b, convergence, index, branchVisited);
        if (sub !== null) branchChains.push(sub);
        for (const v2 of branchVisited) visited.add(v2);
      }
      if (branchChains.length > 0) {
        items.push({ kind: "parallel", branches: branchChains });
      }
      cur = convergence;
    } else if (branches.length === 1 && linearNexts.length === 0) {
      cur = branches[0];
    } else if (linearNexts.length >= 1) {
      if (linearNexts.length > 1) {
        devWarn(
          () => `[buildCommitChainTree] stage '${cur}' has ${linearNexts.length} linear-next edges; chain decomposition follows only the first ('${linearNexts[0]}'). Use 'fork-branch' or 'decision-branch' edge kinds to express parallel/conditional splits.`
        );
      }
      cur = linearNexts[0];
    } else {
      cur = null;
    }
  }
  if (items.length === 0) return null;
  if (items.length === 1) return items[0];
  return { kind: "serial", items };
}
function structureAsChainTree(graph, options = {}) {
  if (graph.nodes.length === 0) return null;
  const index = indexGraph(graph);
  const seed = findSeed(graph, options.rootStageId);
  if (!seed) return null;
  const visited = /* @__PURE__ */ new Set();
  return walkChain(seed, null, index, visited);
}
function buildCommitChainTree(graph, commitFlow, options = {}) {
  const structural = structureAsChainTree(graph, options);
  if (!structural) return null;
  const commitsByStageId = /* @__PURE__ */ new Map();
  for (const c of commitFlow.commits) {
    const list = commitsByStageId.get(c.stageId) ?? [];
    list.push(c);
    commitsByStageId.set(c.stageId, list);
  }
  return decorate(structural, commitsByStageId);
}
function decorate(node, commitsByStageId) {
  if (node.kind === "leaf") {
    return {
      kind: "leaf",
      stageId: node.stageId,
      commits: commitsByStageId.get(node.stageId) ?? []
    };
  }
  if (node.kind === "serial") {
    return {
      kind: "serial",
      items: node.items.map((n) => decorate(n, commitsByStageId))
    };
  }
  return {
    kind: "parallel",
    branches: node.branches.map((b) => decorate(b, commitsByStageId))
  };
}

// src/components/FlowchartView/CommitChainView.tsx
import { Fragment as Fragment4, jsx as jsx18, jsxs as jsxs15 } from "react/jsx-runtime";
function CommitChainView({
  chain,
  selectedRuntimeStageId = null,
  onSelectCommit,
  resolveLabel,
  revealedThroughCommitIdx = null,
  className,
  style
}) {
  if (!chain) {
    return /* @__PURE__ */ jsx18(
      "div",
      {
        className,
        style: {
          padding: 16,
          color: theme.textMuted,
          fontStyle: "italic",
          ...style
        },
        children: "No chain to display."
      }
    );
  }
  return /* @__PURE__ */ jsx18(
    "div",
    {
      className,
      style: {
        padding: 12,
        color: theme.textPrimary,
        fontSize: 12,
        overflow: "auto",
        ...style
      },
      children: /* @__PURE__ */ jsx18(
        ChainShell,
        {
          node: chain,
          renderLeaf: (leaf) => /* @__PURE__ */ jsx18(
            Leaf,
            {
              leaf,
              selectedRuntimeStageId,
              onSelectCommit,
              resolveLabel,
              revealedThroughCommitIdx
            }
          )
        }
      )
    }
  );
}
function ChainShell({ node, renderLeaf }) {
  if (node.kind === "leaf") {
    return /* @__PURE__ */ jsx18(Fragment4, { children: renderLeaf(node) });
  }
  if (node.kind === "serial") {
    return /* @__PURE__ */ jsx18(
      "div",
      {
        style: {
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0
        },
        children: node.items.map((child, i) => /* @__PURE__ */ jsxs15(
          "div",
          {
            style: { display: "flex", flexDirection: "column", alignItems: "center" },
            children: [
              /* @__PURE__ */ jsx18(ChainShell, { node: child, renderLeaf }),
              i < node.items.length - 1 && /* @__PURE__ */ jsx18(Connector, { orientation: "vertical" })
            ]
          },
          chainKey(child, i)
        ))
      }
    );
  }
  return /* @__PURE__ */ jsxs15(
    "div",
    {
      style: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 0
      },
      children: [
        /* @__PURE__ */ jsx18(ForkMarker, {}),
        /* @__PURE__ */ jsx18(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 18,
              padding: "4px 0",
              borderLeft: `1px dashed ${theme.border}`,
              borderRight: `1px dashed ${theme.border}`,
              paddingLeft: 12,
              paddingRight: 12
            },
            children: node.branches.map((branch, i) => /* @__PURE__ */ jsx18(
              "div",
              {
                style: {
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  minWidth: 120
                },
                children: /* @__PURE__ */ jsx18(ChainShell, { node: branch, renderLeaf })
              },
              chainKey(branch, i)
            ))
          }
        ),
        /* @__PURE__ */ jsx18(ForkMarker, {})
      ]
    }
  );
}
function chainKey(node, fallbackIndex) {
  const leaf = firstLeafOf(node);
  return leaf ? `${node.kind}:${leaf.stageId}` : `${node.kind}:idx${fallbackIndex}`;
}
function firstLeafOf(node) {
  if (node.kind === "leaf") return node;
  if (node.kind === "serial") {
    for (const item of node.items) {
      const l = firstLeafOf(item);
      if (l) return l;
    }
    return null;
  }
  for (const branch of node.branches) {
    const l = firstLeafOf(branch);
    if (l) return l;
  }
  return null;
}
function Leaf({
  leaf,
  selectedRuntimeStageId,
  onSelectCommit,
  resolveLabel,
  revealedThroughCommitIdx
}) {
  const label = resolveLabel ? resolveLabel(leaf.stageId) : leaf.stageId;
  const commits = "commits" in leaf ? leaf.commits : [];
  if (commits.length === 0) {
    return /* @__PURE__ */ jsxs15(
      "div",
      {
        style: {
          ...boxBaseStyle,
          borderStyle: "dashed",
          color: theme.textMuted,
          background: "transparent"
        },
        title: `${leaf.stageId} \u2014 not executed in this run`,
        children: [
          /* @__PURE__ */ jsx18("div", { style: { fontWeight: 600 }, children: label }),
          /* @__PURE__ */ jsx18("div", { style: { fontSize: 10, fontStyle: "italic" }, children: "not executed" })
        ]
      }
    );
  }
  return /* @__PURE__ */ jsx18("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }, children: commits.map((c, i) => {
    const isSelected = c.runtimeStageId === selectedRuntimeStageId;
    const clickable = onSelectCommit !== void 0;
    const isRevealed = revealedThroughCommitIdx === null || c.commitIdx <= revealedThroughCommitIdx;
    return /* @__PURE__ */ jsxs15(
      "button",
      {
        type: "button",
        onClick: clickable ? () => onSelectCommit(c.runtimeStageId) : void 0,
        style: {
          ...boxBaseStyle,
          cursor: clickable ? "pointer" : "default",
          borderColor: isSelected ? theme.success : theme.border,
          borderWidth: isSelected ? 2 : 1,
          background: isSelected ? "rgba(34,197,94,0.08)" : "transparent",
          color: theme.textPrimary,
          textAlign: "left",
          fontFamily: "inherit",
          padding: "6px 10px",
          opacity: isRevealed ? 1 : 0.35
        },
        "aria-disabled": !isRevealed,
        "aria-current": isSelected ? "true" : void 0,
        title: c.runtimeStageId,
        children: [
          /* @__PURE__ */ jsxs15("div", { style: { fontWeight: 600 }, children: [
            label,
            commits.length > 1 && /* @__PURE__ */ jsxs15("span", { style: { color: theme.textMuted, fontWeight: 400, marginLeft: 6 }, children: [
              "iter ",
              i + 1,
              "/",
              commits.length
            ] })
          ] }),
          /* @__PURE__ */ jsxs15(
            "div",
            {
              style: {
                fontSize: 10,
                fontFamily: "monospace",
                color: theme.textMuted,
                marginTop: 2
              },
              children: [
                "#",
                c.commitIdx,
                " \xB7 ",
                c.runtimeStageId
              ]
            }
          )
        ]
      },
      c.commitIdx
    );
  }) });
}
function Connector({ orientation }) {
  return orientation === "vertical" ? /* @__PURE__ */ jsx18(
    "div",
    {
      "aria-hidden": true,
      style: {
        width: 1,
        height: 12,
        background: theme.border
      }
    }
  ) : /* @__PURE__ */ jsx18(
    "div",
    {
      "aria-hidden": true,
      style: {
        height: 1,
        width: 12,
        background: theme.border
      }
    }
  );
}
function ForkMarker() {
  return /* @__PURE__ */ jsx18(
    "div",
    {
      "aria-hidden": true,
      style: {
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: theme.border,
        margin: "2px 0"
      }
    }
  );
}
var boxBaseStyle = {
  display: "inline-block",
  minWidth: 110,
  padding: "6px 10px",
  border: `1px solid ${theme.border}`,
  borderRadius: 4,
  fontSize: 12,
  color: theme.textPrimary,
  background: "transparent"
};

// src/components/FlowchartView/TraceExplorerShell.tsx
import { useMemo as useMemo12, useState as useState8, useCallback as useCallback7 } from "react";

// src/components/FlowchartView/RunSlider.tsx
import { useCallback as useCallback6, useMemo as useMemo11 } from "react";
import { jsx as jsx19, jsxs as jsxs16 } from "react/jsx-runtime";
function RunSlider({
  index,
  cursorRuntimeStageId,
  onCursorChange,
  renderLabel,
  className,
  style
}) {
  const total = index.commits.length;
  const cursorCommitIdx = useMemo11(() => {
    if (!cursorRuntimeStageId) return 0;
    const view = index.byRuntimeStageId.get(cursorRuntimeStageId);
    return view ? view.commitIdx : 0;
  }, [index, cursorRuntimeStageId]);
  const handleSliderChange = useCallback6(
    (e) => {
      const value = Number(e.target.value);
      const view = index.commits[value];
      onCursorChange(view ? view.runtimeStageId : null);
    },
    [index, onCursorChange]
  );
  const label = useMemo11(() => {
    const commit = index.commits[cursorCommitIdx] ?? null;
    const rsid = cursorRuntimeStageId ?? commit?.runtimeStageId ?? null;
    if (renderLabel)
      return renderLabel({
        commitIdx: cursorCommitIdx,
        total,
        runtimeStageId: rsid,
        commit,
        index
      });
    if (total === 0) return /* @__PURE__ */ jsx19("span", { style: { color: theme.textMuted }, children: "No commits yet" });
    return /* @__PURE__ */ jsxs16("span", { style: { fontFamily: "monospace", fontSize: 11, color: theme.textSecondary }, children: [
      "#",
      cursorCommitIdx + 1,
      " / ",
      total,
      " \xB7 ",
      commit?.runtimeStageId ?? "\u2014"
    ] });
  }, [renderLabel, cursorCommitIdx, total, index, cursorRuntimeStageId]);
  const disabled = total < 2;
  return /* @__PURE__ */ jsxs16(
    "div",
    {
      className,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 12px",
        background: theme.bgSecondary,
        border: `1px solid ${theme.border}`,
        borderRadius: 6,
        ...style
      },
      children: [
        /* @__PURE__ */ jsx19(
          "span",
          {
            style: {
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              color: theme.textMuted
            },
            children: "Time"
          }
        ),
        /* @__PURE__ */ jsx19(
          "input",
          {
            type: "range",
            min: 0,
            max: Math.max(0, total - 1),
            step: 1,
            value: Math.min(cursorCommitIdx, Math.max(0, total - 1)),
            onChange: handleSliderChange,
            disabled,
            "aria-label": "Commit time cursor",
            "aria-valuemin": 0,
            "aria-valuemax": Math.max(0, total - 1),
            "aria-valuenow": cursorCommitIdx,
            "aria-valuetext": total === 0 ? "no commits" : `commit ${cursorCommitIdx + 1} of ${total}`,
            style: { flex: 1, accentColor: theme.success }
          }
        ),
        /* @__PURE__ */ jsx19("div", { style: { minWidth: 200, textAlign: "right" }, children: label })
      ]
    }
  );
}

// src/components/FlowchartView/TraceExplorerShell.tsx
import { jsx as jsx20, jsxs as jsxs17 } from "react/jsx-runtime";
function TraceExplorerShell({
  bundle,
  selectedRuntimeStageId: controlledSel,
  onSelectionChange,
  slots,
  className,
  style
}) {
  const [internalSel, setInternalSel] = useState8(null);
  const isControlled = controlledSel !== void 0;
  const selectedRuntimeStageId = isControlled ? controlledSel : internalSel;
  const handleSelect = useCallback7(
    (rsid) => {
      if (!isControlled) setInternalSel(rsid);
      onSelectionChange?.(rsid);
    },
    [isControlled, onSelectionChange]
  );
  const handleSelectCommit = useCallback7(
    (rsid) => handleSelect(rsid),
    [handleSelect]
  );
  const selectedStageId = useMemo12(() => {
    if (!selectedRuntimeStageId) return null;
    const hashIdx = selectedRuntimeStageId.lastIndexOf("#");
    if (hashIdx <= 0) return null;
    return asStageId(selectedRuntimeStageId.slice(0, hashIdx));
  }, [selectedRuntimeStageId]);
  const ChainPane = useMemo12(
    () => slots?.chain ?? DefaultChainPane,
    [slots?.chain]
  );
  const CommitPane = useMemo12(
    () => slots?.commitInspector ?? DefaultCommitPane,
    [slots?.commitInspector]
  );
  const NodePane = useMemo12(
    () => slots?.nodeInspector ?? DefaultNodePane,
    [slots?.nodeInspector]
  );
  const SliderPane = useMemo12(() => {
    if (slots && "slider" in slots) {
      return slots.slider ?? null;
    }
    return DefaultSliderPane;
  }, [slots]);
  const chain = useTranslator(
    bundle.commitFlow,
    () => buildCommitChainTree(bundle.structure.getGraph(), bundle.commitFlow.getIndex())
  );
  const commitIndex = useTranslator(
    bundle.commitFlow,
    () => bundle.commitFlow.getIndex()
  );
  const nodeIndex = useTranslator(bundle.nodeView, () => bundle.nodeView.getIndex());
  const handleStageNavigate = useCallback7(
    (stageId) => {
      const candidates = commitIndex.commits.filter((c) => c.stageId === stageId);
      const first = candidates[0];
      handleSelect(first ? first.runtimeStageId : null);
    },
    [commitIndex, handleSelect]
  );
  const revealedThroughCommitIdx = useMemo12(() => {
    if (!selectedRuntimeStageId) return null;
    const view = commitIndex.byRuntimeStageId.get(selectedRuntimeStageId);
    return view ? view.commitIdx : -1;
  }, [selectedRuntimeStageId, commitIndex]);
  const layoutStyle = useMemo12(
    () => SliderPane ? SHELL_STYLE_WITH_SLIDER : SHELL_STYLE_NO_SLIDER,
    [SliderPane]
  );
  return /* @__PURE__ */ jsxs17("div", { className, style: { ...layoutStyle, ...style }, children: [
    SliderPane && /* @__PURE__ */ jsx20(Pane, { area: "slider", children: /* @__PURE__ */ jsx20(
      SliderPane,
      {
        index: commitIndex,
        cursorRuntimeStageId: selectedRuntimeStageId,
        onCursorChange: handleSelect
      }
    ) }),
    /* @__PURE__ */ jsx20(Pane, { area: "chain", children: /* @__PURE__ */ jsx20(
      ChainPane,
      {
        chain,
        selectedRuntimeStageId,
        onSelectCommit: handleSelectCommit,
        revealedThroughCommitIdx
      }
    ) }),
    /* @__PURE__ */ jsx20(Pane, { area: "commit", children: /* @__PURE__ */ jsx20(
      CommitPane,
      {
        index: commitIndex,
        selectedRuntimeStageId,
        onNavigate: handleSelectCommit
      }
    ) }),
    /* @__PURE__ */ jsx20(Pane, { area: "node", children: /* @__PURE__ */ jsx20(
      NodePane,
      {
        index: nodeIndex,
        selectedStageId,
        onNavigate: handleStageNavigate
      }
    ) })
  ] });
}
function DefaultChainPane({
  chain,
  selectedRuntimeStageId,
  onSelectCommit,
  revealedThroughCommitIdx
}) {
  return /* @__PURE__ */ jsx20(
    CommitChainView,
    {
      chain,
      selectedRuntimeStageId,
      onSelectCommit,
      revealedThroughCommitIdx
    }
  );
}
function DefaultCommitPane({
  index,
  selectedRuntimeStageId,
  onNavigate
}) {
  return /* @__PURE__ */ jsx20(
    CommitInspector,
    {
      index,
      selectedRuntimeStageId,
      onNavigate
    }
  );
}
function DefaultNodePane({ index, selectedStageId, onNavigate }) {
  return /* @__PURE__ */ jsx20(NodeInspector, { index, selectedId: selectedStageId, onNavigate });
}
function DefaultSliderPane({
  index,
  cursorRuntimeStageId,
  onCursorChange
}) {
  return /* @__PURE__ */ jsx20(
    RunSlider,
    {
      index,
      cursorRuntimeStageId,
      onCursorChange
    }
  );
}
var SHELL_STYLE_WITH_SLIDER = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1fr)",
  gridTemplateRows: "auto 1fr auto",
  gridTemplateAreas: '"slider slider" "chain commit" "node node"',
  gap: 12,
  padding: 12,
  background: theme.bgPrimary,
  color: theme.textPrimary
};
var SHELL_STYLE_NO_SLIDER = {
  display: "grid",
  gridTemplateColumns: "minmax(280px, 1fr) minmax(320px, 1fr)",
  gridTemplateRows: "1fr auto",
  gridTemplateAreas: '"chain commit" "node node"',
  gap: 12,
  padding: 12,
  background: theme.bgPrimary,
  color: theme.textPrimary
};
var PANE_BASE_STYLE = {
  border: `1px solid ${theme.border}`,
  borderRadius: 6,
  background: theme.bgSecondary,
  overflow: "auto",
  minHeight: 0
  // permit shrinking inside grid
};
function Pane({ area, children }) {
  return /* @__PURE__ */ jsx20("div", { role: "region", "aria-label": area, style: { ...PANE_BASE_STYLE, gridArea: area }, children });
}
export {
  CommitChainView,
  CommitInspector,
  GROUP_CONTAINER_NODE_TYPE,
  GroupContainerNode,
  LoopBackEdge,
  MAIN_CHART_BOX_ID,
  NodeInspector,
  RunSlider,
  SlotPillNode,
  SmartStepEdge,
  StageNode,
  SubflowBreadcrumb,
  SubflowTree,
  TimeTravelDebugger,
  TraceExplorerShell,
  TraceFlow,
  TracedFlow,
  applyGroupLayout,
  asRuntimeStageId,
  asStageId,
  backtraceDataFlow,
  backtraceStructural,
  buildCommitChainTree,
  buildSubflowBreadcrumb,
  createCommitFlowRecorder,
  createDagreTraceLayout,
  createGroupedLayout,
  createMainChartBoxLayout,
  createNodeViewRecorder,
  createSnappedDagreLayout,
  createTraceBundle,
  createTraceGroupLayout,
  createTraceRuntimeOverlay,
  createTraceStructureRecorder,
  dagreTraceLayout,
  defaultTraceFlowLayout,
  filterGraphForDrill,
  forwardtraceStructural,
  sliceOverlay,
  snapLinearSuccessors,
  structureAsChainTree,
  traceGroupLayout,
  useSubflowNavigation,
  useTranslator,
  walkBackward,
  walkForward,
  wrapInMainChartBox
};
//# sourceMappingURL=flowchart.js.map