import { describe, expect, it } from "vitest";
import {
  detectCliMismatches,
  formatCliMismatches,
  UPGRADE_COMMAND,
} from "./cli-requires.js";
import type { LoadedModule } from "./registry.js";
import type { Graph } from "./resolve.js";
import { validateRegistryItem } from "./schema.js";

function mod(
  name: string,
  requires?: string,
  dependsOn?: string[]
): LoadedModule {
  return {
    dir: `/tmp/${name}`,
    item: {
      name,
      type: "saasaloy:capability",
      ...(dependsOn ? { dependsOn } : {}),
      ...(requires === undefined ? {} : { requires: { saasaloy: requires } }),
    },
  };
}

/** A graph whose `order` is its modules in the order given — dependencies first. */
function graph(...modules: LoadedModule[]): Graph {
  return {
    order: modules.map((m) => m.item.name),
    modules: new Map(modules.map((m) => [m.item.name, m])),
  };
}

describe(detectCliMismatches, () => {
  it("passes a module with no `requires` at all", () => {
    expect(
      detectCliMismatches({ cliVersion: "0.0.0", graph: graph(mod("api")) })
    ).toStrictEqual([]);
  });

  it("passes a module whose range the running CLI satisfies", () => {
    expect(
      detectCliMismatches({
        cliVersion: "1.4.0",
        graph: graph(mod("api", ">=0.3")),
      })
    ).toStrictEqual([]);
  });

  it("flags a module whose range the running CLI fails", () => {
    expect(
      detectCliMismatches({
        cliVersion: "0.0.0",
        graph: graph(mod("api", ">=0.3")),
      })
    ).toStrictEqual([
      { declaredBy: "api", range: ">=0.3", reason: "unsatisfied" },
    ]);
  });

  it("flags a transitive dependency, not the module the user named", () => {
    // `a` dependsOn `b`; only `b` declares an unsatisfiable range.
    const mismatches = detectCliMismatches({
      cliVersion: "0.0.0",
      graph: graph(mod("b", ">=9"), mod("a", undefined, ["b"])),
    });
    expect(mismatches).toStrictEqual([
      { declaredBy: "b", range: ">=9", reason: "unsatisfied" },
    ]);
  });

  it("reports in graph order, so a prerequisite comes before its dependent", () => {
    const mismatches = detectCliMismatches({
      cliVersion: "0.0.0",
      graph: graph(mod("b", ">=9"), mod("a", ">=9", ["b"])),
    });
    expect(mismatches.map((m) => m.declaredBy)).toStrictEqual(["b", "a"]);
  });

  it("flags a range it cannot parse rather than ignoring it", () => {
    expect(
      detectCliMismatches({
        cliVersion: "9.9.9",
        graph: graph(mod("api", ">=nope")),
      })
    ).toStrictEqual([
      { declaredBy: "api", range: ">=nope", reason: "unparseable" },
    ]);
  });

  it("refuses rather than passing silently when the CLI version cannot be read", () => {
    expect(
      detectCliMismatches({
        cliVersion: "unknown",
        graph: graph(mod("api", "*")),
      })
    ).toStrictEqual([
      { declaredBy: "api", range: "*", reason: "unknown-version" },
    ]);
  });

  it("leaves a module with no `requires` alone even when the version is unreadable", () => {
    expect(
      detectCliMismatches({ cliVersion: "unknown", graph: graph(mod("api")) })
    ).toStrictEqual([]);
  });

  it.each([">=0.3", ">=0.3 <2", "^1.2.0", "1.x", "~1.2", "*"])(
    "accepts the range %j, upper bounds included",
    (range) => {
      expect(
        detectCliMismatches({
          cliVersion: "1.2.0",
          graph: graph(mod("api", range)),
        })
      ).toStrictEqual([]);
    }
  );
});

describe(formatCliMismatches, () => {
  it("names the module, the range, the installed version, and the upgrade command", () => {
    const message = formatCliMismatches(
      [{ declaredBy: "api", range: ">=0.3", reason: "unsatisfied" }],
      "api",
      "0.0.0"
    );
    expect(message).toContain("api");
    expect(message).toContain(">=0.3");
    expect(message).toContain("0.0.0");
    expect(message).toContain(UPGRADE_COMMAND);
  });

  it("names the offending module in the chain when it is transitive", () => {
    const message = formatCliMismatches(
      [{ declaredBy: "b", range: ">=9", reason: "unsatisfied" }],
      "a",
      "0.0.0"
    );
    expect(message).toContain("b");
    expect(message).toContain("required by a");
  });

  it("says the version could not be read rather than blaming the range", () => {
    const message = formatCliMismatches(
      [{ declaredBy: "api", range: "*", reason: "unknown-version" }],
      "api",
      "unknown"
    );
    expect(message).toContain("could not be read");
    expect(message).toContain(UPGRADE_COMMAND);
  });

  it("says a range is unparseable rather than blaming the CLI version", () => {
    const message = formatCliMismatches(
      [{ declaredBy: "api", range: ">=nope", reason: "unparseable" }],
      "api",
      "1.0.0"
    );
    expect(message).toContain("isn't a semver range");
    expect(message).not.toContain(UPGRADE_COMMAND);
  });

  it("lists every mismatch under one heading", () => {
    const message = formatCliMismatches(
      [
        { declaredBy: "b", range: ">=9", reason: "unsatisfied" },
        { declaredBy: "a", range: ">=9", reason: "unsatisfied" },
      ],
      "a",
      "0.0.0"
    );
    expect(message.split("\n")).toHaveLength(4);
  });
});

describe("the `requires` field against the descriptor schema", () => {
  const base = { name: "api", type: "saasaloy:capability" } as const;

  it("accepts a descriptor carrying `requires.saasaloy`", async () => {
    const result = await validateRegistryItem({
      ...base,
      requires: { saasaloy: ">=0.3 <2" },
    });
    expect(result.errors).toStrictEqual([]);
  });

  it("accepts a descriptor with no `requires` at all", async () => {
    const result = await validateRegistryItem(base);
    expect(result.errors).toStrictEqual([]);
  });

  it("rejects an unknown key inside `requires`", async () => {
    const result = await validateRegistryItem({
      ...base,
      requires: { npm: ">=1" },
    });
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("rejects a bare string, which is the shape an author would guess", async () => {
    const result = await validateRegistryItem({ ...base, requires: ">=0.3" });
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
