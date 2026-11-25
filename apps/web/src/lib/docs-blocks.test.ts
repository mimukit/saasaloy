import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { agentPrompt } from "../content/prompts.ts";
import { blockFor, remarkDocsBlocks } from "./docs-blocks.ts";
import {
  graphData,
  parseBlockArgs,
  providersData,
} from "./docs-blocks-data.ts";
import type { BlockDescriptor } from "./docs-blocks-data.ts";

const providers = { table: "email.providers" };

const REGISTRY: BlockDescriptor[] = [
  { name: "api", type: "saasaloy:capability", stage: "validate" },
  {
    name: "email",
    type: "saasaloy:capability",
    stage: "mvp",
    description: "Email.",
    dependsOn: ["api"],
    envVars: { EMAIL_FROM: "From.", EMAIL_PROVIDER: "Which sends." },
  },
  {
    name: "email-plunk",
    type: "saasaloy:feature",
    stage: "mvp",
    description: "Plunk.",
    dependsOn: ["email"],
    entries: [providers],
  },
  {
    name: "email-console",
    type: "saasaloy:feature",
    stage: "mvp",
    description: "Console.",
    dependsOn: ["email"],
    entries: [providers],
  },
  {
    name: "teams",
    type: "saasaloy:feature",
    stage: "teams",
    dependsOn: ["api", "email"],
  },
];

const ROOT = fileURLToPath(new URL("../../../..", import.meta.url));

describe("graphData", () => {
  it("gives each tile its needs, its dependents and its providers", () => {
    const { modules, selected } = graphData(REGISTRY);
    const email = modules.find((item) => item.name === "email");
    assert.deepEqual(email?.needs, ["api"]);
    assert.deepEqual(email?.usedBy, ["teams"]);
    assert.deepEqual(
      email?.variants.map((variant) => variant.name),
      ["email-console", "email-plunk"]
    );
    assert.equal(selected, "api");
    assert.equal(
      modules.some((item) => item.name === "email-plunk"),
      false
    );
  });

  it("opens on the focus and rejects a module with no tile", () => {
    assert.equal(graphData(REGISTRY, "email").selected, "email");
    assert.throws(
      () => graphData(REGISTRY, "email-plunk"),
      /focus=email-plunk/
    );
    assert.throws(() => graphData(REGISTRY, "nope"), /focus=nope/);
  });
});

describe("providersData", () => {
  it("reads the selector variable and one value for each provider", () => {
    const data = providersData(REGISTRY, "email");
    assert.equal(data.selector, "EMAIL_PROVIDER");
    assert.deepEqual(
      data.providers.map((item) => [item.name, item.value]),
      [
        ["email-console", "console"],
        ["email-plunk", "plunk"],
      ]
    );
  });

  it("marks a selector that takes a comma list", () => {
    assert.equal(providersData(REGISTRY, "email").list, false);
    const listed = REGISTRY.map((item) =>
      item.name === "email"
        ? {
            ...item,
            envVars: {
              EMAIL_PROVIDER: "Providers, as a comma list in priority order.",
            },
          }
        : item
    );
    assert.equal(providersData(listed, "email").list, true);
  });

  it("rejects a module with no provider and a capability with no selector", () => {
    assert.throws(() => providersData(REGISTRY, "api"), /capability=api/);
    assert.throws(
      () =>
        providersData(
          REGISTRY.map((item) =>
            item.name === "email" ? { ...item, envVars: {} } : item
          ),
          "email"
        ),
      /no \*_PROVIDER/
    );
  });
});

