import { realpathSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_VIEWPORTS, parseViewports, validateHttpUrl } from "./viewports.js";
import { captureBaselineSnapshot, runAudit } from "./audit/runner.js";
import { formatCompactAuditJson, formatTerminalAudit } from "./audit/format.js";
import { loadBaseline, saveBaseline } from "./baseline/store.js";
import { diffBaselines } from "./baseline/diff.js";
import { renderCollisionOverlayHtml } from "./report/overlay.js";
import { startMcpStdioServer } from "./mcp/server.js";
import { startDemoSiteServer } from "./demo/server.js";
import type { ViewportSpec } from "./types.js";

export interface ParsedCliArgs {
  mode: "help" | "audit" | "snap" | "diff" | "mcp" | "demo";
  url?: string;
  viewports: ViewportSpec[];
  cdpUrl?: string;
  chromePath?: string;
  outHtml?: string;
  json: boolean;
  failOnDefects: boolean;
  thresholdPx: number;
  maxDefects: number;
}

function printHelp(): void {
  console.log(`boxcheck v0.1.0 — Local <500-token DOM geometry & CSS collision oracle (CLI + MCP)

Usage:
  boxcheck audit <url> [options]    Detect OVERLAP, H_OVERFLOW, TEXT_CLIPPED, OFF_SCREEN, OCCLUDED
  boxcheck snap <url> [options]     Save lightweight JSON geometry baseline to .boxcheck/baselines/
  boxcheck diff <url> [options]     Diff live geometry against saved baseline (>2px shifts/resizes)
  boxcheck mcp [options]            Run stdio MCP server (Antigravity, Claude Code, Codex, Cursor)
  boxcheck --demo [options]         Audit built-in broken mobile landing page (0 setup)

Options:
  --vp <list>                       Viewports (default: 390x844,1440x900 or mobile,desktop)
  --json                            Output compact <500-token JSON
  --out <file.html>                 Write visual SVG/PNG collision overlay HTML report
  --fail-on-defects                 Exit code 1 if any layout defect or diff is detected
  --threshold <px>                  Pixel threshold for \`diff\` (default: 2)
  --max-defects <n>                 Max defects in JSON output (default: 12)
  --cdp-url <url>                   Attach to existing Chrome DevTools endpoint (e.g. http://127.0.0.1:9222)
  --chrome-path <path>              Explicit Chrome/Edge/Chromium executable path
  -h, --help                        Show this help`);
}

