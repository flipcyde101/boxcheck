import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BrowserHandle {
  wsUrl: string;
  userDataDir: string | null;
  ownedProcess: boolean;
  close: () => Promise<void>;
}

export function findChromeExecutable(explicitPath?: string): string | null {
  const candidates: string[] = [];
  if (explicitPath) candidates.push(explicitPath);
  if (process.env.BOXCHECK_CHROME_PATH) candidates.push(process.env.BOXCHECK_CHROME_PATH);
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);

  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA || "";
    candidates.push(
      join(pf, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
      join(local, "Google", "Chrome", "Application", "chrome.exe"),
      join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(pf, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    );
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    );
  } else {
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/usr/bin/microsoft-edge"
    );
  }

  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

async function resolveExternalCdpWsUrl(cdpUrl: string): Promise<string> {
  if (cdpUrl.startsWith("ws://") || cdpUrl.startsWith("wss://")) {
    return cdpUrl;
  }
  const base = cdpUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/json/version`);
  if (!res.ok) {
    throw new Error(`Failed to query CDP endpoint ${base}/json/version (HTTP ${res.status})`);
  }
  const data = (await res.json()) as { webSocketDebuggerUrl?: string };
  if (!data.webSocketDebuggerUrl) {
    throw new Error(`CDP endpoint ${base}/json/version did not return webSocketDebuggerUrl`);
  }
  return data.webSocketDebuggerUrl;
}

async function removeDirWithRetry(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      if (!existsSync(dir)) return;
    } catch {
      // Windows Chrome child processes can hold profile locks briefly after exit
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function terminateProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(killTimer);
      resolve();
    };
    child.once("exit", done);
    try {
      child.kill("SIGTERM");
    } catch {
      done();
      return;
    }
    const killTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve();
    }, 2_500);
  });
}

export async function launchHeadlessBrowser(opts: {
  cdpUrl?: string;
  chromePath?: string;
  timeoutMs?: number;
} = {}): Promise<BrowserHandle> {
  if (opts.cdpUrl) {
    const wsUrl = await resolveExternalCdpWsUrl(opts.cdpUrl);
    return {
      wsUrl,
      userDataDir: null,
      ownedProcess: false,
      close: async () => {},
    };
  }

  const exe = findChromeExecutable(opts.chromePath);
  if (!exe) {
    throw new Error(
      "No Chrome, Edge, Chromium, or Brave binary found. Pass --chrome-path <path> or --cdp-url <http://127.0.0.1:9222>."
    );
  }

  const userDataDir = mkdtempSync(join(tmpdir(), "boxcheck-chrome-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "--mute-audio",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
  ];
  if (process.platform === "linux") {
    args.push("--no-sandbox", "--disable-dev-shm-usage");
  }
  args.push("about:blank");

  const child = spawn(exe, args, {
    stdio: ["ignore", "ignore", "pipe"],
    windowsHide: true,
  });

  const cleanupOnSignal = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  };
  process.once("SIGINT", cleanupOnSignal);
  process.once("SIGTERM", cleanupOnSignal);

  const timeoutMs = opts.timeoutMs ?? 12_000;
  let wsUrl: string;
  try {
    wsUrl = await new Promise<string>((resolve, reject) => {
      let stderrBuf = "";
      const timer = setTimeout(() => {
        reject(new Error(`Timed out waiting for headless Chrome DevTools URL. Stderr: ${stderrBuf.slice(-300)}`));
      }, timeoutMs);

      child.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderrBuf);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });

      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Headless Chrome exited early (code ${code ?? "null"}): ${stderrBuf.slice(-300)}`));
      });
    });
  } catch (err) {
    process.off("SIGINT", cleanupOnSignal);
    process.off("SIGTERM", cleanupOnSignal);
    await terminateProcess(child);
    await removeDirWithRetry(userDataDir);
    throw err;
  }

  let closed = false;
  return {
    wsUrl,
    userDataDir,
    ownedProcess: true,
    close: async () => {
      if (closed) return;
      closed = true;
      process.off("SIGINT", cleanupOnSignal);
      process.off("SIGTERM", cleanupOnSignal);
      await terminateProcess(child);
      await removeDirWithRetry(userDataDir);
    },
  };
}
