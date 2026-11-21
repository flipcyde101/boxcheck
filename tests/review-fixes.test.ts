import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { PassThrough } from "node:stream";
import { validateHttpUrl } from "../src/viewports.js";
import { detectLayoutDefects } from "../src/audit/detector.js";
import { diffBaselines } from "../src/baseline/diff.js";
import { formatCompactAuditJson } from "../src/audit/format.js";
import { runAudit } from "../src/audit/runner.js";
import { launchHeadlessBrowser } from "../src/cdp/browser.js";
import { startMcpStdioServer } from "../src/mcp/server.js";
import type { BaselineSnapshot, CollectedElement, CollectedPageSnapshot } from "../src/types.js";

function makeEl(overrides: Partial<CollectedElement> & { id: number; selector: string }): CollectedElement {
  return {
    parentId: null,
    ancestorIds: [],
    tag: "div",
    role: null,
    text: "Text",
    interactive: false,
    hasDirectText: true,
    rect: { x: 20, y: 20, w: 120, h: 40 },
    scrollWidth: 120,
    clientWidth: 120,
    scrollHeight: 40,
    clientHeight: 40,
    overflowX: "visible",
    overflowY: "visible",
    textOverflow: "clip",
    whiteSpace: "normal",
    position: "static",
    pointerEvents: "auto",
    ariaHidden: false,
    visibility: "visible",
    opacity: 1,
    zIndex: 0,
    occludedBySelector: null,
    occludedById: null,
    ...overrides,
  };
}

