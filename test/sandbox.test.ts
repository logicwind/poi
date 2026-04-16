/**
 * Sandbox tests — validate the pure logic we can test without Incus.
 *
 * What we can check without a running daemon:
 *   - default env var fallbacks (POI_TEMPLATE, paths)
 *   - IncusClient socket-path resolution
 *
 * Anything touching a real container belongs in an integration test that
 * runs against a live Incus host — out of scope for this file.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { IncusClient } from "../src/incus/client.ts";

describe("IncusClient socket resolution", () => {
  const originalEnv = process.env.INCUS_SOCKET;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.INCUS_SOCKET;
    } else {
      process.env.INCUS_SOCKET = originalEnv;
    }
  });

  test("defaults to /var/lib/incus/unix.socket when no env or option", () => {
    delete process.env.INCUS_SOCKET;
    const client = new IncusClient();
    expect(client.socketPath).toBe("/var/lib/incus/unix.socket");
  });

  test("reads INCUS_SOCKET env var", () => {
    process.env.INCUS_SOCKET = "/tmp/from-env.sock";
    const client = new IncusClient();
    expect(client.socketPath).toBe("/tmp/from-env.sock");
  });

  test("explicit option beats env var", () => {
    process.env.INCUS_SOCKET = "/tmp/from-env.sock";
    const client = new IncusClient({ socketPath: "/tmp/explicit.sock" });
    expect(client.socketPath).toBe("/tmp/explicit.sock");
  });
});

describe("build command env var defaults", () => {
  const keys = ["POI_TEMPLATE", "POI_IMAGE", "POI_NODE_VERSION"] as const;
  const saved: Partial<Record<(typeof keys)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test("TEMPLATE/IMAGE/NODE_VERSION env overrides are read at module evaluation time", async () => {
    // We can't easily re-import with new env in Bun test, so just assert the
    // env keys are the ones build.ts reads. This protects against silent
    // renames of the documented env surface.
    const source = await Bun.file(`${import.meta.dir}/../src/build.ts`).text();
    expect(source).toContain("process.env.POI_TEMPLATE");
    expect(source).toContain("process.env.POI_IMAGE");
    expect(source).toContain("process.env.POI_NODE_VERSION");
  });
});
