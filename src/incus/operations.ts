/**
 * Async operation polling/wait for the Incus API.
 *
 * Incus returns { type: "async", operation: "/1.0/operations/{uuid}" } for
 * long-running tasks. This module provides `waitOperation` which calls
 * GET /1.0/operations/{uuid}/wait?timeout=N  (server-side long-poll) and
 * validates the result.
 */
import type { IncusClient } from "./client.js";
import { IncusError } from "./client.js";
import { type Operation, WaitResponseSchema } from "./schemas.js";

export interface WaitOptions {
  /** Server-side wait timeout in seconds. Default: 120 */
  timeoutSec?: number;
}

/**
 * Wait for an async Incus operation to complete.
 * Uses the server-side `/wait` endpoint (long-poll, not polling).
 *
 * @param client - IncusClient instance
 * @param operationPath - Full path like `/1.0/operations/{uuid}` or just the uuid
 * @returns The completed Operation metadata
 * @throws IncusError if the operation fails or times out
 */
export async function waitOperation(
  client: IncusClient,
  operationPath: string,
  options: WaitOptions = {},
): Promise<Operation> {
  const timeoutSec = options.timeoutSec ?? 120;

  // Accept either a full path or a bare UUID
  const uuid = operationPath.startsWith("/") ? operationPath.split("/").pop()! : operationPath;

  if (!uuid) {
    throw new IncusError(
      `waitOperation: invalid operation path "${operationPath}". Pass the full operation path from the async response`,
      0,
      "invalid operation path",
    );
  }

  const waitPath = `/1.0/operations/${uuid}/wait?timeout=${timeoutSec}`;
  const response = await client.get(waitPath, WaitResponseSchema);

  const op = response.metadata;

  if (op.status === "Failure") {
    throw new IncusError(
      `operation ${uuid} failed: ${op.err || "(no error message)"}. Check Incus logs for details`,
      op.status_code,
      op.err,
    );
  }

  if (op.status !== "Success") {
    throw new IncusError(
      `operation ${uuid} ended with unexpected status "${op.status}". Expected "Success"`,
      op.status_code,
      op.status,
    );
  }

  return op;
}