describe("boxcheck Review Fix Regressions (C1–C4, I1–I4)", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const s = servers.pop()!;
      await new Promise<void>((r) => s.close(() => r()));
    }
  });

  it("C1 & I2: emits unique selectors for repeated cards, deduplicates H_OVERFLOW, and stays <1800 chars (<450 tokens)", async () => {
    const html = `<!doctype html><html><head><style>
      body { margin:0; font-family:sans-serif; }
      .grid { display:flex; width:450px; }
      .card { width:150px; }
      .btn { width:60px; overflow:hidden; white-space:nowrap; }
    </style></head><body>
      <div class="grid">
        <div class="card"><button class="btn">Upgrade Starter Plan</button></div>
        <div class="card"><button class="btn">Upgrade Pro Plan</button></div>
        <div class="card"><button class="btn">Upgrade Scale Plan</button></div>
      </div>
    </body></html>`;

    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    servers.push(server);
    const port = (server.address() as { port: number }).port;

    const report = await runAudit({
      url: `http://127.0.0.1:${port}/`,
      viewports: [{ width: 390, height: 844, label: "390x844" }],
    });

    const clipped = report.viewports[0].defects.filter((d) => d.kind === "TEXT_CLIPPED");
    expect(clipped).toHaveLength(3);
    // C1: All 3 buttons MUST have distinct unique selectors!
    const uniqueSelectors = new Set(clipped.map((d) => d.el));
    expect(uniqueSelectors.size).toBe(3);

    // I2: No duplicate CSS property names in winning_css & compact JSON < 1800 chars
    for (const d of report.viewports[0].defects) {
      if (d.winning_css) {
        const match = /\{([^}]+)\}/.exec(d.winning_css);
        if (match) {
          const propNames = match[1].split(";").map((s) => s.split(":")[0].trim()).filter(Boolean);
          expect(new Set(propNames).size).toBe(propNames.length);
        }
      }
    }
    const jsonStr = formatCompactAuditJson(report);
    expect(jsonStr.length).toBeLessThan(1800);
  }, 15_000);

  it("C2: ignores horizontal scroll carousels, line-clamp, and small absolute corner badges", () => {
    const snap: CollectedPageSnapshot = {
      url: "http://localhost:3000",
      viewport: { width: 390, height: 844, label: "390x844" },
      documentScrollWidth: 390,
      documentClientWidth: 390,
      elements: [
        // Button inside horizontal scroll carousel (off-fold to the right)
        makeEl({
          id: 1,
          selector: "div.carousel",
          hasDirectText: false,
          overflowX: "auto",
          rect: { x: 0, y: 20, w: 390, h: 80 },
          scrollWidth: 900,
          clientWidth: 390,
        }),
        makeEl({
          id: 2,
          parentId: 1,
          ancestorIds: [1],
          selector: "div.carousel > button.slide-5",
          tag: "button",
          interactive: true,
          rect: { x: 600, y: 30, w: 120, h: 40 },
          insideHorizontalScroll: true,
        }),
        // Small corner notification badge on interactive button
        makeEl({ id: 3, selector: "button.inbox", tag: "button", interactive: true, rect: { x: 20, y: 140, w: 48, h: 48 } }),
        makeEl({
          id: 4,
          selector: "span.badge-count",
          tag: "span",
          text: "3",
          position: "absolute",
          rect: { x: 52, y: 136, w: 20, h: 18 },
        }),
        // Intentional -webkit-line-clamp text truncation
        makeEl({
          id: 5,
          selector: "p.clamped",
          tag: "p",
          rect: { x: 20, y: 220, w: 300, h: 40 },
          scrollHeight: 96,
          clientHeight: 40,
          overflowY: "hidden",
          lineClamp: true,
        }),
      ],
    };

    const defects = detectLayoutDefects(snap);
    expect(defects).toEqual([]);
  });

  it("C4: MCP server safely rejects null/malformed JSON-RPC requests with -32600 without crashing", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const stop = startMcpStdioServer({ input, output, workspaceDir: process.cwd() });

    const lines: Record<string, unknown>[] = [];
    output.on("data", (chunk: Buffer) => {
      for (const l of chunk.toString("utf8").split("\n").filter(Boolean)) {
        lines.push(JSON.parse(l) as Record<string, unknown>);
      }
    });

    try {
      input.write("null\n");
      input.write('{"jsonrpc":"2.0","id":9}\n');
      input.write('{"jsonrpc":"2.0","id":10,"method":"ping"}\n');
      await new Promise((r) => setTimeout(r, 80));

      expect(lines.some((m) => (m.error as { code?: number } | undefined)?.code === -32600)).toBe(true);
      expect(lines.some((m) => m.id === 10 && m.result !== undefined)).toBe(true);
    } finally {
      stop();
    }
  });

  it("I1: diffBaselines reports unmatchedViewports instead of silently passing with 0 changes", () => {
    const prev: BaselineSnapshot = {
      url: "http://localhost:3000",
      createdAt: "2026-11-21T00:00:00Z",
      viewports: [{ vp: "390x844", width: 390, height: 844, elements: [] }],
    };
    const curr: BaselineSnapshot = {
      url: "http://localhost:3000",
      createdAt: "2026-11-21T00:01:00Z",
      viewports: [{ vp: "768x1024", width: 768, height: 1024, elements: [] }],
    };
    const diff = diffBaselines(prev, curr, 2);
    expect(diff.unmatchedViewports).toEqual(["768x1024"]);
  });

  it("I3 & I4: throws on unreachable URLs, rejects embedded credentials & metadata IP, and validates --cdp-url", async () => {
    expect(() => validateHttpUrl("https://user:secret@example.com/")).toThrow(/credential/i);
    expect(() => validateHttpUrl("http://169.254.169.254/latest/meta-data/")).toThrow(/metadata|blocked/i);
    await expect(launchHeadlessBrowser({ cdpUrl: "file:///C:/Windows/win.ini" })).rejects.toThrow(/cdp-url|protocol/i);
    await expect(
      runAudit({ url: "http://127.0.0.1:59997/", viewports: [{ width: 390, height: 844, label: "390x844" }] })
    ).rejects.toThrow(/navigation|ERR_/i);
  }, 15_000);
});
