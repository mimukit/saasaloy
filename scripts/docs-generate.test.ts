// Tests for `scripts/docs-generate.ts` (plan 0114, Phase 2). The generator reads a repo
// root, so each test that changes an input copies the files it reads into a temp folder and
// changes the copy. The real tree is only read.

import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { catalogRows } from "../apps/web/src/lib/module-catalog.ts";
import type { RegistryDescriptor } from "../apps/web/src/lib/module-catalog.ts";
import {
  generate,
  rewriteLinks,
  stalePaths,
  writeGenerated,
} from "./docs-generate.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const scratch: string[] = [];

/** A copy of the files the generator reads: descriptors, skills, CLI sources, CONTEXT, ADRs. */
function copyOfInputs(): string {
  const copy = mkdtempSync(join(tmpdir(), "docs-generate-"));
  scratch.push(copy);
  // The payload under `modules/<name>/files/` is large and the generator never reads it.
  const keep = (source: string): boolean =>
    !/\/(node_modules|files)(\/|$)/.test(
      source.slice(join(ROOT, "modules").length)
    );
  cpSync(join(ROOT, "modules"), join(copy, "modules"), {
    recursive: true,
    filter: keep,
  });
  for (const path of [
    "CONTEXT.md",
    "README.md",
    "docs/adr",
    "docs/wiki",
    "packages/cli/src/commands",
    "packages/cli/src/lib/exit.ts",
    "packages/cli/src/lib/testing.ts",
    "packages/cli/src/lib/new-module.ts",
  ]) {
    mkdirSync(join(copy, path, ".."), { recursive: true });
    cpSync(join(ROOT, path), join(copy, path), { recursive: true });
  }
  return copy;
}

after(() => {
  for (const path of scratch) {
    rmSync(path, { recursive: true, force: true });
  }
});

const generated = generate(ROOT);

