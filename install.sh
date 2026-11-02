#!/usr/bin/env bash
# install.sh — symlink oc-goto, the opencode plugin and the Raycast script command; create the config.
#   ./install.sh [path/to/repo]   (default: asks)
# Re-running is safe: links are refreshed and an existing config is kept.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd -P)"
CONFIG_DIR="$HOME/.config/oc-goto"
CONFIG="$CONFIG_DIR/config.json"

for tool in jq gh git opencode herdr; do
  command -v "$tool" >/dev/null || echo "warning: $tool not found on PATH" >&2
done

link() { # <source> <target>
  mkdir -p "$(dirname "$2")"
  if [[ -e "$2" && ! -L "$2" ]]; then
    mv "$2" "$2.bak"
    echo "backed up $2 → $2.bak"
  fi
  ln -sfn "$1" "$2"
  echo "linked $2"
}
link "$SRC/bin/oc-goto" "$HOME/.local/bin/oc-goto"
link "$SRC/opencode/ticket-tag.js" "$HOME/.config/opencode/plugins/ticket-tag.js"
link "$SRC/raycast/script-commands/go-to-session.sh" "$HOME/.config/raycast/script-commands/go-to-session.sh"

if [[ -f "$CONFIG" ]]; then
  echo "kept $CONFIG"
  exit 0
fi

repo="${1:-}"
[[ -n "$repo" ]] || read -rp "Main checkout of the repo you work on (e.g. ~/my-repo): " repo
repo="${repo/#\~/$HOME}"
git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || {
  echo "$repo is not a git checkout" >&2
  exit 1
}
github_repo="$(cd "$repo" && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"

keys="[]"
if [[ -n "${LINEAR_API_KEY:-}" ]]; then
  keys="$(curl -fsS https://api.linear.app/graphql -H "Authorization: $LINEAR_API_KEY" -H 'Content-Type: application/json' \
    -d '{"query":"{ teams(first: 250) { nodes { key } } }"}' | jq -c '[.data.teams.nodes[].key]' || echo "[]")"
else
  echo "LINEAR_API_KEY not set: add your Linear team keys to ticketKeys in $CONFIG" >&2
fi

mkdir -p "$CONFIG_DIR"
jq -n --arg repo "${repo/#$HOME/~}" --arg gh "$github_repo" --arg ws "$(basename "$repo")" --argjson keys "$keys" '{
  repo: $repo, githubRepo: $gh, worktreePrefix: ($repo + "-"), herdrWorkspace: $ws,
  terminalApp: "Ghostty", ticketKeys: $keys
}' >"$CONFIG"
echo "wrote $CONFIG:"
cat "$CONFIG"
