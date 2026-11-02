// Linear issues + opencode session status. Session matching lives in ~/.local/bin/oc-goto.
//   empty search → my open issues (most recently updated first)
//   typed search → Linear full-text search across the workspace
import {
  Action,
  ActionPanel,
  Color,
  closeMainWindow,
  getPreferenceValues,
  Icon,
  List,
  showHUD,
  showToast,
  Toast,
} from "@raycast/api";
import { useCachedPromise } from "@raycast/utils";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import React, { useState } from "react";

// Optional: without oc-goto (see README) the list is plain Linear and Enter opens the issue.
const OC_GOTO = (
  getPreferenceValues<{ ocGotoPath?: string }>().ocGotoPath ||
  "~/.local/bin/oc-goto"
).replace(/^~/, homedir());
const HAS_OC_GOTO = existsSync(OC_GOTO);

type TpIssue = {
  identifier: string;
  title: string;
  url: string;
  branchName: string;
  priorityLabel: string;
  updatedAt: string;
  state: { name: string; type: string; color: string };
  attachments: { nodes: { url: string }[] };
};

type TpSession = { status: string; title: string | null; pane: string | null };

const STATUS: Record<string, { icon: Icon; color: Color; label: string }> = {
  working: { icon: Icon.CircleProgress50, color: Color.Blue, label: "working" },
  blocked: { icon: Icon.ExclamationMark, color: Color.Red, label: "needs you" },
  done: { icon: Icon.CheckCircle, color: Color.Green, label: "done" },
  idle: { icon: Icon.Circle, color: Color.Green, label: "idle" },
  unknown: {
    icon: Icon.QuestionMarkCircle,
    color: Color.SecondaryText,
    label: "open",
  },
  parked: { icon: Icon.Moon, color: Color.SecondaryText, label: "parked" },
};

const ISSUE_FIELDS = `identifier title url branchName priorityLabel updatedAt
  state { name type color } attachments(first: 10) { nodes { url } }`;

// Login shell: same PATH and LINEAR_API_KEY as the terminal.
function loginShell(script: string, ...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "/bin/zsh",
      ["-lc", script, "zsh", ...args],
      { timeout: 60_000 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error((stderr || stdout || error.message).trim()))
          : resolve(stdout.trim()),
    );
  });
}

let apiKey: Promise<string> | undefined;
function linearKey(): Promise<string> {
  const pref = getPreferenceValues<{ linearApiKey?: string }>().linearApiKey;
  if (pref) return Promise.resolve(pref);
  apiKey ??= loginShell('printf %s "$LINEAR_API_KEY"');
  return apiKey;
}

async function linear<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      Authorization: await linearKey(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as {
    data?: T;
    errors?: { message: string }[];
  };
  if (!body.data)
    throw new Error(
      body.errors?.[0]?.message ?? `Linear HTTP ${response.status}`,
    );
  return body.data;
}

async function fetchIssues(search: string): Promise<TpIssue[]> {
  if (search.trim()) {
    const data = await linear<{ searchIssues: { nodes: TpIssue[] } }>(
      `query($q: String!) { searchIssues(term: $q, first: 40) { nodes { ${ISSUE_FIELDS} } } }`,
      { q: search.trim() },
    );
    return data.searchIssues.nodes;
  }
  const data = await linear<{
    viewer: { assignedIssues: { nodes: TpIssue[] } };
  }>(
    `query { viewer { assignedIssues(first: 100, orderBy: updatedAt,
       filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ISSUE_FIELDS} } } } }`,
    {},
  );
  return data.viewer.assignedIssues.nodes;
}

async function fetchSessions(): Promise<Record<string, TpSession>> {
  if (!HAS_OC_GOTO) return {};
  return JSON.parse((await loginShell(`"${OC_GOTO}" --index`)) || "{}");
}

function prUrl(issue: TpIssue): string | undefined {
  return issue.attachments.nodes
    .map((a) => a.url)
    .find((url) => /github\.com\/.+\/pull\/\d+/.test(url));
}

async function goTo(identifier: string): Promise<void> {
  await closeMainWindow();
  try {
    const out = await loginShell(`"${OC_GOTO}" "$1"`, identifier);
    await showHUD(out.split("\n").pop() || `→ ${identifier}`);
  } catch (error) {
    await showToast({
      style: Toast.Style.Failure,
      title: `oc-goto ${identifier}`,
      message: String(error),
    });
  }
}

export default function Command(): React.JSX.Element {
  const [search, setSearch] = useState("");
  const issues = useCachedPromise(fetchIssues, [search], {
    keepPreviousData: true,
  });
  const sessions = useCachedPromise(fetchSessions, []);

  return (
    <List
      isLoading={issues.isLoading || sessions.isLoading}
      filtering={false}
      throttle
      onSearchTextChange={setSearch}
      searchBarPlaceholder="My open tickets — type to search all of Linear"
    >
      {(issues.data ?? []).map((issue) => {
        const pr = prUrl(issue);
        const prNumber = pr?.match(/\/pull\/(\d+)/)?.[1];
        const session =
          sessions.data?.[issue.identifier] ??
          (prNumber ? sessions.data?.[`#${prNumber}`] : undefined);
        const status = session
          ? (STATUS[session.status] ?? STATUS.unknown)
          : undefined;
        return (
          <List.Item
            key={issue.identifier}
            icon={{ source: Icon.CircleFilled, tintColor: issue.state.color }}
            title={issue.identifier}
            subtitle={issue.title}
            keywords={[issue.title, issue.branchName]}
            accessories={[
              ...(pr ? [{ icon: Icon.CodeBlock, tooltip: pr }] : []),
              ...(status && session
                ? [
                    {
                      tag: { value: status.label, color: status.color },
                      icon: status.icon,
                      tooltip: session.title ?? "",
                    },
                  ]
                : []),
              { text: issue.state.name },
            ]}
            actions={
              <ActionPanel>
                {HAS_OC_GOTO && (
                  <Action
                    title={session ? "Go to Session" : "Start Session"}
                    icon={Icon.Terminal}
                    onAction={() => goTo(issue.identifier)}
                  />
                )}
                <Action.OpenInBrowser
                  title="Open in Linear"
                  url={issue.url}
                  shortcut={{ modifiers: ["cmd"], key: "o" }}
                />
                {pr && (
                  <Action.OpenInBrowser
                    title="Open Pull Request"
                    url={pr}
                    shortcut={{ modifiers: ["cmd"], key: "g" }}
                  />
                )}
                <Action.CopyToClipboard
                  title="Copy ID"
                  content={issue.identifier}
                  shortcut={{ modifiers: ["cmd"], key: "." }}
                />
                <Action.CopyToClipboard
                  title="Copy Branch Name"
                  content={issue.branchName}
                  shortcut={{ modifiers: ["cmd", "shift"], key: "." }}
                />
                {HAS_OC_GOTO && (
                  <Action
                    title="Refresh Sessions"
                    icon={Icon.ArrowClockwise}
                    shortcut={{ modifiers: ["cmd"], key: "r" }}
                    onAction={() => sessions.revalidate()}
                  />
                )}
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
