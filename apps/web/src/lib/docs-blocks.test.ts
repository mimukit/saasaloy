import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertKnownBlocks,
  blockFor,
  remarkDocsBlocks,
} from "./docs-blocks.ts";
import {
  graphData,
  parseBlockArgs,
  providersData,
} from "./docs-blocks-data.ts";
import type { BlockDescriptor } from "./docs-blocks-data.ts";

const providers = { kind: "plugin-array", arrayProp: "providers" };

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
    patches: [providers],
  },
  {
    name: "email-console",
    type: "saasaloy:feature",
    stage: "mvp",
    description: "Console.",
    dependsOn: ["email"],
    patches: [providers],
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
    data?: { hProperties?: Record<string, unknown> };
    children?: Node[];
  }
  const tree = (lang: string, meta?: string): Node => ({
    type: "root",
    children: [
      { type: "paragraph", children: [] },
      { type: "blockquote", children: [{ type: "code", lang, meta }] },
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

  it("scans a body for an unknown saasaloy-* fence", () => {
    assert.throws(
      () => assertKnownBlocks("text\n\n```saasaloy-bogus x=1\n```\n", "x.md"),
      /Unknown block "saasaloy-bogus".*x\.md/
    );
    assertKnownBlocks("```saasaloy-graph focus=email\n```\n", "x.md");
    assertKnownBlocks("```ts\nconst a = 1;\n```\n", "x.md");
    // A fence shown inside a longer fence is text, not a block.
    assertKnownBlocks("````md\n```saasaloy-bogus\n```\n````\n", "x.md");
  });
});
