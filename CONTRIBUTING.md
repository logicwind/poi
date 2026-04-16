# Contributing to poi

Thanks for the interest. poi is a small, single-purpose tool: run [Pi](https://pi.dev) inside an ephemeral Incus container. Anything that doesn't serve that is probably out of scope.

## Dev setup

```sh
git clone https://github.com/<your-fork>/poi
cd poi
bun install
```

You need:
- [Bun](https://bun.sh) 1.3+ (runtime)
- [Incus](https://linuxcontainers.org/incus/) running on Linux (Pi, Ubuntu, Debian, etc.)
- [Pi](https://pi.dev) installed locally *only* if you're testing outside the sandbox

## Testing changes

```sh
bun run typecheck         # tsc --noEmit
bun src/cli.ts status     # sanity-check the Incus wiring
bun src/cli.ts build      # rebuild the template
bun src/cli.ts shell      # end-to-end smoke test
```

There are no unit tests yet — the surface is small (template build + container lifecycle + stdio passthrough) and best tested end-to-end. If you add logic that merits tests, prefer `bun:test` alongside the source.

## Pull requests

- Keep PRs narrow. One change per PR.
- Match the existing code style: tabs/indent follow `.editorconfig`, no comments that explain what code does (only *why*).
- If you touch `install.sh`, hand-test the curl-pipe path end-to-end — it's the entry point for most users.
- Update `README.md` if the CLI surface changes.

## Scope

**Yes:** Pi + Incus integration, installer improvements, status/lifecycle commands, docs.

**Maybe:** support for additional base images (Ubuntu, Alpine), alternative agents that follow the same pattern (as subcommands or flags), rootless Incus quirks.

**No:** anything that replaces what Pi does — its own TUI, agent loop, model backends. That's Pi's job. poi is a container around it.

## Reporting issues

Please include:
- `incus version`, `bun --version`, host OS
- Output of `poi status`
- Exact command run and expected vs actual behavior

## License

By contributing, you agree that your contributions will be licensed under the MIT license.
