import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const WIKI = fileURLToPath(new URL("../../../../docs/wiki/", import.meta.url));

// A block with no language counts as shell: a bare fence around a command is how a page
// shows one to type. `text` stays out, because the reference pages use it for a synopsis.
const SHELL_LANGUAGES = new Set(["", "bash", "sh", "shell", "zsh", "console"]);

// `npx`, `pnpm dlx`, a pinned `saasaloy@<version>` and leading `KEY=value` pairs all still
// run a task, so none of them hides a line from the check.
const TASK_LINE =
  /^\s*(?:\$\s+)?(?:[A-Z][A-Z0-9_]*=\S*\s+)*(?:npx\s+|pnpm\s+dlx\s+)?saasaloy(?:@\S+)?\s+(?:init|add|remove|update)(?:\s|$)/;
// `--diff` is a preview like `--dry-run`: it stops before the prompt and writes nothing.
const FLAG_VARIANT = /\s--(?:dry-run|diff|abort|done)(?:\s|=|$)/;

/**
 * Task lines that stay plain shell on purpose, keyed by page and the exact trimmed line. An
 * entry needs a reason; a line that leaves its page makes the stale-entry test fail.
 */
const ALLOWED: { page: string; line: string; reason: string }[] = [
  {
    page: "how-to/add-a-module.md",
    line: "saasaloy add admin teams --yes",
    reason: "Shows two modules in one run; a prompt names one module page.",
  },
  {
    page: "how-to/add-a-module.md",
    line: "saasaloy add waitlist --force",
    reason: "A flag variant that rewrites deleted files, not the install task.",
  },
  {
    page: "how-to/add-a-module.md",
    line: "saasaloy add someone/their-repo/their-module",
    reason:
      "A third-party coordinate has no module page for a prompt to fetch.",
  },
  {
    page: "how-to/add-a-module.md",
    line: "saasaloy add someone/their-repo@v1.2.0/their-module",
    reason:
      "A third-party coordinate has no module page for a prompt to fetch.",
  },
  {
    page: "how-to/add-a-module.md",
    line: "saasaloy add someone/their-repo                    # picker over that repo",
    reason:
      "A third-party coordinate has no module page for a prompt to fetch.",
  },
  {
    page: "runbooks/bad-descriptor-on-main.md",
    line: "saasaloy init /tmp/verify-app --no-install",
    reason:
      "A maintainer's scratch project to test a descriptor, not a reader's task.",
  },
  {
    page: "generated/modules/api-keys.md",
    line: "saasaloy add api-keys-organization   # or: saasaloy add api-keys-user",
    reason:
      "Copied from the module skill, which ships into projects with no prompt.",
  },
  {
    page: "generated/modules/database.md",
    line: "saasaloy add database-postgres",
    reason:
      "Copied from the module skill, which ships into projects with no prompt.",
  },
  {
    page: "generated/modules/queue.md",
    line: "saasaloy add queue-cloudflare",
    reason:
      "Copied from the module skill, which ships into projects with no prompt.",
  },
  {
    page: "generated/modules/queue.md",
    line: "saasaloy add queue-memory",
    reason:
      "Copied from the module skill, which ships into projects with no prompt.",
  },
];

interface TaskLine {
  page: string;
  line: string;
}

function wikiPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return wikiPages(path);
    }
    return entry.name.endsWith(".md") ? [path] : [];
  });
}

/** The task lines of one page that sit in a shell block, by the CommonMark fence rule. */
function plainTaskLines(page: string, text: string): TaskLine[] {
  const found: TaskLine[] = [];
  let open: { char: string; size: number; language: string } | undefined;
  for (const line of text.split("\n")) {
    const match = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (open === undefined) {
      if (match === null) {
        continue;
      }
      const [, fence = "", rest = ""] = match;
      if (fence.startsWith("`") && rest.includes("`")) {
        continue;
      }
      const language = rest.trim().split(/\s+/)[0] ?? "";
      open = { char: fence.charAt(0), size: fence.length, language };
      continue;
    }
    if (match !== null) {
      const [, fence = "", rest = ""] = match;
      if (
        fence.charAt(0) === open.char &&
        fence.length >= open.size &&
        rest.trim() === ""
      ) {
        open = undefined;
        continue;
      }
    }
    if (
      SHELL_LANGUAGES.has(open.language) &&
      TASK_LINE.test(line) &&
      !FLAG_VARIANT.test(line)
    ) {
      found.push({ page, line: line.trim() });
    }
  }
  return found;
}

function allTaskLines(): TaskLine[] {
  return wikiPages(WIKI).flatMap((path) =>
    plainTaskLines(
      relative(WIKI, path).split("\\").join("/"),
      readFileSync(path, "utf-8")
    )
  );
}

function isAllowed(found: TaskLine): boolean {
  return ALLOWED.some(
    (entry) => entry.page === found.page && entry.line === found.line
  );
}

describe("plainTaskLines", () => {
  it("finds a task line in a shell or bare block, behind npx, pnpm dlx or an env pair", () => {
    const page = [
      "```bash",
      "saasaloy add waitlist",
      "```",
      "```sh",
      "$ npx saasaloy init my-app",
      "```",
      "```",
      "saasaloy update --yes",
      "```",
      "```shell",
      "pnpm dlx saasaloy@0.9.0 remove infra",
      "SAASALOY_REGISTRY_DIR=/r saasaloy add waitlist",
      "```",
    ].join("\n");
    assert.deepEqual(
      plainTaskLines("p.md", page).map((found) => found.line),
      [
        "saasaloy add waitlist",
        "$ npx saasaloy init my-app",
        "saasaloy update --yes",
        "pnpm dlx saasaloy@0.9.0 remove infra",
        "SAASALOY_REGISTRY_DIR=/r saasaloy add waitlist",
      ]
    );
  });

  it("skips a saasaloy-command fence, a text synopsis and a flag variant", () => {
    const page = [
      "```saasaloy-command task=add name=waitlist",
      "saasaloy add waitlist",
      "```",
      "```text",
      "saasaloy remove [<module>]",
      "```",
      "```bash",
      "saasaloy add waitlist --dry-run",
      "saasaloy remove waitlist --diff",
      "saasaloy update --abort",
      "saasaloy update --done base/0001 --yes",
      "saasaloy env",
      "```",
    ].join("\n");
    assert.deepEqual(plainTaskLines("p.md", page), []);
  });

  it("keeps a longer fence open over a shorter one inside it", () => {
    const page = [
      "````md",
      "```bash",
      "saasaloy add waitlist",
      "```",
      "````",
    ].join("\n");
    assert.deepEqual(plainTaskLines("p.md", page), []);
  });
});

describe("docs/wiki task commands", () => {
  it("puts every saasaloy task line in a saasaloy-command fence", () => {
    const missing = allTaskLines().filter((found) => !isAllowed(found));
    assert.deepEqual(
      missing,
      [],
      "Wrap these lines in a ```saasaloy-command task=<key> fence, or add an ALLOWED entry with a reason."
    );
  });

  it("has no ALLOWED entry for a line that is gone", () => {
    const lines = allTaskLines();
    const stale = ALLOWED.filter(
      (entry) =>
        !lines.some(
          (found) => found.page === entry.page && found.line === entry.line
        )
    );
    assert.deepEqual(stale, []);
  });
});