describe("parseBlockArgs", () => {
  it("reads key=value words and rejects the rest", () => {
    assert.deepEqual(parseBlockArgs("focus=email", ["focus"], "x"), {
      focus: "email",
    });
    assert.deepEqual(parseBlockArgs(null, ["focus"], "x"), {});
    assert.throws(() => parseBlockArgs("email", ["focus"], "x"), /"email"/);
    assert.throws(() => parseBlockArgs("size=2", ["focus"], "x"), /size=2/);
  });

  it("reads a quoted value with spaces and rejects an unclosed quote", () => {
    assert.deepEqual(
      parseBlockArgs(
        'task=deploy section="Roll back"',
        ["task", "section"],
        "x"
      ),
      { task: "deploy", section: "Roll back" }
    );
    assert.throws(
      () => parseBlockArgs('section="Roll back', ["section"], "x"),
      /cannot read/
    );
    assert.throws(
      () => parseBlockArgs('section=""', ["section"], "x"),
      /cannot read/
    );
  });
});

describe("the saasaloy-command block", () => {
  const BODY = "saasaloy add email\nsaasaloy env\n\npnpm install\n";

  it("writes the prompt and the commands as plain text and as the island's JSON", () => {
    const node = blockFor(
      "saasaloy-command",
      "task=add name=email",
      REGISTRY,
      BODY
    );
    const prompt = agentPrompt("add", { name: "email" });
    assert.equal(node.data?.hProperties?.["data-saasaloy-block"], "command");
    assert.deepEqual(node.data?.hProperties?.className, [
      "saasaloy-block",
      "saasaloy-command",
    ]);
    const [first, second] = node.children ?? [];
    assert.equal(first?.type, "paragraph");
    assert.equal(first?.children?.[0]?.value, `Agent prompt: ${prompt}`);
    assert.equal(second?.type, "code");
    assert.equal(
      second?.value,
      "saasaloy add email\nsaasaloy env\npnpm install"
    );
    assert.deepEqual(
      JSON.parse(String(node.data?.hProperties?.["data-props"])),
      {
        prompt,
        commands: ["saasaloy add email", "saasaloy env", "pnpm install"],
      }
    );
    assert.match(
      prompt,
      /^Add the email module to my Saasaloy project\. Fetch https:\/\/saasaloy\.com\/docs\/modules\/email\.md and follow its Install section\.$/
    );
  });

  it("fetches the page a page= argument gives", () => {
    const node = blockFor(
      "saasaloy-command",
      'task=update page=runbooks/update-overwrote-my-work section="Stop it happening again"',
      REGISTRY,
      "npx saasaloy@latest update --yes"
    );
    const props = JSON.parse(String(node.data?.hProperties?.["data-props"]));
    assert.ok(
      props.prompt.includes(
        "/docs/runbooks/update-overwrote-my-work.md and follow its Stop it happening again section."
      )
    );
  });

  it("refuses a page= value that is not a docs slug", () => {
    assert.throws(
      () =>
        blockFor(
          "saasaloy-command",
          "task=update page=../secrets.md",
          REGISTRY,
          "npx saasaloy@latest update --yes"
        ),
      /page=\.\.\/secrets\.md is not a docs slug/
    );
  });

  it("names the section a quoted section= argument gives", () => {
    const node = blockFor(
      "saasaloy-command",
      'task=deploy section="Roll back"',
      REGISTRY,
      "pnpm deploy:production"
    );
    const props = JSON.parse(String(node.data?.hProperties?.["data-props"]));
    assert.equal(props.prompt, agentPrompt("deploy", { section: "Roll back" }));
    assert.ok(props.prompt.endsWith("follow its Roll back section."));
  });

  it("fails on an unknown task, a missing or stray name, an unknown module and no body", () => {
    const run =
      (meta: string, body = "saasaloy add email") =>
      () =>
        blockFor("saasaloy-command", meta, REGISTRY, body);
    assert.throws(run("task=ad name=email"), /task=ad is not a prompt task/);
    assert.throws(run("name=email"), /needs task=<task>/);
    assert.throws(run("task=add"), /task=add needs name=<module>/);
    assert.throws(run("task=init name=email"), /task=init takes no name/);
    assert.throws(run("task=add name=nope"), /name=nope is not a module/);
    assert.throws(run("task=add name=email", "\n"), /has no command/);
    assert.throws(run("task=add name=email size=2"), /cannot read "size=2"/);
  });
});

