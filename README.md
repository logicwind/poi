# poi — Pi on Incus

> Run the [Pi](https://pi.dev) coding agent inside an ephemeral Incus container. Your host stays untouched. A `rm -rf /` inside the agent just destroys a throwaway container — your folder is the only thing that persists.

Inspired by [code-on-incus](https://github.com/mensfeld/code-on-incus) (COI), but for Pi.

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

## Requirements

- Linux host with [Incus](https://linuxcontainers.org/incus/) (tested on Debian 12, Ubuntu 22.04+, Raspberry Pi OS)
- Your user in the `incus-admin` group (`sudo usermod -aG incus-admin $USER`, then re-login)
- `shift=true` idmap support in your kernel (standard since Linux 5.12; also works on Colima)
- [Bun](https://bun.sh) 1.3+ (installer takes care of this)

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

## Status

v0.1 — works for the author's single-user Pi setup. If something breaks, file an issue with the output of `poi status`.

## License

MIT — see [LICENSE](./LICENSE).

## See also

- [Pi](https://pi.dev) — the coding agent that runs inside
- [code-on-incus](https://github.com/mensfeld/code-on-incus) — the pattern this borrows (supports Claude Code, opencode today)
- [Incus](https://linuxcontainers.org/incus/) — the container manager
