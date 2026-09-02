import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "./fs-utils.js";
import {
  isModuleType,
  isValidModuleName,
  moduleFiles,
  nameProblem,
  parseDependsOn,
  renderDescriptor,
  renderSkill,
  requiresRange,
  writeModule,
} from "./new-module.js";
import type { ModuleSpec } from "./new-module.js";
import { validateRegistryItem } from "./schema.js";

function spec(over: Partial<ModuleSpec> = {}): ModuleSpec {
  return { dependsOn: [], name: "billing", type: "saasaloy:feature", ...over };
}

function descriptor(over: Partial<ModuleSpec> = {}): Record<string, unknown> {
  return JSON.parse(renderDescriptor(spec(over))) as Record<string, unknown>;
}

describe(isValidModuleName, () => {
  it("accepts the shapes the schema's pattern accepts", () => {
    for (const name of ["api", "email-plunk", "d1", "a"]) {
      expect(isValidModuleName(name)).toBeTruthy();
    }
  });

  it("rejects anything the schema would reject", () => {
    for (const name of ["", "-lead", "Billing", "my module", "a/b", "a_b"]) {
      expect(isValidModuleName(name)).toBeFalsy();
    }
  });
});

describe(nameProblem, () => {
  it("says nothing about a usable name", () => {
    expect(nameProblem("billing")).toBeUndefined();
  });

  it("quotes the name it refused", () => {
    expect(nameProblem("Billing")).toContain('"Billing"');
  });
});

describe(isModuleType, () => {
  it("accepts both tiers", () => {
    expect(isModuleType("saasaloy:capability")).toBeTruthy();
    expect(isModuleType("saasaloy:feature")).toBeTruthy();
  });

  it("rejects the bare word a user might type", () => {
    expect(isModuleType("feature")).toBeFalsy();
  });
});

describe(requiresRange, () => {
  it("floors the range at the running CLI's own minor", () => {
    expect(requiresRange("0.3.1")).toBe(">=0.3");
    expect(requiresRange("1.2.3")).toBe(">=1.2");
  });

  it("declares nothing when the CLI cannot read its own version", () => {
    expect(requiresRange("unknown")).toBeUndefined();
  });

  it("declares nothing on the 0.0.x placeholder, since >=0.0 constrains nothing", () => {
    expect(requiresRange("0.0.0")).toBeUndefined();
    expect(requiresRange("0.0.7")).toBeUndefined();
  });

  it("declares nothing for a version that will not parse", () => {
    expect(requiresRange("not-a-version")).toBeUndefined();
  });
});

describe(parseDependsOn, () => {
  it("splits on commas and trims", () => {
    expect(parseDependsOn("api, database")).toStrictEqual(["api", "database"]);
  });

  it("drops an empty segment rather than declaring a nameless dependency", () => {
    expect(parseDependsOn("api,,")).toStrictEqual(["api"]);
    expect(parseDependsOn("  ")).toStrictEqual([]);
  });
});

describe(renderDescriptor, () => {
  it("validates against registry-item.schema.json", async () => {
    const result = await validateRegistryItem(
      descriptor({ dependsOn: ["api"], requires: ">=0.3" })
    );

    expect(result.errors).toStrictEqual([]);
  });

  it("validates with every optional field left out", async () => {
    const result = await validateRegistryItem(descriptor());

    expect(result.errors).toStrictEqual([]);
  });

  it("names the module and its tier", () => {
    expect(descriptor({ type: "saasaloy:capability" })).toMatchObject({
      name: "billing",
      type: "saasaloy:capability",
    });
  });

  it("points at the schema, so an editor validates while you type", () => {
    expect(descriptor().$schema).toContain("registry-item.schema.json");
  });

  it("writes requires only when there is a range to write", () => {
    expect(descriptor({ requires: ">=0.3" }).requires).toStrictEqual({
      saasaloy: ">=0.3",
    });
    expect(descriptor()).not.toHaveProperty("requires");
  });

  it("omits dependsOn rather than writing an empty array", () => {
    expect(descriptor()).not.toHaveProperty("dependsOn");
    expect(descriptor({ dependsOn: ["api"] }).dependsOn).toStrictEqual(["api"]);
  });

  it("points agent.skills at the prefixed folder the scaffold writes", () => {
    expect(descriptor().agent).toStrictEqual({
      skills: ["skills/saasaloy-billing"],
    });
  });

  it("ends with a newline, like every other file in the repo", () => {
    expect(renderDescriptor(spec()).endsWith("}\n")).toBeTruthy();
  });
});

describe(renderSkill, () => {
  it("names the skill after the prefixed folder", () => {
    expect(renderSkill(spec())).toContain("name: saasaloy-billing");
  });

  it("opens with frontmatter carrying a description", () => {
    const lines = renderSkill(spec()).split("\n");

    expect(lines[0]).toBe("---");
    expect(renderSkill(spec())).toContain("description: ");
  });

  it("says which tier the module is", () => {
    expect(renderSkill(spec())).toContain("**feature module**");
    expect(renderSkill(spec({ type: "saasaloy:capability" }))).toContain(
      "**capability module**"
    );
  });

  it("names the dependencies the author declared", () => {
    expect(renderSkill(spec({ dependsOn: ["api", "database"] }))).toContain(
      "api, database"
    );
  });

  it("carries the Wire-up section a UI-bearing module owes its reader", () => {
    expect(renderSkill(spec())).toContain("## Wire-up");
  });
});

describe(moduleFiles, () => {
  it("writes a descriptor, a payload folder and a prefixed skill", () => {
    expect(moduleFiles(spec()).map((file) => file.path)).toStrictEqual([
      "registry-item.json",
      "files/.gitkeep",
      "skills/saasaloy-billing/SKILL.md",
    ]);
  });
});

describe(writeModule, () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "saasaloy-new-module-"));
  });

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it("puts every file on disk and reports what it wrote", async () => {
    const target = join(dir, "billing");

    const written = await writeModule(target, spec());

    expect(written).toHaveLength(3);
    for (const path of written) {
      await expect(
        pathExists(join(target, ...path.split("/")))
      ).resolves.toBeTruthy();
    }
  });

  it("writes the descriptor the renderer produced, byte for byte", async () => {
    const target = join(dir, "billing");

    await writeModule(target, spec({ requires: ">=0.3" }));

    await expect(
      readFile(join(target, "registry-item.json"), "utf-8")
    ).resolves.toBe(renderDescriptor(spec({ requires: ">=0.3" })));
  });

  it("leaves files/ empty apart from the keep file", async () => {
    const target = join(dir, "billing");

    await writeModule(target, spec());

    await expect(
      readFile(join(target, "files", ".gitkeep"), "utf-8")
    ).resolves.toBe("");
  });
});
