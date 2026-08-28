import { describe, expect, it } from "vitest";
import type { Plan } from "../lib/applier.js";
import { planWritesUi } from "./add.js";

function planFile(target: string, action: Plan["files"][number]["action"]): Plan["files"][number] {
  return {
    target,
    action,
    content: "",
    module: "test",
    source: "/tmp/source",
    targetAbs: "/tmp/target",
    newHash: "hash",
    isSkill: false,
  };
}

describe("add design update notice", () => {
  it("detects a file that the plan writes under packages/ui", () => {
    expect(planWritesUi([planFile("packages/ui/src/components/banner.tsx", "create")])).toBe(true);
  });

  it("ignores held and unrelated files", () => {
    expect(
      planWritesUi([
        planFile("packages/ui/src/components/banner.tsx", "drift"),
        planFile("packages/ui-kit/src/banner.tsx", "create"),
        planFile("apps/web/src/pages/index.astro", "overwrite"),
      ]),
    ).toBe(false);
  });
});
