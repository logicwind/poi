/**
 * Container CRUD, state management, and exec for the Incus API.
 *
 * All mutating operations return Operation objects. Callers should use
 * waitOperation() to block until the operation completes.
 */
import type { IncusClient } from "./client.js";
import { IncusError } from "./client.js";
import { waitOperation } from "./operations.js";
import {
  AsyncOperationResponseSchema,
  type CreateInstanceBody,
  type ExecResult,
  InstanceStateResponseSchema,
  type Operation,
} from "./schemas.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _extractOperationUuid(operationPath: string): string {
  const uuid = operationPath.split("/").pop();
  if (!uuid) {
    throw new IncusError(
      `Could not extract UUID from operation path "${operationPath}"`,
      0,
      "invalid operation path",
    );
  }
  return uuid;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/**
 * Create a container (async — returns operation).
 *
 * @example
 * const op = await createInstance(client, {
 *   name: "my-container",
 *   type: "container",
 *   source: {
 *     type: "image",
 *     alias: "debian/12",
 *     server: "https://images.linuxcontainers.org",
 *     protocol: "simplestreams",
 *   },
 * });
 * await waitOperation(client, op.id);
 */
export async function createInstance(
  client: IncusClient,
  config: CreateInstanceBody,
): Promise<Operation> {
  const response = await client.post("/1.0/instances", config, AsyncOperationResponseSchema);
  return response.metadata;
}

/**
 * Delete a container (async — returns operation).
 * The container must be stopped before deletion.
 */
export async function deleteInstance(client: IncusClient, name: string): Promise<Operation> {
  const response = await client.delete(`/1.0/instances/${name}`, AsyncOperationResponseSchema);
  return response.metadata;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/**
 * Start a container (async — returns operation).
 */
export async function startInstance(client: IncusClient, name: string): Promise<Operation> {
  const response = await client.put(
    `/1.0/instances/${name}/state`,
    { action: "start", timeout: 30 },
    AsyncOperationResponseSchema,
  );
  return response.metadata;
}

/**
 * Stop a container (async — returns operation).
 * Pass `force: true` to skip graceful shutdown.
 */
export async function stopInstance(
  client: IncusClient,
  name: string,
  force = false,
): Promise<Operation> {
  const response = await client.put(
    `/1.0/instances/${name}/state`,
    { action: "stop", timeout: 30, force },
    AsyncOperationResponseSchema,
  );
  return response.metadata;
}

/**
 * Get the current runtime state of a container.
 */
export async function getInstanceState(client: IncusClient, name: string) {
  const response = await client.get(`/1.0/instances/${name}/state`, InstanceStateResponseSchema);
  return response.metadata;
}

// ---------------------------------------------------------------------------
// Exec
// ---------------------------------------------------------------------------

/**
 * Execute a command inside a running container and return stdout/stderr/exitCode.
 *
 * Uses `record-output: true` mode (non-interactive, no WebSocket required).
 * Incus saves stdout/stderr to log files; this function fetches them after
 * the exec operation completes.
 *
 * @param client - IncusClient instance
 * @param name   - Container name
 * @param command - Command + args array, e.g. ["echo", "hello"]
 * @param env    - Optional environment variables
 */
export async function execInstance(
  client: IncusClient,
  name: string,
  command: string[],
  env: Record<string, string> = {},
): Promise<ExecResult> {
  // Kick off the exec operation
  const execResponse = await client.post(
    `/1.0/instances/${name}/exec`,
    {
      command,
      environment: env,
      interactive: false,
      "wait-for-websocket": false,
      "record-output": true,
    },
    AsyncOperationResponseSchema,
  );

  const opId = execResponse.metadata.id;

  // Wait for exec to finish
  const completedOp = await waitOperation(client, opId);

  // Extract exit code and log paths from operation metadata
  const meta = completedOp.metadata as {
    return?: number;
    output?: Record<string, string>;
  } | null;

  const exitCode = meta?.return ?? -1;
  const stdoutPath = meta?.output?.["1"];
  const stderrPath = meta?.output?.["2"];

  // Fetch stdout/stderr log content
  let stdout = "";
  let stderr = "";

  if (stdoutPath) {
    try {
      stdout = await client.getText(stdoutPath);
    } catch {
      // Log may not exist if command produced no output
      stdout = "";
    }
  }
  if (stderrPath) {
    try {
      stderr = await client.getText(stderrPath);
    } catch {
      stderr = "";
    }
  }

  if (exitCode !== 0) {
    throw new IncusError(
      `exec "${command.join(" ")}" in ${name} exited with code ${exitCode}: ${stderr.trim() || "(no stderr)"}. Check command and container state`,
      exitCode,
      stderr.trim(),
    );
  }

  return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Convenience: full lifecycle helpers
// ---------------------------------------------------------------------------

/**
 * Create and start a container, waiting for each step to complete.
 * Returns when the container is Running.
 */
export async function createAndStart(
  client: IncusClient,
  config: CreateInstanceBody,
): Promise<void> {
  const createOp = await createInstance(client, config);
  await waitOperation(client, createOp.id);

  const startOp = await startInstance(client, config.name);
  await waitOperation(client, startOp.id);
}

/**
 * Stop and delete a container, waiting for each step to complete.
 * Passes `force: true` to ensure the container stops even if unresponsive.
 */
export async function stopAndDelete(client: IncusClient, name: string): Promise<void> {
  const stopOp = await stopInstance(client, name, true);
  await waitOperation(client, stopOp.id);

  const deleteOp = await deleteInstance(client, name);
  await waitOperation(client, deleteOp.id);
}

/**
 * Delete a container if it exists, silently ignoring 404 errors.
 * Useful for test teardown where the container may or may not exist.
 */
export async function deleteIfExists(client: IncusClient, name: string): Promise<void> {
  try {
    const state = await getInstanceState(client, name);
    if (state.status === "Running") {
      const stopOp = await stopInstance(client, name, true);
      await waitOperation(client, stopOp.id);
    }
    const deleteOp = await deleteInstance(client, name);
    await waitOperation(client, deleteOp.id);
  } catch (err) {
    // If it's a 404, the container doesn't exist — that's fine
    if (
      err instanceof IncusError &&
      (err.message.includes("not found") ||
        err.incusError.toLowerCase().includes("not found") ||
        err.statusCode === 404)
    ) {
      return;
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Re-export waitOperation for convenience
// ---------------------------------------------------------------------------
export { waitOperation } from "./operations.js";
