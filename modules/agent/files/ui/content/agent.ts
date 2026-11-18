// Every word the Agents page in `apps/app` shows, in one file. `add agent` installs it
// when `api-keys-user` is installed too.
//
// The shape rules are the ones ./landing.ts states in its preamble: max three levels,
// single-brace `{token}` placeholders filled by `interpolate()` from ../lib/interpolate,
// no runtime concatenation, user-visible strings only. Edit the words here, never in
// ../blocks/agent/agent-keys.tsx.
//
// Two kinds of text stay out of this file on purpose. The setup snippets are code, built
// by `setupText()` in ../lib/agent/keys.ts, so a copy pass cannot break a command. And a
// scope pair such as `books:read` is the key vocabulary's own word, not copy.

/** Copy for the Agents page. */
export const agent = {
  page: {
    title: "Agents",
    description:
      "Let an AI agent use your account through MCP. Each agent signs in with an API key you create here.",
  },

  connect: {
    title: "Connect an agent",
    addressLabel: "MCP address",
    copyAddressLabel: "Copy the MCP address",
    copySetupLabel: "Copy the setup text",
    tabs: {
      cursor: "Cursor",
      "claude-code": "Claude Code",
      codex: "Codex",
    },
    hints: {
      cursor:
        "Add this to .cursor/mcp.json. Replace {placeholder} with a key from the list below.",
      "claude-code":
        "Run this in a terminal. Replace {placeholder} with a key from the list below.",
      codex:
        "Add this to ~/.codex/config.toml, then set the variable to a key from the list below.",
    },
    copied: "Copied",
  },

  keys: {
    title: "API keys",
    createLabel: "Create key",
    caption: "Your API keys, with their scopes, creation date and last use.",
    columns: {
      name: "Name",
      key: "Key",
      scopes: "Scopes",
      created: "Created",
      lastUsed: "Last used",
      actions: "Actions",
    },
    unnamed: "Unnamed key",
    noScope: "No scope",
    moreScopes: "+{count}",
    neverUsed: "Never",
    revokeLabel: "Revoke",
    loading: "Loading your keys",
    loadFailed: "Your keys did not load",
    retryLabel: "Try again",
    emptyTitle: "No API keys yet",
    emptyDescription: "Create a key to connect Cursor, Claude Code or Codex.",
  },

  create: {
    title: "Create API key",
    description:
      "An agent with this key acts as you, limited to the scopes you pick.",
    nameLabel: "Name",
    namePlaceholder: "Cursor on laptop",
    scopesLabel: "Scopes",
    scopesHint: "Delete scopes stay off until you tick them.",
    noScopes:
      "This product has no scopes yet. A key made now can call only the tools that need no scope.",
    cancelLabel: "Cancel",
    submitLabel: "Create key",
    failedTitle: "The key was not created",
  },

  created: {
    title: "Copy your key now",
    warning:
      "You will not see this key again. Store it in your agent's settings.",
    copyLabel: "Copy key",
    doneLabel: "Done",
  },

  revoke: {
    title: "Revoke {name}?",
    description:
      "Every agent that uses this key stops working at once. You cannot restore a revoked key. Create a new one instead.",
    cancelLabel: "Cancel",
    confirmLabel: "Revoke",
    doneTitle: "Key revoked",
    failedTitle: "The key was not revoked",
  },
};