function requireValue(argv: string[], idx: number, flag: string): string {
  const val = argv[idx + 1];
  if (!val || val.startsWith("-")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return val;
}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = {
    mode: "help",
    viewports: DEFAULT_VIEWPORTS,
    json: false,
    failOnDefects: false,
    thresholdPx: 2,
    maxDefects: 12,
  };

  if (argv.length === 0) return parsed;

  let startIdx = 0;
  const first = argv[0];
  if (first === "-h" || first === "--help") {
    return parsed;
  } else if (first === "--demo") {
    parsed.mode = "demo";
    startIdx = 1;
  } else if (first === "audit" || first === "snap" || first === "diff" || first === "mcp") {
    parsed.mode = first;
    startIdx = 1;
  } else {
    throw new Error(`Unknown command "${first}". Run \`boxcheck --help\`.`);
  }

  for (let i = startIdx; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") {
      parsed.mode = "help";
      return parsed;
    } else if (arg === "--json") {
      parsed.json = true;
    } else if (arg === "--fail-on-defects") {
      parsed.failOnDefects = true;
    } else if (arg === "--vp") {
      parsed.viewports = parseViewports(requireValue(argv, i, "--vp"));
      i++;
    } else if (arg === "--out") {
      parsed.outHtml = requireValue(argv, i, "--out");
      i++;
    } else if (arg === "--cdp-url") {
      parsed.cdpUrl = requireValue(argv, i, "--cdp-url");
      i++;
    } else if (arg === "--chrome-path") {
      parsed.chromePath = requireValue(argv, i, "--chrome-path");
      i++;
    } else if (arg === "--threshold") {
      const n = Number(requireValue(argv, i, "--threshold"));
      if (!Number.isFinite(n) || n < 0) throw new Error("--threshold must be a non-negative number");
      parsed.thresholdPx = n;
      i++;
    } else if (arg === "--max-defects") {
      const n = Number(requireValue(argv, i, "--max-defects"));
      if (!Number.isInteger(n) || n < 1 || n > 100) throw new Error("--max-defects must be an integer 1..100");
      parsed.maxDefects = n;
      i++;
    } else if (!arg.startsWith("-") && !parsed.url && (parsed.mode === "audit" || parsed.mode === "snap" || parsed.mode === "diff")) {
      parsed.url = arg;
    } else {
      throw new Error(`Unknown argument "${arg}". Run \`boxcheck --help\`.`);
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.mode === "help") {
    printHelp();
    return;
  }

  if (args.mode === "mcp") {
    startMcpStdioServer({
      workspaceDir: process.cwd(),
      cdpUrl: args.cdpUrl,
      chromePath: args.chromePath,
    });
    return;
  }

  if (args.mode === "demo") {
    const demo = await startDemoSiteServer();
    try {
      const report = await runAudit({
        url: demo.url,
        viewports: args.viewports,
        cdpUrl: args.cdpUrl,
        chromePath: args.chromePath,
        captureScreenshots: Boolean(args.outHtml),
      });
      if (args.outHtml) {
        const target = resolve(args.outHtml);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, renderCollisionOverlayHtml(report), "utf8");
        if (!args.json) {
          console.error(`[boxcheck] Visual collision report saved -> ${target}`);
        }
      }
      console.log(args.json ? formatCompactAuditJson(report, args.maxDefects) : formatTerminalAudit(report));
      if (args.failOnDefects && report.totalDefects > 0) {
        process.exitCode = 1;
      }
    } finally {
      await demo.close();
    }
    return;
  }

  if (!args.url) {
    throw new Error(`Missing <url> argument for \`boxcheck ${args.mode} <url>\`.`);
  }
  const validUrl = validateHttpUrl(args.url);

  if (args.mode === "audit") {
    const report = await runAudit({
      url: validUrl,
      viewports: args.viewports,
      cdpUrl: args.cdpUrl,
      chromePath: args.chromePath,
      captureScreenshots: Boolean(args.outHtml),
    });
    if (args.outHtml) {
      const target = resolve(args.outHtml);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, renderCollisionOverlayHtml(report), "utf8");
      if (!args.json) {
        console.error(`[boxcheck] Visual collision report saved -> ${target}`);
      }
    }
    console.log(args.json ? formatCompactAuditJson(report, args.maxDefects) : formatTerminalAudit(report));
    if (args.failOnDefects && report.totalDefects > 0) {
      process.exitCode = 1;
    }
    return;
  }

  if (args.mode === "snap") {
    const snap = await captureBaselineSnapshot({
      url: validUrl,
      viewports: args.viewports,
      cdpUrl: args.cdpUrl,
      chromePath: args.chromePath,
    });
    const saved = saveBaseline(process.cwd(), snap);
    console.log(
      args.json
        ? JSON.stringify({ saved, url: snap.url, viewports: snap.viewports.map((v) => ({ vp: v.vp, elements: v.elements.length })) }, null, 2)
        : `boxcheck · baseline saved -> ${saved} (${snap.viewports.map((v) => `${v.vp}: ${v.elements.length} els`).join(", ")})`
    );
    return;
  }

  if (args.mode === "diff") {
    const prev = loadBaseline(process.cwd(), validUrl);
    if (!prev) {
      throw new Error(`No baseline found for ${validUrl}. Run \`boxcheck snap ${validUrl}\` first.`);
    }
    const curr = await captureBaselineSnapshot({
      url: validUrl,
      viewports: args.viewports,
      cdpUrl: args.cdpUrl,
      chromePath: args.chromePath,
    });
    const diff = diffBaselines(prev, curr, args.thresholdPx);
    console.log(JSON.stringify(diff, null, 2));
    if (args.failOnDefects && diff.totalChanges > 0) {
      process.exitCode = 1;
    }
  }
}

function isDirectEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)).toLowerCase() ===
      realpathSync(resolve(process.argv[1])).toLowerCase()
    );
  } catch {
    return resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
  }
}

if (isDirectEntry()) {
  main().catch((err) => {
    console.error(`[boxcheck] Error: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
