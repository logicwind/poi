#!/usr/bin/env bun
/**
 * poi — Pi on Incus. Ephemeral sandbox for the Pi coding agent.
 *
 * Usage:
 *   poi [shell]     boot an ephemeral container and launch pi inside it
 *   poi build       build the poi-base template container (one-time)
 *   poi status      show template state and any running poi-* containers
 *   poi --help      show usage
 *
 * Any args after `poi shell` pass through to pi:
 *   poi shell --resume
 *   poi shell --model glm-4.6
 */

import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "./build.ts";
import { createSandbox } from "./sandbox.ts";
import { ensureIncusSocket } from "./socket.ts";
import { status } from "./status.ts";

const USAGE = `poi — Pi on Incus

usage:
  poi [shell] [-- <pi args>...]   boot ephemeral container, launch pi
  poi build                       build the poi-base template
  poi status                      show template + active sessions
  poi --help                      this text

env:
  POI_TEMPLATE       template container name (default: poi-base)
  POI_IMAGE          image for 'poi build'  (default: debian/12)
  POI_NODE_VERSION   node major version     (default: 20)
  INCUS_SOCKET       incus unix socket
                     (auto-detected: Linux default, then Colima on macOS)
`;

async function ensurePiStateDir(): Promise<string> {
  const dir = join(homedir(), ".pi", "agent");
  await mkdir(join(dir, "sessions"), { recursive: true });
  return dir;
}

function runIncusExec(containerName: string, piArgs: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const args = [
      "exec",
      "-t",
      "--cwd",
      "/work",
      "--env",
      "TERM=xterm-256color",
      containerName,
      "--",
      "pi",
      ...piArgs,
    ];
    const child = spawn("incus", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 0));
  });
}

async function shell(piArgs: string[]): Promise<number> {
  const cwd = process.cwd();
  const piStateDir = await ensurePiStateDir();

  process.stderr.write(`poi: booting sandbox for ${cwd}…\n`);

  const sandbox = await createSandbox({ hostCwd: cwd, piStateDir }).catch((err) => {
    process.stderr.write(`poi: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });

  let exitCode = 0;
  try {
    exitCode = await runIncusExec(sandbox.name, piArgs);
  } finally {
    process.stderr.write("\npoi: tearing down…\n");
    await sandbox.destroy().catch((err) => {
      process.stderr.write(
        `poi: destroy failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    });
  }
  return exitCode;
}

function reportIncusFailure(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const socket = process.env.INCUS_SOCKET ?? "(unresolved)";
  const lines = [`poi: ${msg}`, "", `Incus socket: ${socket}`];
  if (msg.includes("typo in the url or port") || msg.toLowerCase().includes("not found")) {
    lines.push(
      "",
      "Likely causes:",
      "  - Incus daemon isn't running",
      "  - your user isn't in the incus-admin group",
      "  - on macOS: Colima's incus profile isn't started (colima start --profile incus)",
      "  - INCUS_SOCKET points at the wrong path",
    );
  }
  process.stderr.write(`${lines.join("\n")}\n`);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);

  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(USAGE);
    return;
  }

  // Everything past this point needs Incus. Resolve the socket once so
  // every downstream IncusClient picks it up from env.
  ensureIncusSocket();

  try {
    if (cmd === "build") {
      await build();
      return;
    }

    if (cmd === "status") {
      await status();
      return;
    }

    // Default or explicit `shell`. Everything after is piped to pi.
    const piArgs = cmd === "shell" || cmd === undefined ? rest : [cmd, ...rest];
    const exitCode = await shell(piArgs);
    process.exit(exitCode);
  } catch (err) {
    reportIncusFailure(err);
    process.exit(1);
  }
}

await main();
