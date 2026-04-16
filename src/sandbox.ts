/**
 * sandbox.ts — ephemeral Incus container for a single `poi shell` session.
 *
 * Clones a stopped template, mounts two host directories, returns a handle.
 * Everything else (running Pi, TUI, tool execution) happens inside the
 * container.
 *
 * Mounts:
 *   <cwd>         (host) → /work                (container)   shift=true
 *   ~/.pi/agent   (host) → /root/.pi/agent      (container)   shift=true
 *
 * The second mount is the point of Pi session persistence. Sessions, auth,
 * models.json, settings.json all live on the host. The container sees them
 * live — rotate keys on the host and the next session picks them up.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { IncusClient } from "./incus/client.ts";
import { getInstanceState } from "./incus/instances.ts";
import { mountHostDir } from "./incus/devices.ts";
import { cloneEphemeral } from "./incus/clone.ts";

export interface SandboxOptions {
  /** Template container to clone. Defaults to POI_TEMPLATE or "poi-base". */
  template?: string;
  /** Host cwd that maps to /work inside the container. */
  hostCwd: string;
  /** Host Pi state dir → /root/.pi/agent. Defaults to ~/.pi/agent. */
  piStateDir?: string;
  /** Incus socket path. Defaults to /var/lib/incus/unix.socket. */
  socketPath?: string;
}

export interface Sandbox {
  /** Name of the ephemeral container (for `incus exec`, debugging). */
  readonly name: string;
  /** Stop the container — the ephemeral flag auto-deletes it. */
  destroy(): Promise<void>;
}

export async function createSandbox(options: SandboxOptions): Promise<Sandbox> {
  const template = options.template ?? process.env.POI_TEMPLATE ?? "poi-base";
  const piStateDir = options.piStateDir ?? join(homedir(), ".pi", "agent");
  const client = new IncusClient({ socketPath: options.socketPath });

  try {
    const state = await getInstanceState(client, template);
    if (state.status !== "Stopped") {
      throw new Error(
        `template "${template}" is ${state.status}, must be Stopped. Run: incus stop ${template}`,
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `sandbox: template "${template}" unavailable: ${msg}. Run 'poi build' to create it`,
    );
  }

  const { handle } = await cloneEphemeral(client, template, {
    name: `poi-${Date.now()}`,
  });

  // Files written inside /work appear on the host as the host user (shift=true).
  await mountHostDir(client, handle.name, options.hostCwd, "/work", "work");

  // Share Pi's state dir so sessions, auth, models persist across runs.
  await mountHostDir(client, handle.name, piStateDir, "/root/.pi/agent", "pi-state");

  return {
    name: handle.name,
    destroy: () => handle.stop(true),
  };
}
