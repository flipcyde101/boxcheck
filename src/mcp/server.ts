import type { Readable, Writable } from "node:stream";
import { createInterface } from "node:readline";
import { captureBaselineSnapshot, runAudit, type RunAuditOptions } from "../audit/runner.js";
import { formatCompactAuditJson } from "../audit/format.js";
import { DEFAULT_VIEWPORTS, parseViewports, validateHttpUrl } from "../viewports.js";
import { loadBaseline, saveBaseline } from "../baseline/store.js";
import { diffBaselines } from "../baseline/diff.js";
import type { AuditReport, BaselineSnapshot } from "../types.js";

export interface McpServerOptions {
  input?: Readable;
  output?: Writable;
  workspaceDir: string;
  cdpUrl?: string;
  chromePath?: string;
  auditFn?: (opts: RunAuditOptions) => Promise<AuditReport>;
  baselineFn?: (opts: RunAuditOptions) => Promise<BaselineSnapshot>;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOL_DEFINITIONS = [
  {
    name: "boxcheck_audit",
    description:
      "Run a 100% local deterministic DOM geometry & CSS collision audit (OVERLAP, H_OVERFLOW, TEXT_CLIPPED, OFF_SCREEN, OCCLUDED) with winning_css cascade attribution in <500 tokens.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target http:// or https:// URL (e.g. http://localhost:3000)" },
        viewports: {
          type: "string",
          description: "Comma-separated WxH list or presets (default: 390x844,1440x900)",
        },
        maxDefects: { type: "number", description: "Max defects to include in JSON output (default: 12)" },
      },
      required: ["url"],
    },
  },
  {
    name: "boxcheck_snap",
    description:
      "Capture a lightweight git-committable JSON geometry baseline in .boxcheck/baselines/ for future boxcheck_diff regression checks.",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target http:// or https:// URL" },
        viewports: { type: "string", description: "Comma-separated WxH list (default: 390x844,1440x900)" },
      },
      required: ["url"],
    },
  },
  {
    name: "boxcheck_diff",
    description:
      "Diff live page geometry against the saved .boxcheck/baselines/ snapshot and report unintended SHIFTED, RESIZED, MISSING, or ADDED elements (>thresholdPx).",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target http:// or https:// URL" },
        viewports: { type: "string", description: "Comma-separated WxH list (default: 390x844,1440x900)" },
        thresholdPx: { type: "number", description: "Pixel tolerance threshold (default: 2)" },
      },
      required: ["url"],
    },
  },
];

export function startMcpStdioServer(opts: McpServerOptions): () => void {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const auditRunner = opts.auditFn ?? runAudit;
  const baselineRunner = opts.baselineFn ?? captureBaselineSnapshot;
  let closed = false;
  let queue: Promise<void> = Promise.resolve();

  const send = (payload: Record<string, unknown>): void => {
    if (closed || output.writableEnded || output.destroyed) return;
    output.write(`${JSON.stringify(payload)}\n`);
  };

  const handleRequest = async (req: JsonRpcRequest): Promise<void> => {
    if (req.id === undefined || req.id === null) {
      return;
    }

    if (req.method === "initialize") {
      send({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "boxcheck", version: "0.1.0" },
        },
      });
      return;
    }

    if (req.method === "ping") {
      send({ jsonrpc: "2.0", id: req.id, result: {} });
      return;
    }

    if (req.method === "tools/list") {
      send({
        jsonrpc: "2.0",
        id: req.id,
        result: { tools: TOOL_DEFINITIONS },
      });
      return;
    }

    if (req.method === "tools/call") {
      const params = req.params ?? {};
      const toolName = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments && typeof params.arguments === "object"
        ? params.arguments
        : {}) as Record<string, unknown>;

      try {
        const rawUrl = typeof args.url === "string" ? args.url : "";
        const validUrl = validateHttpUrl(rawUrl);
        const viewports =
          typeof args.viewports === "string" && args.viewports.trim()
            ? parseViewports(args.viewports)
            : DEFAULT_VIEWPORTS;

        if (toolName === "boxcheck_audit") {
          const maxDefects =
            typeof args.maxDefects === "number" && Number.isFinite(args.maxDefects) && args.maxDefects > 0
              ? Math.min(50, Math.floor(args.maxDefects))
              : 12;
          const report = await auditRunner({
            url: validUrl,
            viewports,
            cdpUrl: opts.cdpUrl,
            chromePath: opts.chromePath,
            captureScreenshots: false,
          });
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: formatCompactAuditJson(report, maxDefects) }],
            },
          });
          return;
        }

        if (toolName === "boxcheck_snap") {
          const snap = await baselineRunner({
            url: validUrl,
            viewports,
            cdpUrl: opts.cdpUrl,
            chromePath: opts.chromePath,
          });
          const savedPath = saveBaseline(opts.workspaceDir, snap);
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify(
                    {
                      saved: savedPath,
                      url: snap.url,
                      viewports: snap.viewports.map((v) => ({ vp: v.vp, elements: v.elements.length })),
                    },
                    null,
                    2
                  ),
                },
              ],
            },
          });
          return;
        }

        if (toolName === "boxcheck_diff") {
          const prev = loadBaseline(opts.workspaceDir, validUrl);
          if (!prev) {
            throw new Error(`No baseline found for ${validUrl}. Run boxcheck_snap first.`);
          }
          const thresholdPx =
            typeof args.thresholdPx === "number" && Number.isFinite(args.thresholdPx) && args.thresholdPx >= 0
              ? args.thresholdPx
              : 2;
          const curr = await baselineRunner({
            url: validUrl,
            viewports,
            cdpUrl: opts.cdpUrl,
            chromePath: opts.chromePath,
          });
          const diff = diffBaselines(prev, curr, thresholdPx);
          send({
            jsonrpc: "2.0",
            id: req.id,
            result: {
              content: [{ type: "text", text: JSON.stringify(diff, null, 2) }],
            },
          });
          return;
        }

        throw new Error(`Unknown MCP tool: ${toolName}`);
      } catch (err) {
        send({
          jsonrpc: "2.0",
          id: req.id,
          result: {
            isError: true,
            content: [{ type: "text", text: (err as Error).message }],
          },
        });
        return;
      }
    }

    send({
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `Method not found: ${req.method}` },
    });
  };

  const rl = createInterface({ input, crlfDelay: Infinity });
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32600, message: "Invalid Request" },
      });
      return;
    }

    const rec = parsed as Record<string, unknown>;
    if (rec.jsonrpc !== "2.0" || typeof rec.method !== "string" || rec.method.length === 0) {
      const reqId = typeof rec.id === "string" || typeof rec.id === "number" ? rec.id : null;
      send({
        jsonrpc: "2.0",
        id: reqId,
        error: { code: -32600, message: "Invalid Request" },
      });
      return;
    }

    // Serialize tool executions so concurrent snap/diff never race or spawn unbounded Chromes
    queue = queue
      .then(() => handleRequest(rec as unknown as JsonRpcRequest))
      .catch((err) => {
        const reqId = typeof rec.id === "string" || typeof rec.id === "number" ? rec.id : null;
        if (reqId !== null) {
          send({
            jsonrpc: "2.0",
            id: reqId,
            error: { code: -32603, message: (err as Error).message },
          });
        }
      });
  });

  rl.on("close", () => {
    closed = true;
  });

  return () => {
    closed = true;
    rl.close();
  };
}
