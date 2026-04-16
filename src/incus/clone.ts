/**
 * cloneEphemeral — clone a stopped template container with `ephemeral: true`,
 * start it, and return a handle with exec() and stop() methods.
 *
 * When stop() is called, the ephemeral flag causes Incus to auto-delete the
 * clone — no manual cleanup required.
 */
import type { IncusClient } from "./client.ts";
import {
  createInstance,
  execInstance,
  getInstanceState,
  startInstance,
  stopInstance,
  waitOperation,
} from "./instances.ts";
import type { ExecResult } from "./schemas.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TaskConfig {
  /** Name for the clone. If omitted, a timestamped name is generated. */
  name?: string;
  /** Extra container config key/value pairs forwarded to Incus. */
  config?: Record<string, string>;
  /** Profiles to apply to the clone. Defaults to ["default"]. */
  profiles?: string[];
}

export interface CloneHandle {
  /** Name of the ephemeral clone container. */
  readonly name: string;
  /** Execute a command inside the running clone. Throws on non-zero exit. */
  exec(command: string[], env?: Record<string, string>): Promise<ExecResult>;
  /**
   * Stop the clone. Because it is ephemeral, Incus will auto-delete it
   * immediately after it stops — no separate delete call needed.
   */
  stop(force?: boolean): Promise<void>;
}

export interface CloneResult {
  handle: CloneHandle;
  /** Wall-clock milliseconds from POST /instances to operation complete. */
  cloneMs: number;
  /** Wall-clock milliseconds from PUT /state?start to operation complete. */
  startMs: number;
  /** Total milliseconds from first API call to container Running. */
  totalMs: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

function generateCloneName(templateName: string): string {
  const ts = Date.now();
  // Keep names short and DNS-safe: <template>-<timestamp>
  const base = templateName.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `${base}-${ts}`;
}

/**
 * Clone a stopped template container with `ephemeral: true`, start it,
 * and return a handle + timing information.
 *
 * @param client       - Connected IncusClient
 * @param templateName - Name of the (stopped) template container to copy
 * @param taskConfig   - Optional clone name / config overrides
 */
export async function cloneEphemeral(
  client: IncusClient,
  templateName: string,
  taskConfig: TaskConfig = {},
): Promise<CloneResult> {
  const cloneName = taskConfig.name ?? generateCloneName(templateName);

  // --- 1. Copy with ephemeral: true ---
  const cloneStart = performance.now();

  const createOp = await createInstance(client, {
    name: cloneName,
    type: "container",
    source: {
      type: "copy",
      source: templateName,
    },
    ephemeral: true,
    config: taskConfig.config,
    profiles: taskConfig.profiles,
  });

  await waitOperation(client, createOp.id);
  const cloneMs = Math.round(performance.now() - cloneStart);

  // --- 2. Start the clone ---
  const startStart = performance.now();

  const startOp = await startInstance(client, cloneName);
  await waitOperation(client, startOp.id);

  const startMs = Math.round(performance.now() - startStart);
  const totalMs = Math.round(performance.now() - cloneStart);

  // --- 3. Build handle ---
  const handle: CloneHandle = {
    name: cloneName,

    async exec(command: string[], env: Record<string, string> = {}): Promise<ExecResult> {
      return execInstance(client, cloneName, command, env);
    },

    async stop(force = true): Promise<void> {
      try {
        const stopOp = await stopInstance(client, cloneName, force);
        await waitOperation(client, stopOp.id);
      } catch (err: unknown) {
        // If the container is already gone (ephemeral auto-delete race), ignore
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.toLowerCase().includes("not found") ||
          msg.toLowerCase().includes("instance not found")
        ) {
          return;
        }
        throw err;
      }
    },
  };

  return { handle, cloneMs, startMs, totalMs };
}

// ---------------------------------------------------------------------------
// Utility: verify a container exists (for template integrity checks)
// ---------------------------------------------------------------------------

/**
 * Return true if the named container exists and has the expected status.
 */
export async function containerExists(
  client: IncusClient,
  name: string,
  expectedStatus?: string,
): Promise<boolean> {
  try {
    const state = await getInstanceState(client, name);
    if (expectedStatus) {
      return state.status === expectedStatus;
    }
    return true;
  } catch {
    return false;
  }
}
