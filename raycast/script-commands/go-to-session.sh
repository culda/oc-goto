#!/bin/zsh -l
# Login shell: picks up LINEAR_API_KEY from ~/.zprofile.

# @raycast.schemaVersion 1
# @raycast.title Go to Session
# @raycast.mode silent
# @raycast.packageName opencode
# @raycast.icon 🧭
# @raycast.argument1 { "type": "text", "placeholder": "ticket / PR / URL (empty = clipboard)", "optional": true }
# @raycast.description Focus the opencode session (herdr pane) for a Linear ticket or GitHub PR; creates one if missing.

exec "$HOME/.local/bin/oc-goto" "$1"
