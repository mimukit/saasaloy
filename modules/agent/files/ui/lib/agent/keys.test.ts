// Tests for ./keys.ts. This file is NOT in the descriptor's `files` list, so `add agent`
// never copies it into a user's project; it exists for this repo only.
//
// It runs on `node:test` because vite has to load a tsconfig for every file it transforms,
// and this payload's tsconfig resolves only inside a scaffolded project. Run them with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  defaultScope,
  mcpAddressOf,
  scopeChips,
  serverName,
  setupText,
  toggleScope,
} from "./keys.ts";

const VOCABULARY = {
  books: ["read", "write", "delete"],
  notes: ["read", "write", "delete", "send"],
  files: ["read"],
  audit: ["delete"],
};

describe("defaultScope", () => {
  it("turns read and write on and leaves delete and other words off", () => {
    assert.deepEqual(defaultScope(VOCABULARY), {
      books: ["read", "write"],
      notes: ["read", "write"],
      files: ["read"],
    });
  });

  it("is empty for an empty vocabulary", () => {
    assert.deepEqual(defaultScope({}), {});
  });
});

describe("toggleScope", () => {
  it("adds an action in the vocabulary's order", () => {
    const scope = toggleScope(
      { books: ["read", "write"] },
      VOCABULARY,
      "books",
      "delete"
    );
    assert.deepEqual(scope, { books: ["read", "write", "delete"] });
    assert.deepEqual(
      toggleScope({ books: ["write"] }, VOCABULARY, "books", "read"),
      { books: ["read", "write"] }
    );
  });

  it("drops a resource left with no action", () => {
    assert.deepEqual(
      toggleScope({ files: ["read"] }, VOCABULARY, "files", "read"),
      {}
    );
  });
});

describe("scopeChips", () => {
  it("shows the first two pairs and counts the rest", () => {
    assert.deepEqual(
      scopeChips({ books: ["read", "write"], notes: ["read", "write"] }),
      { shown: ["books:read", "books:write"], rest: 2 }
    );
  });

  it("answers nothing for a key with no scope", () => {
    assert.deepEqual(scopeChips(null), { shown: [], rest: 0 });
  });
});

describe("serverName", () => {
  it("kebab-cases the app name", () => {
    assert.equal(serverName("Acme Books!"), "acme-books");
    assert.equal(serverName("Café Ledger"), "cafe-ledger");
  });

  it("keeps a word whole around an accented letter", () => {
    assert.equal(serverName("Müller"), "muller");
    assert.equal(serverName("Résumé Builder"), "resume-builder");
  });

  it("falls back to app for a name with no letter or digit", () => {
    assert.equal(serverName("***"), "app");
  });
});

describe("setupText", () => {
  const address = mcpAddressOf("https://api.acme.app/");

  it("builds the address from the api origin", () => {
    assert.equal(address, "https://api.acme.app/mcp");
  });

  it("gives Claude Code one command with the bearer header", () => {
    assert.equal(
      setupText("claude-code", "acme", address),
      'claude mcp add --transport http acme https://api.acme.app/mcp --header "Authorization: Bearer <your key>"'
    );
  });

  it("gives Cursor a parseable mcp.json entry", () => {
    const parsed = JSON.parse(setupText("cursor", "acme", address)) as {
      mcpServers: Record<
        string,
        { url: string; headers: Record<string, string> }
      >;
    };
    assert.equal(parsed.mcpServers.acme?.url, address);
    assert.equal(
      parsed.mcpServers.acme?.headers.Authorization,
      "Bearer <your key>"
    );
  });

  it("gives Codex a TOML table that reads the key from a variable", () => {
    const text = setupText("codex", "acme-books", address);
    assert.match(text, /^\[mcp_servers\.acme-books\]$/m);
    assert.match(text, /^bearer_token_env_var = "ACME_BOOKS_KEY"$/m);
  });

  it("gives Codex a valid shell variable when the name starts with a digit", () => {
    const text = setupText("codex", "3d-studio", address);
    assert.match(text, /^bearer_token_env_var = "MCP_3D_STUDIO_KEY"$/m);
    assert.match(text, /export MCP_3D_STUDIO_KEY=/);
  });
});
