/**
 * devices.ts — Incus disk device helpers for host-mounted sessions.
 *
 * Implements the COI pattern: host directories mounted into containers with
 * shift=true for automatic UID mapping. Session files written inside a
 * container become readable on the host as the host user.
 *
 * ## Colima / macOS notes
 *
 * When running Incus inside Colima, the "host" from Incus's perspective is
 * the Colima Linux VM (profile: incus), NOT macOS. The source path for a disk
 * device must exist inside that VM. Files written inside a container will
 * appear at that VM path; to read them from macOS you would need an additional
 * mechanism (e.g. sshfs, colima file sharing, or Incus file pull).
 *
 * With shift=true, Incus attempts to use kernel idmap support (shiftfs or
 * overlay idmap). On the Colima incus VM, shift=true is accepted and files
 * appear owned by root (uid 0) in the VM — because the kernel's UID shift
 * maps container uid 0 to the subuid root for the container, which is uid 0
 * on a single-user VM. No large-uid weirdness observed.
 *
 * ## PUT → async
 *
 * PUT /1.0/instances/{name} returns an *async* operation response (not sync).
 * This module waits for that operation to complete before returning.
 */

import { z } from "zod";
import type { IncusClient } from "./client.ts";
import { IncusError } from "./client.ts";
import { waitOperation } from "./operations.ts";
import { AsyncOperationResponseSchema, incusSyncSchema } from "./schemas.ts";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

/** Minimal shape of GET /1.0/instances/{name} that we need */
const InstanceConfigSchema = incusSyncSchema(
  z.object({
    name: z.string(),
    config: z.record(z.string(), z.string()),
    devices: z.record(z.string(), z.record(z.string(), z.string())),
    profiles: z.array(z.string()),
    ephemeral: z.boolean(),
    type: z.string(),
    architecture: z.string().optional(),
    description: z.string().optional(),
    stateful: z.boolean().optional(),
    status: z.string().optional(),
    status_code: z.number().optional(),
    created_at: z.string().optional(),
    last_used_at: z.string().optional(),
    location: z.string().optional(),
    project: z.string().optional(),
    expanded_config: z.record(z.string(), z.string()).optional(),
    expanded_devices: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  }),
);

type InstanceConfig = z.infer<typeof InstanceConfigSchema>["metadata"];

