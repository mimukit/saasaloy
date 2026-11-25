import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rehypeCodeFrame } from "./docs-code.ts";

interface Node {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
}

const pre = (): Node => ({ type: "element", tagName: "pre", children: [] });

/** Every Copy button in the tree. */
function buttons(node: Node): Node[] {
  return [
    ...(node.tagName === "button" ? [node] : []),
    ...(node.children ?? []).flatMap(buttons),
  ];
}

describe("rehypeCodeFrame", () => {
  it("gives a code block a Copy button, but not one inside a saasaloy-command block", () => {
    const command: Node = {
      type: "element",
      tagName: "div",
      properties: { className: ["saasaloy-block", "saasaloy-command"] },
      children: [pre()],
    };
    const tree: Node = { type: "root", children: [pre(), command] };
    rehypeCodeFrame()(tree);
    assert.equal(buttons(tree).length, 1);
    assert.equal(
      tree.children?.[0]?.properties?.className?.toString(),
      "docs-code"
    );
    assert.equal(
      command.children?.[0]?.properties?.className?.toString(),
      "docs-code"
    );
    assert.equal(buttons(command).length, 0);
  });
});
