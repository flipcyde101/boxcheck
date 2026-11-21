# boxcheck

**100% local, `<500`-token DOM geometry, CSS cascade & layout-collision oracle (CLI + MCP) so coding agents stop shipping broken mobile UIs — raw CDP over Node 24 WebSocket, zero runtime dependencies.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Node >=24](https://img.shields.io/badge/node-%3E%3D24.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0%20(raw%20CDP)-informational.svg)](#architecture)

![boxcheck visual collision overlay report and <500-token agent JSON](./docs/hero-collision-report.png)

---

## See It Catch 4 Responsive Bugs in 2 Seconds (Zero Setup)

```bash
npx boxcheck --demo --json --out ./boxcheck-report.html
```

Spins up a built-in responsive SaaS pricing page (clean on `1440x900` desktop, broken on `390x844` mobile), audits it in headless Chrome via raw CDP, prints `<400` tokens of deterministic collision JSON + winning CSS rules, and writes a self-contained visual SVG/PNG overlay report to `./boxcheck-report.html`.

---

## Quick Start

```bash
# Audit mobile + desktop viewports in <2s
npx boxcheck audit http://localhost:3000 --vp 390x844,1440x900 --json

# Generate visual SVG/PNG collision overlay report
npx boxcheck audit http://localhost:3000 --vp 390x844 --out ./report.html

# Save lightweight git-committable JSON geometry baselines (.boxcheck/baselines/)
npx boxcheck snap http://localhost:3000

# Diff live geometry against baseline (flags unintended >2px shifts/resizes)
npx boxcheck diff http://localhost:3000 --fail-on-defects
```

---

## Connect to Your Coding Agent (Stdio MCP)

`boxcheck mcp` exposes three lean tools (`boxcheck_audit`, `boxcheck_snap`, `boxcheck_diff`) returning `<500` tokens per call — no 40k-token accessibility dumps.

### Antigravity / Cursor / Claude Code / Codex / OpenCode

```json
{
  "mcpServers": {
    "boxcheck": {
      "command": "npx",
      "args": ["-y", "boxcheck", "mcp"]
    }
  }
}
```

---

## What `boxcheck` Detects (with Built-In False-Positive Shield)

| Defect Kind | Deterministic Condition | False-Positive Shield |
|---|---|---|
| `OVERLAP` | Non-ancestor content/interactive siblings intersect `>=4px` on both axes (`>=24px²`) | Ignores ancestor-descendant pairs, `pointer-events: none`, `aria-hidden`, `sticky`/`fixed` layers, `<4px` subpixel jitter |
| `H_OVERFLOW` | Page `scrollWidth > clientWidth` + protruding elements past viewport edge | Skips intentional `overflow-x: auto/scroll/hidden` containers |
| `TEXT_CLIPPED` | Text exceeds `overflow: hidden/clip` box by `>=6px` | Ignores intentional `text-overflow: ellipsis` truncation |
| `OFF_SCREEN` | Visible interactive element pushed `>50%` outside horizontal viewport | Ignores hidden/zero-opacity/off-flow nodes |
| `OCCLUDED` | `elementFromPoint(cx, cy)` hits an unrelated higher z-index blocker | Ignores self, descendants, and ancestors |

Each defect is enriched via CDP `CSS.getMatchedStylesForNode` with the exact `winning_css` rule so your coding agent fixes the root CSS line in 1 turn.

---

## Honest Comparison

| Feature | `boxcheck` | Playwright MCP | `agent-browser` | Chromatic / Percy |
|---|---|---|---|---|
| **Install & Footprint** | ~40 kB tarball, **0 runtime deps**, uses system Chrome/Edge | Heavy browser bundle | Node + browser | Paid cloud SaaS + CI |
| **Token cost per layout check** | **`<500` tokens** deterministic JSON | 20k–60k tokens a11y tree / PNGs | Navigation-focused refs | N/A (human PR review) |
| **Deterministic overlap / overflow / occlusion math + `winning_css`** | **Yes** | No | No | Pixel diff only |
| **Git-committable JSON geometry baselines** | **Yes** (tiny `.json`) | No | No | Cloud PNG storage |
| **Where competitors win** | — | Full interactive clicking, form filling, E2E scripting | Ultra-fast multi-step web navigation | Cross-browser Safari/Firefox cloud visual approval workflows |

---

## Architecture

```mermaid
flowchart LR
    Agent["Coding Agent / CLI\n(Antigravity · Claude Code · Codex · Cursor)"] -->|"CLI or Stdio MCP"| Core["boxcheck\n0 runtime deps · Node 24"]
    Core -->|"Raw CDP over native WebSocket"| Chrome["Headless Chrome / Edge / Chromium\n(isolated temp profile, auto-cleaned)"]
    Chrome -->|"Rects + Computed Styles + elementFromPoint"| Detector["Deterministic Collision Math\n+ False-Positive Shield"]
    Chrome -->|"CSS.getMatchedStylesForNode"| Cascade["Winning CSS Attribution"]
    Detector --> Output["<500-token JSON · Baselines · SVG/PNG Overlay"]
    Cascade --> Output
```

---

## Local Agent Reliability Suite

- **[kvdiff](https://github.com/flipcyde101/kvdiff)** — Zero-code local proxy that pinpoints the exact UTF-8 byte breaking your LLM prompt cache (`Anthropic`, `OpenAI`, `Gemini/Antigravity`, `llama.cpp`/vLLM).
- **boxcheck** *(this repo)* — Local `<500`-token DOM geometry & CSS collision oracle (CLI + MCP).

## License

[MIT](./LICENSE)
