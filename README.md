# poi — Pi on Incus

> Run the [Pi](https://pi.dev) coding agent inside an ephemeral Incus container. Your host stays untouched. A `rm -rf /` inside the agent just destroys a throwaway container — your folder is the only thing that persists.

Inspired by [code-on-incus](https://github.com/mensfeld/code-on-incus) (COI), but for Pi.

> **"Pi" in this document always means [pi.dev](https://pi.dev) — Mario Zechner's terminal coding agent.** Not Raspberry Pi hardware. poi runs on any machine that can run [Incus](https://linuxcontainers.org/incus/) — macOS, Windows, Linux.

## Why poi exists

AI coding agents are getting good at writing code — and just as good at *running* it. A single turn can `rm -rf`, pipe a stranger's script into `sudo bash`, `npm i -g` a compromised package, or scribble over files outside your project. The usual containment story is "review every command before it runs," which doesn't scale and kills the flow.

poi moves the trust boundary. The agent gets a full Debian box to wreck however it likes — install, uninstall, break, fix, retry — but the container is ephemeral, and only your project folder + Pi's own session state are mounted in. When the agent exits, the container dies and takes the damage with it. Your host, your SSH keys, your env vars, your other projects: never in scope.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/logicwind/poi/main/install.sh | bash
```

The installer:
- verifies Incus is installed and reachable
- installs [Bun](https://bun.sh) if missing
- clones poi to `~/.poi` and symlinks `poi` into `~/.local/bin`
- seeds a starter `~/.pi/agent/models.json` pointing at Ollama Cloud

Then:

```sh
export OLLAMA_API_KEY=...        # add to your shell rc
poi build                        # one-time, ~5 min — builds poi-base template
cd your-project
poi                              # launches Pi in an ephemeral sandbox
```

That's it. Your project is mounted at `/work`, Pi runs inside the container with full access to `apt`, `npm`, `cargo`, whatever it needs. On exit, the container is destroyed — only changes to your project folder persist.

## What you get

- **Pi's full TUI** — streaming, tool calls, session tree, `/resume`, all of it
- **Your folder mounted at `/work`** with correct file ownership (`shift=true` UID mapping, no `chown` dance)
- **Pi state persisted on host** — `~/.pi/agent/` bind-mounted in, so sessions, auth, models, and settings survive across runs and across projects (Pi groups sessions by cwd automatically)
- **No access** to your host SSH keys, env, credentials, or anything outside the two mounts
- **~200ms container boot** (ephemeral clone from template)
- **Disposable installs** — `npm i -g`, `apt install`, broken configs all die with the container

## Commands

```
poi [shell]               boot ephemeral container, launch pi
poi shell -- --resume     any args after `--` pass through to pi
poi build                 build the poi-base template (one-time)
poi status                show template state + active ephemeral containers
poi --help                this text
```

## How it works (COI pattern)

```
┌────────── host ──────────────────────────────────┐
│  $ cd ~/work/foo                                 │
│  $ poi                                           │
│    │                                             │
│    │ 1. clone ephemeral(poi-base)                │
│    │ 2. mount ~/work/foo    → /work              │
│    │ 3. mount ~/.pi/agent   → /root/.pi/agent    │
│    │ 4. incus exec -t <clone> -- pi              │
│    ▼                                             │
│  ┌──── ephemeral Incus container ─────────────┐  │
│  │  $ pi                                      │  │
│  │    ↳ full TUI, sessions, /resume, /tree    │  │
│  │    ↳ bash/read/edit/write bounded to /work │  │
│  └────────────────────────────────────────────┘  │
│     ↑ pi exits → container auto-deleted          │
│                                                  │
│  ~/work/foo       persists (bind-mount)          │
│  ~/.pi/agent      persists — sessions, auth,     │
│                   models.json, settings all      │
│                   live on the host               │
└──────────────────────────────────────────────────┘
```

No agent reimplementation, no tool wrapping, no RPC. Pi runs normally; the container is the cage.

## Why Incus (not Docker)

Incus gives you *system* containers — full init, `systemd`, a real package manager, behaves like a tiny VM. Docker gives you *application* containers optimized for one process. For a coding agent that wants to `apt install`, spin up Postgres alongside, run tests, `cargo build`, the difference is "works natively" versus "fight the container all day."

Incus also has first-class UID shifting (`shift=true`): files the container writes to `/work` land on your host owned by *you*, not root. No `chown` dance, no permission firefighting.

## Requirements

poi runs inside a Linux environment with Incus. How you get that depends on your host:

| Host OS | Linux environment | Notes |
|---|---|---|
| **Linux** (Debian, Ubuntu, Arch, …) | native | simplest — install Incus directly |
| **macOS** | [Colima](https://github.com/abiosoft/colima) with the `incus` profile | `colima start --profile incus` gives you a Linux VM. Colima auto-mounts `/Users` into the VM via virtiofs, so your project paths work unchanged |
| **Windows** | [WSL2](https://learn.microsoft.com/windows/wsl/) (Ubuntu/Debian) | install Incus inside WSL. Access Windows paths via `/mnt/c/...` inside WSL |

Common requirements inside whichever Linux environment you choose:

- [Incus](https://linuxcontainers.org/incus/) 6.1+ with the daemon reachable
- Your user in the `incus-admin` group (`sudo usermod -aG incus-admin $USER`, then re-login)
- `shift=true` idmap support in your kernel (standard since Linux 5.12; works on Colima / WSL2 / native)
- [Bun](https://bun.sh) 1.3+ (installer takes care of this)

See [Running on macOS](#running-on-macos) and [Running on Windows](#running-on-windows) below for the platform-specific bootstrap.

## Configuration

### Models

Edit `~/.pi/agent/models.json` to add providers. The installer seeds an Ollama Cloud entry — swap for any Pi-supported provider (Anthropic, OpenAI, Groq, xAI, etc.). See [Pi's model docs](https://pi.dev) for the full list.

### Template

The template container (`poi-base` by default) is Debian 12 + Node 20 + Pi + git/ripgrep/jq. Override via env:

```sh
POI_IMAGE=ubuntu/22.04 POI_NODE_VERSION=22 poi build
```

### Environment

| Var                 | Default                           | Purpose                                  |
| ------------------- | --------------------------------- | ---------------------------------------- |
| `OLLAMA_API_KEY`    | —                                 | Required if using Ollama Cloud           |
| `POI_TEMPLATE`      | `poi-base`                        | Template container name                  |
| `POI_IMAGE`         | `debian/12`                       | Image used by `poi build`                |
| `POI_NODE_VERSION`  | `20`                              | Node major version in the template       |
| `INCUS_SOCKET`      | `/var/lib/incus/unix.socket`      | Incus Unix socket path                   |

## What's sandboxed vs what's shared

| On exit… | Survives? |
| --- | --- |
| Files in `/work` (your cwd) | ✅ yes — bind-mount |
| `~/.pi/agent/` (sessions, auth, models, settings) | ✅ yes — bind-mount |
| `apt install`, global `npm i -g`, system tweaks | ❌ no — container destroyed |
| Anything outside `/work` and `~/.pi/agent` | ❌ no — never had access |

## Uninstall

```sh
rm -rf ~/.poi ~/.local/bin/poi
incus stop poi-base 2>/dev/null; incus delete poi-base 2>/dev/null
# your ~/.pi/agent/ is untouched (Pi config, sessions) — remove separately if wanted
```

## Running on macOS

Incus is Linux-only, so on macOS you run poi inside a Linux VM managed by [Colima](https://github.com/abiosoft/colima). The good news: Colima auto-shares `/Users` with the VM, so your project folders work unchanged.

**One-time setup:**

```sh
brew install colima incus
colima start --profile incus --runtime incus
```

The `colima` CLI (on macOS) + Colima's socket forwarding means the `incus` CLI on your Mac talks to the Incus daemon inside the VM at a socket like `/Users/<you>/.colima/incus/incus.sock`.

**Install poi on macOS:**

```sh
export INCUS_SOCKET=$HOME/.colima/incus/incus.sock     # add to ~/.zshrc
curl -fsSL https://raw.githubusercontent.com/logicwind/poi/main/install.sh | bash
```

From there, `poi build` and `poi` work exactly as on Linux.

**Gotchas:**

- `colima start --profile incus` needs to be running whenever you use poi.
- Your cwd must live under `/Users` for Colima to expose it to the VM. Folders outside `/Users` aren't auto-mounted.
- The Incus socket path on Mac is **not** `/var/lib/incus/unix.socket` — always export `INCUS_SOCKET` or run with the var inline.

## Running on Windows

Use [WSL2](https://learn.microsoft.com/windows/wsl/) with a Debian or Ubuntu distro. From inside WSL, poi behaves like native Linux.

**One-time setup** (in PowerShell, once):

```powershell
wsl --install -d Ubuntu
```

Then inside the WSL shell:

```sh
# install Incus per the official guide:
#   https://linuxcontainers.org/incus/docs/main/installing/
sudo apt install -y incus
sudo usermod -aG incus-admin $USER
# log out of WSL and back in

curl -fsSL https://raw.githubusercontent.com/logicwind/poi/main/install.sh | bash
poi build
cd /mnt/c/Users/<you>/Projects/some-project
poi
```

**Gotchas:**

- Your Windows project folder is accessible inside WSL at `/mnt/c/Users/<you>/...`. Perf is better if you clone into the WSL home (`~/projects/…`) instead of working on `/mnt/c`, but mounted Windows folders do work.
- Make sure `systemd` is enabled in WSL (`/etc/wsl.conf` → `[boot]\nsystemd=true`) so Incus' daemon runs.

## Non-goals

poi is intentionally small. It does **not**:

- detect threats, monitor syscalls, or filter network traffic
- filter credentials, selectively forward an SSH agent, or audit-log
- support multi-slot parallel sessions or persistent containers
- offer profiles, TOML config hierarchies, or per-project overrides
- manage storage pools, snapshots, or resource limits

If any of those matter to you, use [code-on-incus](https://github.com/mensfeld/code-on-incus) — it handles all of that. poi is a single-user Pi-in-a-box for people who want the sandbox and nothing else.

## Status

v0.1 — works for the author's single-user Pi setup. If something breaks, file an issue with the output of `poi status`.

## License

MIT — see [LICENSE](./LICENSE).

## See also

- [Pi](https://pi.dev) — the coding agent that runs inside
- [code-on-incus](https://github.com/mensfeld/code-on-incus) — the pattern this borrows (supports Claude Code, opencode today)
- [Incus](https://linuxcontainers.org/incus/) — the container manager
