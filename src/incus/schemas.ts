/**
 * Zod schemas for Incus REST API responses.
 * All API responses share an envelope; the `metadata` field varies by endpoint.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Base envelope
// ---------------------------------------------------------------------------

export const IncusEnvelopeBase = z.object({
  type: z.enum(["sync", "async", "error"]),
  status: z.string(),
  status_code: z.number(),
  operation: z.string(),
  error_code: z.number(),
  error: z.string(),
});

export function incusSyncSchema<T extends z.ZodTypeAny>(metadataSchema: T) {
  return IncusEnvelopeBase.extend({
    type: z.literal("sync"),
    metadata: metadataSchema,
  });
}

export function incusAsyncSchema<T extends z.ZodTypeAny>(metadataSchema: T) {
  return IncusEnvelopeBase.extend({
    type: z.literal("async"),
    metadata: metadataSchema,
  });
}

// ---------------------------------------------------------------------------
// Operation
// ---------------------------------------------------------------------------

export const OperationStatusSchema = z.enum([
  "Pending",
  "Running",
  "Cancelling",
  "Success",
  "Failure",
]);

export type OperationStatus = z.infer<typeof OperationStatusSchema>;

/** Metadata for exec operations */
export const ExecOperationMetadataSchema = z.object({
  output: z.record(z.string(), z.string()).optional().describe("fd number → log path"),
  return: z.number().optional().describe("exit code"),
});

export type ExecOperationMetadata = z.infer<typeof ExecOperationMetadataSchema>;

/** Generic operation resource shape */
export const OperationSchema = z.object({
  id: z.string().uuid(),
  class: z.enum(["task", "websocket", "token"]),
  description: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  status: OperationStatusSchema,
  status_code: z.number(),
  resources: z.record(z.string(), z.array(z.string())).nullable(),
  metadata: z.unknown().nullable(),
  may_cancel: z.boolean(),
  err: z.string(),
  location: z.string(),
});

export type Operation = z.infer<typeof OperationSchema>;

/** Async response returned when an operation is created */
export const AsyncOperationResponseSchema = IncusEnvelopeBase.extend({
  type: z.literal("async"),
  metadata: OperationSchema,
});

export type AsyncOperationResponse = z.infer<typeof AsyncOperationResponseSchema>;

/** Sync response returned when /wait completes */
export const WaitResponseSchema = incusSyncSchema(OperationSchema);
export type WaitResponse = z.infer<typeof WaitResponseSchema>;

// ---------------------------------------------------------------------------
// Instance (container)
// ---------------------------------------------------------------------------

export const InstanceStateNetworkSchema = z.object({
  addresses: z
    .array(
      z.object({
        family: z.string(),
        address: z.string(),
        netmask: z.string(),
        scope: z.string(),
      }),
    )
    .optional(),
  counters: z.unknown().optional(),
  hwaddr: z.string().optional(),
  host_name: z.string().optional(),
  mtu: z.number().optional(),
  state: z.string().optional(),
  type: z.string().optional(),
});

export const InstanceStateSchema = z.object({
  status: z.string(),
  status_code: z.number(),
  disk: z.record(z.string(), z.unknown()).nullable().optional(),
  memory: z.unknown().nullable().optional(),
  network: z.record(z.string(), InstanceStateNetworkSchema).nullable().optional(),
  pid: z.number().optional(),
  processes: z.number().optional(),
  cpu: z.unknown().optional(),
});

export type InstanceState = z.infer<typeof InstanceStateSchema>;

export const InstanceStateResponseSchema = incusSyncSchema(InstanceStateSchema);

/** Source for creating a container */
export const InstanceSourceSchema = z.object({
  type: z.enum(["image", "copy", "migration", "none"]),
  /** Name of the source container when type="copy" */
  source: z.string().optional(),
  alias: z.string().optional(),
  server: z.string().optional(),
  protocol: z.enum(["simplestreams", "incus"]).optional(),
  fingerprint: z.string().optional(),
  properties: z.record(z.string(), z.string()).optional(),
  mode: z.enum(["pull", "push"]).optional(),
  base_image: z.string().optional(),
});

export type InstanceSource = z.infer<typeof InstanceSourceSchema>;

/** Body for POST /1.0/instances */
export const CreateInstanceBodySchema = z.object({
  name: z.string(),
  type: z.enum(["container", "virtual-machine"]).default("container"),
  source: InstanceSourceSchema,
  config: z.record(z.string(), z.string()).optional(),
  profiles: z.array(z.string()).optional(),
  ephemeral: z.boolean().optional(),
});

export type CreateInstanceBody = z.infer<typeof CreateInstanceBodySchema>;

/** Body for PUT /1.0/instances/{name}/state */
export const StateActionBodySchema = z.object({
  action: z.enum(["start", "stop", "restart", "freeze", "unfreeze"]),
  timeout: z.number().optional(),
  force: z.boolean().optional(),
  stateful: z.boolean().optional(),
});

export type StateActionBody = z.infer<typeof StateActionBodySchema>;

/** Body for POST /1.0/instances/{name}/exec */
export const ExecBodySchema = z.object({
  command: z.array(z.string()),
  environment: z.record(z.string(), z.string()).optional(),
  interactive: z.boolean().optional(),
  "wait-for-websocket": z.boolean().optional(),
  "record-output": z.boolean().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  cwd: z.string().optional(),
  user: z.number().optional(),
  group: z.number().optional(),
});

export type ExecBody = z.infer<typeof ExecBodySchema>;

/** Result from execInstance — parsed exit code + captured stdout/stderr */
export const ExecResultSchema = z.object({
  exitCode: z.number(),
  stdout: z.string(),
  stderr: z.string(),
});

export type ExecResult = z.infer<typeof ExecResultSchema>;

// ---------------------------------------------------------------------------
// Error response
// ---------------------------------------------------------------------------

export const ErrorResponseSchema = IncusEnvelopeBase.extend({
  type: z.literal("error"),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
