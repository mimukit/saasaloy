import { describe, expect, it } from "vitest";
import {
  constPropertyRefusal,
  constPropertyRemoveRefusal,
  setConstProperty,
  unsetConstProperty,
} from "./const-property.js";
import { applyPatch, reversePatch } from "./index.js";

const CONFIG = `import type { DeployConfig } from "./types.ts";

export const deployConfig: DeployConfig = {
  // The GitHub Actions workflow that must pass on HEAD, such as "ci.yml".
  ciWorkflow: undefined,
  tagPrefix: "deploy-",
};
`;

const CI = {
  constName: "deployConfig",
  property: "ciWorkflow",
  value: "ci.yml",
} as const;

describe(setConstProperty, () => {
  it("fills a property that reads undefined and keeps every other byte", () => {
    expect(setConstProperty(CONFIG, CI)).toBe(
      CONFIG.replace("ciWorkflow: undefined", 'ciWorkflow: "ci.yml"')
    );
  });

  it("is a no-op on a second run", () => {
    const once = setConstProperty(CONFIG, CI);
    expect(setConstProperty(once, CI)).toBe(once);
    expect(constPropertyRefusal(once, CI)).toBeUndefined();
  });

  it("leaves a value the owner set alone and says why", () => {
    const owned = CONFIG.replace("undefined", '"release.yml"');
    expect(setConstProperty(owned, CI)).toBe(owned);
    expect(constPropertyRefusal(owned, CI)).toContain('"release.yml"');
  });

  it("refuses by name when the property or the const is absent", () => {
    expect(
      constPropertyRefusal(CONFIG, { ...CI, property: "missing" })
    ).toContain("missing");
    expect(constPropertyRefusal("export const other = {};\n", CI)).toContain(
      "deployConfig"
    );
  });
});

describe(unsetConstProperty, () => {
  it("puts undefined back while the property holds the patch's value", () => {
    expect(unsetConstProperty(setConstProperty(CONFIG, CI), CI)).toBe(CONFIG);
  });

  it("leaves an owner's later value alone and says why", () => {
    const owned = CONFIG.replace("undefined", '"release.yml"');
    expect(unsetConstProperty(owned, CI)).toBe(owned);
    expect(constPropertyRemoveRefusal(owned, CI)).toContain("release.yml");
  });

  it("treats an already-reverted file as a plain no-op", () => {
    expect(unsetConstProperty(CONFIG, CI)).toBe(CONFIG);
    expect(constPropertyRemoveRefusal(CONFIG, CI)).toBeUndefined();
  });
});

describe("const-property through the engine", () => {
  it("applies and reverses with a diff", () => {
    const patch = { kind: "const-property", ...CI } as const;
    const applied = applyPatch(CONFIG, patch, "deploy.config.ts");
    expect(applied.changed).toBeTruthy();
    expect(applied.diff).toContain('+  ciWorkflow: "ci.yml",');
    const reversed = reversePatch(applied.content, patch, "deploy.config.ts");
    expect(reversed?.content).toBe(CONFIG);
  });
});