// Used as the body for PUT /1.0/instances/{name}
const PutInstanceBodySchema = z.object({
  config: z.record(z.string(), z.string()),
  devices: z.record(z.string(), z.record(z.string(), z.string())),
  profiles: z.array(z.string()),
  ephemeral: z.boolean(),
  description: z.string().optional(),
  stateful: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiskDeviceConfig {
  type: "disk";
  source: string;
  path: string;
  shift: "true" | "false";
}

export interface MountResult {
  deviceName: string;
  device: DiskDeviceConfig;
  /** Whether shift=true was accepted by Incus without error */
  shiftAccepted: boolean;
  /** If shift failed, this fallback was used (shift=false) */
  shiftFallback: boolean;
}

// ---------------------------------------------------------------------------
// Internal: PUT instance config and wait for the async operation
// ---------------------------------------------------------------------------

async function putInstanceConfig(
  client: IncusClient,
  containerName: string,
  existing: InstanceConfig,
  devices: Record<string, Record<string, string>>,
): Promise<void> {
  const body = PutInstanceBodySchema.parse({
    config: existing.config,
    devices,
    profiles: existing.profiles,
    ephemeral: existing.ephemeral,
    description: existing.description ?? "",
    stateful: existing.stateful ?? false,
  });

  // PUT /1.0/instances/{name} returns an async operation.
  const response = await client.put(
    `/1.0/instances/${containerName}`,
    body,
    AsyncOperationResponseSchema,
  );
  await waitOperation(client, response.metadata.id, { timeoutSec: 60 });
}

// ---------------------------------------------------------------------------
// Core helper
// ---------------------------------------------------------------------------

/**
 * Add a disk device to a container (stopped or running), mounting `hostPath`
 * inside the container at `containerPath`.
 *
 * Attempts to use `shift=true` for automatic UID mapping. If Incus rejects
 * shift (kernel doesn't support it), falls back to `shift=false` and
 * documents the finding in the returned `MountResult`.
 *
 * **Important on Colima/macOS:** `hostPath` must be a path that exists inside
 * the Colima incus VM, not a macOS path. Create it with:
 *   `colima ssh --profile incus -- mkdir -p <hostPath>`
 *
 * @param client         - IncusClient connected to the Incus socket
 * @param containerName  - Name of the target container
 * @param hostPath       - Absolute path on the Incus host (Colima VM on macOS)
 * @param containerPath  - Absolute path inside the container
 * @param deviceName     - Name for the device entry (default: "sessions")
 * @returns MountResult with device config and shift status
 */
export async function mountHostDir(
  client: IncusClient,
  containerName: string,
  hostPath: string,
  containerPath: string,
  deviceName = "sessions",
): Promise<MountResult> {
  // Fetch the current instance config for a safe PUT (merge devices).
  let existing: InstanceConfig;
  try {
    const response = await client.get(`/1.0/instances/${containerName}`, InstanceConfigSchema);
    existing = response.metadata;
  } catch (err) {
    if (err instanceof IncusError) {
      throw new IncusError(
        `mountHostDir: failed to get config for container "${containerName}": ${err.message}`,
        err.statusCode,
        err.incusError,
      );
    }
    throw err;
  }

  // Try shift=true first.
  const deviceWithShift: DiskDeviceConfig = {
    type: "disk",
    source: hostPath,
    path: containerPath,
    shift: "true",
  };

  const devicesWithShift = {
    ...existing.devices,
    [deviceName]: deviceWithShift as unknown as Record<string, string>,
  };

  try {
    await putInstanceConfig(client, containerName, existing, devicesWithShift);

    return {
      deviceName,
      device: deviceWithShift,
      shiftAccepted: true,
      shiftFallback: false,
    };
  } catch (err) {
    // shift=true may fail if the kernel doesn't support idmapped mounts or
    // shiftfs. In that case, fall back to shift=false.
    const isShiftError =
      err instanceof IncusError &&
      (err.incusError.toLowerCase().includes("shift") ||
        err.incusError.toLowerCase().includes("idmap") ||
        err.incusError.toLowerCase().includes("shiftfs") ||
        err.incusError.toLowerCase().includes("not supported") ||
        err.incusError.toLowerCase().includes("unsupported"));

    if (!isShiftError) {
      throw err;
    }

    console.warn(
      `[mountHostDir] shift=true not supported on this host — falling back to shift=false. ` +
        `UID mapping will not work; files written inside the container may appear owned by ` +
        `a large UID on the host. Original error: ${(err as IncusError).incusError}`,
    );

    const deviceWithoutShift: DiskDeviceConfig = {
      type: "disk",
      source: hostPath,
      path: containerPath,
      shift: "false",
    };

    const devicesWithoutShift = {
      ...existing.devices,
      [deviceName]: deviceWithoutShift as unknown as Record<string, string>,
    };

    await putInstanceConfig(client, containerName, existing, devicesWithoutShift);

    return {
      deviceName,
      device: deviceWithoutShift,
      shiftAccepted: false,
      shiftFallback: true,
    };
  }
}

/**
 * Remove a disk device from a container by device name.
 */
export async function unmountHostDir(
  client: IncusClient,
  containerName: string,
  deviceName = "sessions",
): Promise<void> {
  const response = await client.get(`/1.0/instances/${containerName}`, InstanceConfigSchema);
  const existing = response.metadata;

  const updatedDevices = { ...existing.devices };
  delete updatedDevices[deviceName];

  await putInstanceConfig(client, containerName, existing, updatedDevices);
}
