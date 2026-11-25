import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { agentPrompt, isPromptTask, prompts } from "./prompts.ts";

const WIKI = fileURLToPath(new URL("../../../../docs/wiki/", import.meta.url));

describe("agentPrompt", () => {
  it("builds the init prompt", () => {
    assert.equal(
      agentPrompt("init"),
      "Create a new Saasaloy project in a new empty directory. Fetch https://saasaloy.com/docs/getting-started.md and follow its For agents section."
    );
  });

  it("fills the module name into the add prompt and its page", () => {
    assert.equal(
      agentPrompt("add", { name: "waitlist" }),
      "Add the waitlist module to my Saasaloy project. Fetch https://saasaloy.com/docs/modules/waitlist.md and follow its Install section."
    );
  });

  it("builds every task in the one pattern", () => {
    for (const [task, entry] of Object.entries(prompts)) {
      const text = agentPrompt(task, { name: "auth" });
      const slug = entry.slug.replace("{name}", "auth");
      assert.ok(
        text.endsWith(
          ` Fetch https://saasaloy.com/docs/${slug}.md and follow its ${entry.section} section.`
        ),
        text
      );
      assert.ok(text.startsWith(entry.task.replace("{name}", "auth")), text);
    }
  });

  it("names the section the override gives", () => {
    assert.equal(
      agentPrompt("deploy", { section: "Roll back" }),
      "Deploy my Saasaloy project to Cloudflare. Fetch https://saasaloy.com/docs/how-to/deploy-to-cloudflare.md and follow its Roll back section."
    );
  });

  it("throws on an unknown task", () => {
    assert.throws(
      () => agentPrompt("install"),
      /Unknown agent prompt task "install"/
    );
    assert.equal(isPromptTask("install"), false);
    assert.equal(isPromptTask("toString"), false);
  });

  it("throws when a task that needs a module name gets none", () => {
    assert.throws(() => agentPrompt("add"), /needs a module name/);
  });

  it("fetches a page the wiki has", () => {
    for (const entry of Object.values(prompts)) {
      const slug = entry.slug.replace("{name}", "waitlist");
      const path = slug.startsWith("modules/")
        ? `generated/${slug}.md`
        : `${slug}.md`;
      assert.ok(existsSync(`${WIKI}${path}`), `docs/wiki/${path}`);
    }
  });
});
