# My Tickets

Your open Linear issues in Raycast (type to search all of Linear), with optional jump-to-session for opencode.

| Key | Action |
|---|---|
| ↵ | Go to / start the ticket's opencode session (needs `oc-goto`), else ⌘O |
| ⌘O | Open in Linear |
| ⌘G | Open the linked PR |
| ⌘. / ⌘⇧. | Copy ID / branch name |
| ⌘R | Refresh session badges |

## Setup

**Linear only:** set `LINEAR_API_KEY` in `~/.zprofile` (Linear → Settings → Security & access → Personal API keys), or paste the key in the extension preferences.

**Session jumping (optional):** needs opencode, [herdr](https://herdr.dev), Ghostty and `wt`, plus:

- `oc-goto` on `~/.local/bin` (or set its path in the extension preferences)
- `ticket-tag.js` in `~/.config/opencode/plugins/`: tags sessions with their ticket/PR so `oc-goto` can find them

Session badges: 🔵 working · 🔴 needs you · 🟢 idle/done · 🌙 parked (session exists, no pane).
