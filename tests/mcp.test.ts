import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { startMcpStdioServer } from "../src/mcp/server.js";

function sendJsonRpc(stream: PassThrough, msg: Record<string, unknown>): void {
  stream.write(`${JSON.stringify(msg)}\n`);
}

function readNextJsonLine(stream: PassThrough, timeoutMs = 5_000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for MCP response"));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      const idx = buf.indexOf("\n");
      if (idx >= 0) {
        const line = buf.slice(0, idx).trim();
        cleanup();
        resolve(JSON.parse(line) as Record<string, unknown>);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
    };
    stream.on("data", onData);
  });
}

describe("Zero-dependency JSON-RPC 2.0 stdio MCP server (Review Focus #3)", () => {
  it("handles initialize, tools/list, and boxcheck_audit with clean stdout JSON-RPC only", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const stop = startMcpStdioServer({
      input,
      output,
      workspaceDir: process.cwd(),
      auditFn: async (opts) => ({
        url: opts.url,
        timestamp: "2026-11-21T00:00:00.000Z",
        durationMs: 120,
        totalDefects: 1,
        viewports: [
          {
            vp: opts.viewports[0].label,
            width: opts.viewports[0].width,
            height: opts.viewports[0].height,
            elementCount: 12,
            durationMs: 120,
            defects: [{ kind: "H_OVERFLOW", vp: opts.viewports[0].label, el: "div.grid", overflow_px: 48 }],
          },
        ],
      }),
    });

    try {
      const p1 = readNextJsonLine(output);
      sendJsonRpc(input, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05" } });
      const initRes = await p1;
      expect(initRes.id).toBe(1);
      expect((initRes.result as { serverInfo?: { name?: string } }).serverInfo?.name).toBe("boxcheck");

      const p2 = readNextJsonLine(output);
      sendJsonRpc(input, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
      const listRes = await p2;
      const tools = (listRes.result as { tools: Array<{ name: string }> }).tools;
      expect(tools.map((t) => t.name)).toEqual(["boxcheck_audit", "boxcheck_snap", "boxcheck_diff"]);

      const p3 = readNextJsonLine(output);
      sendJsonRpc(input, {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "boxcheck_audit", arguments: { url: "http://127.0.0.1:3000", viewports: "390x844" } },
      });
      const callRes = await p3;
      const contentText = (callRes.result as { content: Array<{ text: string }> }).content[0].text;
      const parsed = JSON.parse(contentText);
      expect(parsed.totalDefects).toBe(1);
      expect(parsed.defects[0].kind).toBe("H_OVERFLOW");

      // Non-http scheme rejected cleanly as tool error without crashing server
      const p4 = readNextJsonLine(output);
      sendJsonRpc(input, {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/call",
        params: { name: "boxcheck_audit", arguments: { url: "file:///etc/passwd" } },
      });
      const errRes = await p4;
      expect((errRes.result as { isError?: boolean }).isError).toBe(true);
    } finally {
      stop();
    }
  });
});
