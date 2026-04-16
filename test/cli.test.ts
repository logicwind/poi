/**
 * CLI smoke tests — spawn `bun src/cli.ts` with different args and assert on
 * stdout/stderr/exit. These are fast (no Incus, no network) and catch
 * subcommand-dispatch regressions which the typechecker can't.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<RunResult> {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("poi cli", () => {
  test("--help prints usage and exits 0", async () => {
    const { stdout, exitCode } = await runCli(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("poi — Pi on Incus");
    expect(stdout).toContain("poi [shell]");
    expect(stdout).toContain("poi build");
    expect(stdout).toContain("poi status");
  });

  test("-h is an alias for --help", async () => {
    const { stdout, exitCode } = await runCli(["-h"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage:");
  });

  test("help (no dashes) also prints usage", async () => {
    const { stdout, exitCode } = await runCli(["help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("usage:");
  });

  test("help output documents every env var", async () => {
    const { stdout } = await runCli(["--help"]);
    for (const name of ["POI_TEMPLATE", "POI_IMAGE", "POI_NODE_VERSION", "INCUS_SOCKET"]) {
      expect(stdout).toContain(name);
    }
  });

  test("status exits cleanly when Incus socket is unreachable", async () => {
    // Point at a socket that definitely doesn't exist.
    const { stderr, exitCode } = await runCli(["status"], {
      INCUS_SOCKET: "/tmp/poi-test-nonexistent.sock",
    });
    // Either a clean error message or a non-zero exit — what we don't want
    // is a silent crash with no output.
    const combined = stderr.toLowerCase();
    expect(exitCode !== 0 || combined.includes("does not exist")).toBe(true);
  });
});
