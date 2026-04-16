#!/usr/bin/env bash
# poi installer — Pi on Incus
#
# Usage (remote):
#   curl -fsSL https://raw.githubusercontent.com/logicwind/poi/main/install.sh | bash
#
# Usage (local, from a checkout):
#   ./install.sh
#
# Env overrides:
#   POI_REPO      git remote (default: https://github.com/logicwind/poi.git)
#   POI_REF       branch/tag/sha to check out (default: main)
#   POI_HOME      install dir (default: $HOME/.poi)
#   BIN_DIR       where to drop the `poi` symlink (default: $HOME/.local/bin)

set -euo pipefail

POI_REPO="${POI_REPO:-https://github.com/logicwind/poi.git}"
POI_REF="${POI_REF:-main}"
POI_HOME="${POI_HOME:-$HOME/.poi}"
BIN_DIR="${BIN_DIR:-$HOME/.local/bin}"

say() { printf "\033[1;36m[poi]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[poi]\033[0m %s\n" "$*" >&2; }
die() { printf "\033[1;31m[poi]\033[0m %s\n" "$*" >&2; exit 1; }

# --- 1. dependency checks ---------------------------------------------------

if ! command -v incus >/dev/null 2>&1; then
  die "incus is not installed or not in PATH.
     Install it first: https://linuxcontainers.org/incus/docs/main/installing/"
fi

if ! incus info >/dev/null 2>&1; then
  die "incus is installed but the daemon isn't reachable.
     Try: sudo systemctl start incus; sudo usermod -aG incus-admin \$USER
     Then log out and back in."
fi

if ! command -v bun >/dev/null 2>&1; then
  say "bun not found — installing via https://bun.sh/install"
  curl -fsSL https://bun.sh/install | bash
  # shellcheck disable=SC1091
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  command -v bun >/dev/null 2>&1 || die "bun install failed — please install manually from https://bun.sh"
fi

if ! command -v git >/dev/null 2>&1; then
  die "git is not installed. Install it via your package manager."
fi

# --- 2. clone or update -----------------------------------------------------

mkdir -p "$POI_HOME"

if [ -d "$POI_HOME/.git" ]; then
  say "updating existing checkout at $POI_HOME"
  git -C "$POI_HOME" fetch --quiet origin "$POI_REF"
  git -C "$POI_HOME" checkout --quiet "$POI_REF"
  git -C "$POI_HOME" pull --quiet --ff-only origin "$POI_REF" || true
else
  say "cloning $POI_REPO @ $POI_REF into $POI_HOME"
  git clone --quiet --depth 1 --branch "$POI_REF" "$POI_REPO" "$POI_HOME"
fi

# --- 3. install dependencies -----------------------------------------------

say "installing bun dependencies"
( cd "$POI_HOME" && bun install --silent )

# --- 4. symlink into BIN_DIR -----------------------------------------------

mkdir -p "$BIN_DIR"
ln -sf "$POI_HOME/src/cli.ts" "$BIN_DIR/poi"
chmod +x "$POI_HOME/src/cli.ts"
say "linked $BIN_DIR/poi → $POI_HOME/src/cli.ts"

# --- 5. PATH check ----------------------------------------------------------

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) warn "$BIN_DIR is not on your PATH. Add this to your shell rc:
     export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac

# --- 6. seed ~/.pi/agent skeleton ------------------------------------------

PI_DIR="$HOME/.pi/agent"
mkdir -p "$PI_DIR/sessions"

if [ ! -f "$PI_DIR/models.json" ]; then
  say "seeding $PI_DIR/models.json (Ollama Cloud placeholder)"
  cat > "$PI_DIR/models.json" <<'JSON'
{
  "providers": {
    "ollama-cloud": {
      "baseUrl": "https://ollama.com/v1",
      "api": "openai-completions",
      "apiKey": "OLLAMA_API_KEY",
      "compat": {
        "supportsDeveloperRole": false,
        "supportsReasoningEffort": false
      },
      "models": [
        { "id": "gpt-oss:120b-cloud" },
        { "id": "glm-4.6" }
      ]
    }
  }
}
JSON
fi

if [ ! -f "$PI_DIR/settings.json" ]; then
  say "seeding $PI_DIR/settings.json"
  cat > "$PI_DIR/settings.json" <<'JSON'
{
  "defaultProvider": "ollama-cloud",
  "defaultModel": "gpt-oss:120b-cloud"
}
JSON
fi

# --- 7. done ---------------------------------------------------------------

cat <<EOF

✓ poi installed.

next steps:
  1. export OLLAMA_API_KEY=... (add to your shell rc)
  2. poi build          # one-time, ~5 min: builds the poi-base template
  3. cd any-project
     poi                # launches Pi in an ephemeral container

docs:  $POI_HOME/README.md
config: $PI_DIR/{models.json,settings.json}
EOF