describe("blockFor", () => {
  it("writes the graph as a list of modules and the JSON the island reads", () => {
    const node = blockFor("saasaloy-graph", "focus=email", REGISTRY);
    assert.equal(node.data?.hName, "div");
    assert.equal(node.data?.hProperties?.["data-saasaloy-block"], "graph");
    const props = JSON.parse(String(node.data?.hProperties?.["data-props"]));
    assert.equal(props.selected, "email");
    const list = node.children?.find((child) => child.type === "list");
    assert.equal(list?.children?.length, 3);
  });

  it("writes the providers block with the value each provider takes", () => {
    const node = blockFor("saasaloy-providers", "capability=email", REGISTRY);
    const list = node.children?.find((child) => child.type === "list");
    const first = list?.children?.[0]?.children?.[0]?.children?.[0];
    assert.equal(first?.value, "EMAIL_PROVIDER=console");
  });

  it("fails on an unknown language, a missing argument and a wrong one", () => {
    assert.throws(
      () => blockFor("saasaloy-grph", "", REGISTRY),
      /Unknown block "saasaloy-grph"/
    );
    assert.throws(
      () => blockFor("saasaloy-providers", "", REGISTRY),
      /needs capability/
    );
    assert.throws(
      () => blockFor("saasaloy-graph", "capability=email", REGISTRY),
      /capability=email/
    );
  });
});

describe("remarkDocsBlocks", () => {
  interface Node {
    type: string;
    lang?: string;
    meta?: string;
    value?: string;
    data?: { hProperties?: Record<string, unknown> };
    children?: Node[];
  }
  const tree = (lang: string, meta?: string, value?: string): Node => ({
    type: "root",
    children: [
      { type: "paragraph", children: [] },
      { type: "blockquote", children: [{ type: "code", lang, meta, value }] },
    ],
  });

  it("replaces a fence in the registry of the repo, nested ones too", () => {
    const root = tree("saasaloy-graph", "focus=email");
    remarkDocsBlocks({ repoRoot: ROOT })(root, { path: "x.md" });
    const quote = root.children?.[1];
    assert.equal(quote?.children?.[0]?.type, "saasaloyBlock");
    const props = JSON.parse(
      String(quote?.children?.[0]?.data?.hProperties?.["data-props"])
    );
    const email = props.modules.find(
      (item: { name: string }) => item.name === "email"
    );
    assert.deepEqual(email.needs, ["api"]);
    assert.equal(
      email.variants.filter((v: { tier: string }) => v.tier === "provider")
        .length,
      3
    );
  });

  it("reads the body of a saasaloy-command fence", () => {
    const root = tree(
      "saasaloy-command",
      "task=add name=waitlist",
      "saasaloy add waitlist"
    );
    remarkDocsBlocks({ repoRoot: ROOT })(root);
    const props = JSON.parse(
      String(
        root.children?.[1]?.children?.[0]?.data?.hProperties?.["data-props"]
      )
    );
    assert.deepEqual(props.commands, ["saasaloy add waitlist"]);
    assert.equal(props.prompt, agentPrompt("add", { name: "waitlist" }));
  });

  it("fails the build on a saasaloy-command fence with no module name", () => {
    assert.throws(
      () =>
        remarkDocsBlocks({ repoRoot: ROOT })(
          tree("saasaloy-command", "task=add", "saasaloy add waitlist"),
          { path: "docs/wiki/x.md" }
        ),
      /task=add needs name=<module>.*docs\/wiki\/x\.md/
    );
  });

  it("leaves other fences alone", () => {
    const root = tree("ts");
    remarkDocsBlocks({ repoRoot: ROOT })(root);
    assert.equal(root.children?.[1]?.children?.[0]?.type, "code");
  });

  it("fails the build on an unknown saasaloy-* fence and names the page", () => {
    assert.throws(
      () =>
        remarkDocsBlocks({ repoRoot: ROOT })(tree("saasaloy-chart"), {
          path: "docs/wiki/x.md",
        }),
      /Unknown block "saasaloy-chart".*docs\/wiki\/x\.md/
    );
  });
});
