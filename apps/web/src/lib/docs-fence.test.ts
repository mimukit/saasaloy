import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fenceReader } from "./docs-fence.ts";

/** The lines a fresh reader marks as fence or fenced, by index. */
function fenced(markdown: string): number[] {
  const inFence = fenceReader();
  return markdown
    .split("\n")
    .flatMap((line, index) => (inFence(line) ? [index] : []));
}

describe("fenceReader", () => {
  it("marks a fence, its body and its closing line", () => {
    assert.deepEqual(fenced("a\n```ts\nx\n```\nb"), [1, 2, 3]);
  });

  it("keeps a longer fence open over a shorter one inside it", () => {
    assert.deepEqual(fenced("````md\n```ts\nx\n```\n````\nb"), [0, 1, 2, 3, 4]);
  });

  it("closes only on the same character", () => {
    assert.deepEqual(fenced("~~~\n```\n~~~\nb"), [0, 1, 2]);
  });

  it("does not close on a fence line with an info string", () => {
    assert.deepEqual(fenced("```\n```ts\n```\nb"), [0, 1, 2]);
  });

  it("finds an indented fence in a list item", () => {
    assert.deepEqual(fenced("- a\n\n    ```sh\n    x\n    ```\nb"), [2, 3, 4]);
  });
});
