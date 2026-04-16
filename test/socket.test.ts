/**
 * socket.test.ts — resolveIncusSocket is pure (takes env, platform, and an
 * exists() callback) so every path is testable without touching the fs.
 */

import { describe, expect, test } from "bun:test";
import { candidatesFor, resolveIncusSocket, suggestionsFor } from "../src/socket.ts";

const NEVER_EXISTS = () => false;
const ALWAYS_EXISTS = () => true;

describe("candidatesFor", () => {
  test("Linux returns only the native socket", () => {
    const list = candidatesFor("linux");
    expect(list).toHaveLength(1);
    expect(list[0]!.path).toBe("/var/lib/incus/unix.socket");
  });

  test("darwin adds the Colima socket", () => {
    const list = candidatesFor("darwin");
    expect(list).toHaveLength(2);
    expect(list[1]!.path).toContain(".colima/incus/incus.sock");
  });
});

describe("suggestionsFor", () => {
  test("darwin mentions Colima", () => {
    const hints = suggestionsFor("darwin").join("\n");
    expect(hints.toLowerCase()).toContain("colima");
  });

  test("linux mentions incus-admin group", () => {
    const hints = suggestionsFor("linux").join("\n");
    expect(hints).toContain("incus-admin");
  });

  test("win32 points at WSL docs", () => {
    const hints = suggestionsFor("win32").join("\n");
    expect(hints.toLowerCase()).toContain("wsl");
  });
});

describe("resolveIncusSocket", () => {
  test("INCUS_SOCKET env wins when the file exists", () => {
    const result = resolveIncusSocket({ INCUS_SOCKET: "/custom/sock" }, "linux", ALWAYS_EXISTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe("/custom/sock");
      expect(result.source).toBe("env");
    }
  });

  test("INCUS_SOCKET that doesn't exist is rejected with a clear message", () => {
    const result = resolveIncusSocket(
      { INCUS_SOCKET: "/tmp/nope-poi.sock" },
      "linux",
      NEVER_EXISTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hints = result.suggestions.join("\n");
      expect(hints).toContain("/tmp/nope-poi.sock");
      expect(hints).toContain("Unset it");
    }
  });

  test("linux: falls back to default when present", () => {
    const result = resolveIncusSocket({}, "linux", (p) => p === "/var/lib/incus/unix.socket");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe("/var/lib/incus/unix.socket");
      expect(result.source).toBe("default");
    }
  });

  test("darwin: falls back to Colima when present", () => {
    const result = resolveIncusSocket({}, "darwin", (p) => p.endsWith(".colima/incus/incus.sock"));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toMatch(/\.colima\/incus\/incus\.sock$/);
    }
  });

  test("darwin: tries Linux default first, then Colima", () => {
    const result = resolveIncusSocket({}, "darwin", ALWAYS_EXISTS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toBe("/var/lib/incus/unix.socket");
    }
  });

  test("returns failure with suggestions when nothing exists", () => {
    const result = resolveIncusSocket({}, "darwin", NEVER_EXISTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.tried).toHaveLength(2);
      expect(result.suggestions.join("\n").toLowerCase()).toContain("colima");
    }
  });

  test("unknown platform still returns a helpful failure", () => {
    const result = resolveIncusSocket({}, "freebsd" as NodeJS.Platform, NEVER_EXISTS);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.suggestions.join(" ").toLowerCase()).toContain("linux");
    }
  });
});
