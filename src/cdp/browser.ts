import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface BrowserHandle {
  wsUrl: string;
  userDataDir: string | null;
  ownedProcess: boolean;
  close: () => Promise<void>;
}

interface ActiveBrowserEntry {
  child: ChildProcess;
  userDataDir: string;
}

const activeBrowsers = new Set<ActiveBrowserEntry>();
let signalHooksInstalled = false;

function killProcessTreeSync(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === "win32") {
    try {
      spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // ignore
    }
  } else {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // ignore
    }
  }
}

function installGlobalSignalHooks(): void {
  if (signalHooksInstalled) return;
  signalHooksInstalled = true;

  const handleSignal = (sig: NodeJS.Signals, exitCode: number) => {
    for (const entry of activeBrowsers) {
      killProcessTreeSync(entry.child.pid);
      try {
        rmSync(entry.userDataDir, { recursive: true, force: true });
      } catch {
        // best-effort on abrupt signal
      }
    }
    activeBrowsers.clear();
    process.exit(exitCode);
  };

  process.on("SIGINT", () => handleSignal("SIGINT", 130));
  process.on("SIGTERM", () => handleSignal("SIGTERM", 143));
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

async function resolveExternalCdpWsUrl(cdpUrl: string, timeoutMs: number): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(cdpUrl);
  } catch {
    throw new Error(`Invalid --cdp-url "${cdpUrl}"`);
  }
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error(`Unsupported --cdp-url protocol "${parsed.protocol}". Expected http, https, ws, or wss.`);
  }
  if (parsed.protocol === "ws:" || parsed.protocol === "wss:") {
    return parsed.toString();
  }
  const base = parsed.toString().replace(/\/+$/, "");
  const res = await fetch(`${base}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
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
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      if (!existsSync(dir)) return;
    } catch {
      // Windows Chrome subprocesses can release profile locks slightly after exit
    }
    await new Promise((r) => setTimeout(r, 120));
  }
}

async function terminateProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    let hardTimer: ReturnType<typeof setTimeout> | undefined;
    let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = () => {
      if (settled) return;
      settled = true;
      if (hardTimer) clearTimeout(hardTimer);
      if (giveUpTimer) clearTimeout(giveUpTimer);
      resolve();
    };
    child.once("exit", finish);

    if (process.platform === "win32") {
      // Give Browser.close 250ms to exit cleanly, then force-kill full tree via taskkill /T /F
      hardTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          killProcessTreeSync(child.pid);
        }
      }, 250);
      giveUpTimer = setTimeout(finish, 3_000);
      return;
    }

    try {
      child.kill("SIGTERM");
    } catch {
      finish();
      return;
    }
    hardTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        try {
          child.kill("SIGKILL");
        } catch {
          // ignore
        }
      }
    }, 1_500);
    giveUpTimer = setTimeout(finish, 3_500);
  });
}

export async function launchHeadlessBrowser(opts: {
  cdpUrl?: string;
  chromePath?: string;
  timeoutMs?: number;
} = {}): Promise<BrowserHandle> {
  const timeoutMs = opts.timeoutMs ?? 12_000;

  if (opts.cdpUrl) {
    const wsUrl = await resolveExternalCdpWsUrl(opts.cdpUrl, timeoutMs);
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

  const activeEntry: ActiveBrowserEntry = { child, userDataDir };
  activeBrowsers.add(activeEntry);
  installGlobalSignalHooks();

  let wsUrl: string;
  try {
    wsUrl = await new Promise<string>((resolve, reject) => {
      let stderrBuf = "";
      const cleanup = () => {
        clearTimeout(timer);
        child.stderr?.off("data", onStderr);
        child.off("error", onError);
        child.off("exit", onExit);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for headless Chrome DevTools URL. Stderr: ${stderrBuf.slice(-300)}`));
      }, timeoutMs);

      const onStderr = (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
        const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderrBuf);
        if (match) {
          cleanup();
          resolve(match[1]);
        }
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onExit = (code: number | null) => {
        cleanup();
        reject(new Error(`Headless Chrome exited early (code ${code ?? "null"}): ${stderrBuf.slice(-300)}`));
      };

      child.stderr?.on("data", onStderr);
      child.once("error", onError);
      child.once("exit", onExit);
    });
  } catch (err) {
    activeBrowsers.delete(activeEntry);
    await terminateProcessTree(child);
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
      activeBrowsers.delete(activeEntry);
      await terminateProcessTree(child);
      await removeDirWithRetry(userDataDir);
    },
  };
}
