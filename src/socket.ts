/**
 * socket.ts — resolve the Incus Unix socket across platforms.
 *
 * Order:
 *   1. $INCUS_SOCKET (explicit wins)
 *   2. /var/lib/incus/unix.socket (Linux native default)
 *   3. $HOME/.colima/incus/incus.sock (macOS + Colima incus profile)
 *
 * If none exist, return a structured failure with platform-appropriate
 * suggestions so the CLI can print a helpful error.
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface SocketCandidate {
  path: string;
  label: string;
}

export type ResolveResult =
  | { ok: true; path: string; source: "env" | "default"; tried: SocketCandidate[] }
  | { ok: false; tried: SocketCandidate[]; suggestions: string[] };

export function candidatesFor(osPlatform: NodeJS.Platform): SocketCandidate[] {
  const list: SocketCandidate[] = [{ path: "/var/lib/incus/unix.socket", label: "Linux default" }];
  if (osPlatform === "darwin") {
    list.push({
      path: join(homedir(), ".colima", "incus", "incus.sock"),
      label: "Colima (incus profile)",
    });
  }
  return list;
}

export function suggestionsFor(osPlatform: NodeJS.Platform): string[] {
  if (osPlatform === "darwin") {
    return [
      "On macOS, poi needs Colima with the incus profile running:",
      "  brew install colima incus",
      "  colima start --profile incus --runtime incus",
      "",
      "If Colima exposes the socket at a different path, export it:",
      "  export INCUS_SOCKET=/path/to/incus.sock",
    ];
  }
  if (osPlatform === "linux") {
    return [
      "On Linux, make sure Incus is installed and running:",
      "  sudo systemctl status incus",
      "  sudo usermod -aG incus-admin $USER   # then log out and back in",
    ];
  }
  if (osPlatform === "win32") {
    return [
      "On Windows, poi runs inside WSL2 — not directly on Windows.",
      "Install Ubuntu/Debian WSL, install Incus inside it, then run poi from the WSL shell.",
      "See: https://github.com/logicwind/poi#running-on-windows",
    ];
  }
  return [
    `Platform "${osPlatform}" isn't supported — poi needs a Linux host (native, WSL2, or a VM).`,
  ];
}

export function resolveIncusSocket(
  env: NodeJS.ProcessEnv = process.env,
  osPlatform: NodeJS.Platform = platform(),
  exists: (p: string) => boolean = existsSync,
): ResolveResult {
  const tried = candidatesFor(osPlatform);

  const explicit = env.INCUS_SOCKET;
  if (explicit) {
    if (exists(explicit)) {
      return { ok: true, path: explicit, source: "env", tried };
    }
    return {
      ok: false,
      tried: [{ path: explicit, label: "INCUS_SOCKET env" }],
      suggestions: [
        `INCUS_SOCKET is set to "${explicit}" but that path doesn't exist.`,
        "Unset it (to auto-detect) or correct the path:",
        "  unset INCUS_SOCKET",
        "",
        ...suggestionsFor(osPlatform),
      ],
    };
  }

  for (const c of tried) {
    if (exists(c.path)) {
      return { ok: true, path: c.path, source: "default", tried };
    }
  }

  return { ok: false, tried, suggestions: suggestionsFor(osPlatform) };
}

/**
 * Resolve the socket and fail fast with a human-readable error if nothing
 * works. On success, export to process.env so IncusClient picks it up.
 */
export function ensureIncusSocket(): string {
  const result = resolveIncusSocket();
  if (result.ok) {
    process.env.INCUS_SOCKET = result.path;
    return result.path;
  }

  const lines: string[] = [
    "poi: no Incus socket reachable.",
    "",
    "Tried:",
    ...result.tried.map((c) => `  - ${c.path}  (${c.label})`),
    "",
    ...result.suggestions,
  ];
  process.stderr.write(`${lines.join("\n")}\n`);
  process.exit(1);
}