describe("the module catalog", () => {
  it("lists every folder in modules/", () => {
    const folders = readdirSync(join(ROOT, "modules"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    const catalog = generated.get("docs/wiki/generated/modules.md") ?? "";
    for (const name of folders) {
      assert.ok(
        catalog.includes(`[\`${name}\`](modules/${name}.md)`),
        `modules.md misses ${name}`
      );
      assert.ok(generated.has(`docs/wiki/generated/modules/${name}.md`));
    }
    assert.ok(catalog.includes(`${folders.length} modules`));
  });

  it("carries the dependency graph block, one line for each tile", () => {
    const catalog = generated.get("docs/wiki/generated/modules.md") ?? "";
    const body = /```saasaloy-graph\n([\s\S]*?)\n```/.exec(catalog)?.[1] ?? "";
    const lines = body.split("\n");
    assert.ok(
      lines.some((line) =>
        line.startsWith("email (capability): depends on api; used by")
      ),
      "the graph body has no email line"
    );
    assert.ok(
      lines.some((line) =>
        line.includes("providers email-cloudflare, email-console, email-plunk")
      ),
      "the email line names its three providers"
    );
    assert.ok(
      lines.every((line) => !line.startsWith("email-plunk")),
      "a provider has no line of its own"
    );
    assert.ok(
      catalog.indexOf("## Module dependencies") < catalog.indexOf("## Catalog")
    );
  });

  it("puts the providers block on a capability that picks a provider at runtime", () => {
    const email = generated.get("docs/wiki/generated/modules/email.md") ?? "";
    assert.ok(email.includes("```saasaloy-providers capability=email\n"));
    assert.ok(email.includes("EMAIL_PROVIDER=plunk  uses email-plunk"));
    const validators =
      generated.get("docs/wiki/generated/modules/validators.md") ?? "";
    assert.ok(!validators.includes("saasaloy-providers"));
    const provider =
      generated.get("docs/wiki/generated/modules/email-plunk.md") ?? "";
    assert.ok(!provider.includes("saasaloy-providers"));
  });

  it("lists the same providers for each capability as the site catalog", () => {
    const descriptors = readdirSync(join(ROOT, "modules"), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map(
        (entry) =>
          JSON.parse(
            readFileSync(
              join(ROOT, "modules", entry.name, "registry-item.json"),
              "utf-8"
            )
          ) as RegistryDescriptor
      );
    for (const row of catalogRows(descriptors)) {
      const page =
        generated.get(`docs/wiki/generated/modules/${row.name}.md`) ?? "";
      const listed = /^\| Providers \| (.*) \|$/m.exec(page)?.[1] ?? "";
      const expected = row.variants
        .filter((variant) => variant.tier === "provider")
        .map((variant) => variant.name);
      for (const name of expected) {
        assert.ok(listed.includes(`\`${name}\``), `${row.name} misses ${name}`);
      }
      assert.equal(
        listed.match(/`[^`]+`/g)?.length ?? 0,
        expected.length,
        `${row.name} lists a provider that is not its own: ${listed}`
      );
    }
    const kv = generated.get("docs/wiki/generated/modules/kv.md") ?? "";
    assert.ok(!kv.includes("uses payment-bkash"));
  });

  it("starts every generated file with a banner that names the script", () => {
    for (const [path, content] of generated) {
      assert.match(
        content.split("\n")[0] ?? "",
        /^<!-- Generated by scripts\/docs-generate\.ts .*Do not edit/,
        path
      );
    }
  });

  it("is deterministic", () => {
    assert.deepEqual([...generate(ROOT)], [...generated]);
  });
});

describe("a module page", () => {
  it("holds the skill text under 'What your agent reads'", () => {
    const page = generated.get("docs/wiki/generated/modules/email.md") ?? "";
    const skill = readFileSync(
      join(ROOT, "modules/email/skills/saasaloy-email/SKILL.md"),
      "utf-8"
    );
    const firstSentence = skill
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .split("\n")
      .find((line) => line.startsWith("`packages/email`"));
    assert.ok(firstSentence);
    const [, skillPart = ""] = page.split("## What your agent reads");
    assert.ok(skillPart.includes(firstSentence));
  });

  it("names the providers of a capability and the dry-run command", () => {
    const page = generated.get("docs/wiki/generated/modules/email.md") ?? "";
    assert.ok(page.includes("[`email-plunk`](email-plunk.md)"));
    assert.ok(page.includes("saasaloy add email --dry-run"));
  });

  it("names the condition of a conditional key in the Optional column", () => {
    const plunk =
      generated.get("docs/wiki/generated/modules/email-plunk.md") ?? "";
    assert.ok(
      plunk.includes(
        "| `PLUNK_API_KEY` | api | required when `EMAIL_PROVIDER=plunk` |"
      )
    );
    const env = generated.get("docs/wiki/generated/env.md") ?? "";
    assert.ok(
      env.includes(
        "| `EMAIL_FROM` | [`email`](modules/email.md) | api | required when `EMAIL_PROVIDER!=console` |"
      )
    );
  });
});

describe("a descriptor change", () => {
  it("changes the catalog and the module page", () => {
    const copy = copyOfInputs();
    const path = join(copy, "modules/email/registry-item.json");
    const before = generate(copy);
    writeFileSync(
      path,
      readFileSync(path, "utf-8").replace(
        '"description": "A packages/email',
        '"description": "CHANGED packages/email'
      )
    );
    const changed = generate(copy);
    assert.notEqual(
      changed.get("docs/wiki/generated/modules.md"),
      before.get("docs/wiki/generated/modules.md")
    );
    assert.ok(
      changed.get("docs/wiki/generated/modules/email.md")?.includes("CHANGED")
    );
  });
});

describe("check mode", () => {
  it("passes on the files this repo ships", () => {
    assert.deepEqual(stalePaths(ROOT, generated), []);
  });

  it("fails on a stale file, a missing file and a stray file", () => {
    const copy = copyOfInputs();
    writeGenerated(copy, generate(copy));
    assert.deepEqual(stalePaths(copy, generate(copy)), []);

    const dir = join(copy, "docs/wiki/generated");
    writeFileSync(join(dir, "cli.md"), "edited by hand\n");
    rmSync(join(dir, "adr.md"));
    writeFileSync(join(dir, "stray.md"), "left behind\n");
    assert.deepEqual(stalePaths(copy, generate(copy)), [
      "docs/wiki/generated/adr.md",
      "docs/wiki/generated/cli.md",
      "docs/wiki/generated/stray.md",
    ]);
  });
});

describe("rewriteLinks", () => {
  it("re-bases a link that exists and keeps one that does not", () => {
    const text =
      "[a](../../../../docs/adr/0001-adr-all-in-on-cloudflare-2026-07-22.md#x) [b](nope.md) [c](#top)";
    const out = rewriteLinks(
      ROOT,
      text,
      "modules/email/skills/saasaloy-email/SKILL.md",
      "docs/wiki/generated/modules/email.md"
    );
    assert.equal(
      out,
      "[a](../../../adr/0001-adr-all-in-on-cloudflare-2026-07-22.md#x) [b](nope.md) [c](#top)"
    );
  });
});
