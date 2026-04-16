/**
 * IncusClient — thin transport wrapper over Bun fetch with Unix socket support.
 *
 * Bun's fetch accepts `{ unix: "/path/to/socket" }` in the options object,
 * which bypasses TCP and speaks HTTP over the Unix domain socket directly.
 * This is sufficient; undici is kept as a dep for future use but not used here.
 *
 * All responses are validated with Zod schemas before being returned.
 */
import type { z } from "zod";
import { ErrorResponseSchema } from "./schemas.js";

export class IncusError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly incusError: string,
  ) {
    super(message);
    this.name = "IncusError";
  }
}

export interface IncusClientOptions {
  /** Path to the Incus Unix socket. Defaults to INCUS_SOCKET env var or /var/lib/incus/unix.socket */
  socketPath?: string;
  /** Request timeout in milliseconds. Default: 120_000 */
  timeoutMs?: number;
}

export class IncusClient {
  readonly socketPath: string;
  private readonly timeoutMs: number;

  constructor(options: IncusClientOptions = {}) {
    this.socketPath =
      options.socketPath ?? process.env.INCUS_SOCKET ?? "/var/lib/incus/unix.socket";
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  /**
   * Make a raw HTTP request over the Unix socket.
   * Returns the parsed JSON body; throws IncusError on non-2xx or Incus error envelopes.
   */
  async request<T>(path: string, method: string = "GET", body?: unknown): Promise<T> {
    const url = `http://localhost${path}`;
    const opts: RequestInit & { unix: string; signal: AbortSignal } = {
      method,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      // Bun-specific fetch extension: route the request over a Unix socket.
      unix: this.socketPath,
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    if (body !== undefined) {
      opts.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new IncusError(
        `request to ${path} failed: ${msg}. Check that Incus is running and the socket path is correct (${this.socketPath})`,
        0,
        msg,
      );
    }

    const raw: unknown = await res.json();

    // Detect Incus error envelope
    const maybeError = ErrorResponseSchema.safeParse(raw);
    if (maybeError.success && maybeError.data.type === "error") {
      const { error, error_code } = maybeError.data;
      throw new IncusError(
        `Incus API error on ${method} ${path}: ${error}. Check instance name, resource availability, and Incus logs`,
        error_code,
        error,
      );
    }

    return raw as T;
  }

  /**
   * GET convenience — returns validated data via provided Zod schema.
   */
  async get<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    const raw = await this.request(path, "GET");
    return schema.parse(raw);
  }

  /**
   * POST convenience — returns validated data via provided Zod schema.
   */
  async post<S extends z.ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    const raw = await this.request(path, "POST", body);
    return schema.parse(raw);
  }

  /**
   * PUT convenience — returns validated data via provided Zod schema.
   */
  async put<S extends z.ZodTypeAny>(path: string, body: unknown, schema: S): Promise<z.infer<S>> {
    const raw = await this.request(path, "PUT", body);
    return schema.parse(raw);
  }

  /**
   * DELETE convenience — returns validated data via provided Zod schema.
   */
  async delete<S extends z.ZodTypeAny>(path: string, schema: S): Promise<z.infer<S>> {
    const raw = await this.request(path, "DELETE");
    return schema.parse(raw);
  }

  /**
   * GET a raw text response (used for log files).
   */
  async getText(path: string): Promise<string> {
    const url = `http://localhost${path}`;
    const opts: RequestInit & { unix: string; signal: AbortSignal } = {
      method: "GET",
      unix: this.socketPath,
      signal: AbortSignal.timeout(this.timeoutMs),
    };
    let res: Response;
    try {
      res = await fetch(url, opts);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw new IncusError(
        `getText ${path} failed: ${msg}. Check socket path (${this.socketPath})`,
        0,
        msg,
      );
    }
    if (!res.ok) {
      throw new IncusError(
        `getText ${path} returned HTTP ${res.status}. Check the log path is valid`,
        res.status,
        `HTTP ${res.status}`,
      );
    }
    return res.text();
  }
}
