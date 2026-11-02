// Tags each root session with its Linear ticket and GitHub PR.
//   metadata.ticket / metadata.pr        → machine lookup (~/.local/bin/oc-goto)
//   title prefix "CORE-5114 #16544 · …"  → visible in opencode, herdr tabs and Raycast
//
// | Source (first found wins, then sticky)      | ticket | pr |
// |---------------------------------------------|--------|----|
// | user prompt: Linear URL / KEY-123 / PR link  |   ✓ (also replaces a branch-inferred ticket) | ✓ |
// | session directory branch (not main/master)  |   ✓    | via `gh pr list --head` |
// | `gh pr create` output                       |        | ✓  |
// | PR head branch (`gh pr view`)               |   ✓    |    |
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// Linear team keys bound free-text matching ("UTF-8" is not a ticket). From ~/.config/oc-goto/config.json.
const CONFIG = process.env.OC_GOTO_CONFIG ?? path.join(homedir(), ".config/oc-goto/config.json");
const KEYS = (() => {
  try {
    return JSON.parse(readFileSync(CONFIG, "utf8")).ticketKeys ?? [];
  } catch {
    return [];
  }
})();
const KEY_ALT = KEYS.length ? KEYS.join("|") : "(?!)";
const TEXT_TICKET = new RegExp(`(?<![A-Za-z0-9-])(${KEY_ALT})-(\\d+)(?![\\w-]*\\d)`);
const BRANCH_TICKET = new RegExp(`(?:^|/)(${KEY_ALT})-(\\d+)(?:-|$)`, "i");
const TEXT_PR = [
  /github\.com\/[\w.-]+\/[\w.-]+\/pull\/(\d+)/i,
  /\bPR\s*#?(\d{4,6})\b/i,
  /(?:^|\s)#(\d{5})\b/,
];
const PREFIX = /^(?:(?:[A-Z][A-Z0-9]*-\d+|#\d+)\s+)+·\s*/;
const DEFAULT_BRANCHES = new Set(["main", "master", "HEAD", ""]);
const GH_THROTTLE_MS = 10 * 60_000;
const RECONCILE_THROTTLE_MS = 15_000;
const LOG = path.join(homedir(), ".local/state/opencode-ticket-tag.log");
const ENV = { ...process.env, PATH: `/opt/homebrew/bin:${homedir()}/.local/bin:${process.env.PATH ?? ""}` };

const state = new Map(); // sessionID → { reconciledAt, ghAt }

function log(...parts) {
  void appendFile(LOG, `${new Date().toISOString()} ${parts.join(" ")}\n`).catch(() => {});
}

function run(file, args, cwd) {
  return new Promise((resolve) => {
    execFile(file, args, { cwd, env: ENV, timeout: 15_000 }, (error, stdout) =>
      resolve(error ? "" : stdout.trim()),
    );
  });
}

function ticketFromText(text) {
  const m = TEXT_TICKET.exec(text ?? "");
  return m ? `${m[1]}-${m[2]}` : undefined;
}

function ticketFromBranch(branch) {
  const m = BRANCH_TICKET.exec(branch ?? "");
  return m ? `${m[1].toUpperCase()}-${m[2]}` : undefined;
}

function prFromText(text) {
  for (const re of TEXT_PR) {
    const m = re.exec(text ?? "");
    if (m) return Number(m[1]);
  }
  return undefined;
}

function sessionIDOf(event) {
  return event?.sessionID ?? event?.context?.sessionID ?? event?.session?.id;
}

function unwrap(response) {
  return response?.data ?? response;
}

function titleFor(title, ticket, pr) {
  const base = (title ?? "").replace(PREFIX, "");
  const tags = [ticket, pr ? `#${pr}` : undefined].filter(Boolean).join(" ");
  return tags ? `${tags} · ${base}` : base;
}

export default {
  id: "oc-goto.ticket-tag",
  async setup(ctx) {
    async function reconcile(sessionID, hints = {}, force = false) {
      if (!sessionID) return;
      const st = state.get(sessionID) ?? { reconciledAt: 0, ghAt: 0 };
      state.set(sessionID, st);
      const now = Date.now();
      if (!force && !hints.ticket && !hints.pr && now - st.reconciledAt < RECONCILE_THROTTLE_MS) return;
      st.reconciledAt = now;

      const session = unwrap(await ctx.session.get({ sessionID }));
      if (!session || session.parentID) return;
      const meta = session.metadata ?? {};
      let ticket = meta.ticket;
      let pr = meta.pr;
      const directory = session.location?.directory;

      let ticketSource = meta.ticketSource;
      // Worktrees get reused, so a ticket named in a prompt beats one inferred from the branch.
      if (hints.ticket && ticketSource === "branch" && hints.ticket !== ticket) {
        ticket = undefined;
        pr = undefined;
      }
      const branch = directory ? await run("git", ["rev-parse", "--abbrev-ref", "HEAD"], directory) : "";
      if (!ticket && hints.ticket) [ticket, ticketSource] = [hints.ticket, "prompt"];
      if (!ticket && ticketFromBranch(branch)) [ticket, ticketSource] = [ticketFromBranch(branch), "branch"];
      pr ??= hints.pr;

      if (now - st.ghAt > GH_THROTTLE_MS && (!pr || !ticket)) {
        st.ghAt = now;
        if (!pr && !DEFAULT_BRANCHES.has(branch)) {
          const out = await run("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "number", "--limit", "1"], directory);
          pr = JSON.parse(out || "[]")[0]?.number ?? undefined;
        }
        if (pr && !ticket) {
          ticket = ticketFromBranch(await run("gh", ["pr", "view", String(pr), "--json", "headRefName", "--jq", ".headRefName"], directory));
          if (ticket) ticketSource = "pr";
        }
      }

      // An untitled session still has title generation pending; renaming it now would skip that.
      const untitled = !session.title;
      if (untitled && (ticket || pr)) scheduleRetitle(sessionID);
      const title = untitled ? undefined : titleFor(session.title, ticket, pr);
      const changedMeta = ticket !== meta.ticket || pr !== meta.pr;
      if (!changedMeta && title === session.title) return;
      if (!changedMeta && untitled) return;
      await ctx.session.update({
        sessionID,
        ...(title === undefined ? {} : { title }),
        ...(changedMeta ? { metadata: { ...meta, ticket, ticketSource, pr } } : {}),
      });
      log(sessionID, `ticket=${ticket ?? "-"} pr=${pr ?? "-"} title=${JSON.stringify(title)}`);
    }

    const retitles = new Set();
    function scheduleRetitle(sessionID) {
      if (retitles.has(sessionID)) return;
      retitles.add(sessionID);
      for (const delay of [10_000, 30_000, 90_000]) {
        setTimeout(() => void safe(() => reconcile(sessionID, {}, true))(), delay).unref?.();
      }
      setTimeout(() => retitles.delete(sessionID), 100_000).unref?.();
    }

    const safe = (fn) => async (event) => {
      try {
        await fn(event);
      } catch (error) {
        log("error", sessionIDOf(event) ?? "-", error?._tag ?? "", error?.message ?? "", JSON.stringify(error)?.slice(0, 300));
      }
    };

    await ctx.session.hook(
      "prompt",
      safe(async (event) => {
        const text = event.prompt?.text ?? "";
        await reconcile(sessionIDOf(event), { ticket: ticketFromText(text), pr: prFromText(text) }, true);
      }),
    );

    await ctx.tool.hook(
      "execute.after",
      safe(async (event) => {
        const command = event.input?.command;
        let pr;
        if (event.status === "completed" && typeof command === "string" && /\bgh\s+pr\s+create\b/.test(command)) {
          pr = prFromText(JSON.stringify(event.result ?? ""));
        }
        await reconcile(sessionIDOf(event), { pr });
      }),
    );
  },
};
