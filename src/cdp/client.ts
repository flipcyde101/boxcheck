export interface CdpEventMessage {
  method: string;
  params?: Record<string, unknown>;
  sessionId?: string;
}

interface PendingCall {
  resolve: (value: Record<string, unknown>) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly listeners = new Map<string, Set<(msg: CdpEventMessage) => void>>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (ev) => {
      const raw = typeof ev.data === "string" ? ev.data : String(ev.data);
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return;
      }

      if (typeof msg.id === "number") {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        clearTimeout(entry.timer);
        if (msg.error && typeof msg.error === "object") {
          const errObj = msg.error as { message?: string; code?: number };
          entry.reject(new Error(`CDP error ${errObj.code ?? ""}: ${errObj.message ?? "unknown"}`));
        } else {
          entry.resolve((msg.result as Record<string, unknown>) ?? {});
        }
        return;
      }

      if (typeof msg.method === "string") {
        const event: CdpEventMessage = {
          method: msg.method,
          params: (msg.params as Record<string, unknown>) ?? {},
          sessionId: typeof msg.sessionId === "string" ? msg.sessionId : undefined,
        };
        const set = this.listeners.get(msg.method);
        if (set) {
          for (const fn of set) fn(event);
        }
      }
    });

    ws.addEventListener("close", () => {
      this.closed = true;
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        entry.reject(new Error("CDP WebSocket closed before response"));
        this.pending.delete(id);
      }
    });
  }

  static connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`Timed out connecting to CDP at ${wsUrl}`));
      }, timeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error(`WebSocket connection failed for ${wsUrl}`));
      });
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = 15_000
  ): Promise<Record<string, unknown>> {
    if (this.closed) {
      return Promise.reject(new Error(`CDP client is closed (cannot call ${method})`));
    }
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(payload));
    });
  }

  waitForEvent(method: string, timeoutMs = 10_000, sessionId?: string): Promise<CdpEventMessage> {
    return new Promise((resolve, reject) => {
      const onEvent = (ev: CdpEventMessage) => {
        if (sessionId && ev.sessionId !== sessionId) return;
        cleanup();
        resolve(ev);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for CDP event: ${method}`));
      }, timeoutMs);

      const cleanup = () => {
        clearTimeout(timer);
        this.listeners.get(method)?.delete(onEvent);
      };

      let set = this.listeners.get(method);
      if (!set) {
        set = new Set();
        this.listeners.set(method, set);
      }
      set.add(onEvent);
    });
  }

  close(): void {
    if (!this.closed) {
      this.closed = true;
      try {
        this.ws.close();
      } catch {
        // ignore close errors
      }
    }
  }
}
