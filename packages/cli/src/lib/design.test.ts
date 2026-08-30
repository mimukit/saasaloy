import { describe, expect, it } from "vitest";
import type { Plan } from "./applier.js";
import { planWritesUi } from "./design.js";

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

function planPatch(
  file: string,
  action: Plan["patches"][number]["action"],
): Plan["patches"][number] {
  return {
    file,
    action,
    module: "test",
    fileAbs: `/tmp/${file}`,
    patch: { kind: "package-json-script", file, name: "build", value: "tsc" },
    diff: "",
  };
}

function plan(parts: Partial<Pick<Plan, "files" | "patches">>): Pick<Plan, "files" | "patches"> {
  return { files: parts.files ?? [], patches: parts.patches ?? [] };
}

describe("add design update notice", () => {
  it("detects a file that the plan writes under packages/ui", () => {
    expect(
      planWritesUi(plan({ files: [planFile("packages/ui/src/components/banner.tsx", "create")] })),
    ).toBe(true);
  });

  it("detects a patch that the plan applies under packages/ui", () => {
    expect(planWritesUi(plan({ patches: [planPatch("packages/ui/package.json", "apply")] }))).toBe(
      true,
    );
  });

  it("ignores held and unrelated files", () => {
    expect(
      planWritesUi(
        plan({
          files: [
            planFile("packages/ui/src/components/banner.tsx", "drift"),
            planFile("packages/ui-kit/src/banner.tsx", "create"),
            planFile("apps/web/src/pages/index.astro", "overwrite"),
          ],
        }),
      ),
    ).toBe(false);
  });

  it("ignores patches that do not write under packages/ui", () => {
    expect(
      planWritesUi(
        plan({
          patches: [
            planPatch("packages/ui/package.json", "unchanged"),
            planPatch("packages/ui/tsconfig.json", "missing"),
            planPatch("apps/web/package.json", "apply"),
          ],
        }),
      ),
    ).toBe(false);
  });
});
