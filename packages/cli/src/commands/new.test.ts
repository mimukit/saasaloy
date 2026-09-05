import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkTarget, resolveDoctorTarget } from "../lib/doctor.js";
import { pathExists } from "../lib/fs-utils.js";
import { validateRegistryItem } from "../lib/schema.js";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, renderFindings, runNew } from "./new.js";

/** The usage line the refusals quote, kept here so a reworded flag list fails loudly. */
const USAGE_LINE = "saasaloy new module <name>";

describe(parseArgs, () => {
  it("reads the noun and the name", () => {
    expect(parseArgs(["module", "billing"])).toMatchObject({
      name: "billing",
      noun: "module",
      unknown: [],
    });
  });

  it("leaves the noun absent when the picker hands off an empty argv", () => {
    expect(parseArgs([])).toStrictEqual({ unknown: [] });
  });

  it("reads --type and --depends-on in both forms", () => {
    expect(
      parseArgs([
        "module",
        "billing",
        "--type",
        "saasaloy:feature",
        "--depends-on=api,database",
      ])
    ).toMatchObject({
      dependsOn: "api,database",
      type: "saasaloy:feature",
      unknown: [],
    });
  });

  it("reports a value flag with nothing usable after it", () => {
    expect(
      parseArgs(["module", "b", "--type", "--depends-on", "api"]).unknown
    ).toStrictEqual(["--type (missing value)"]);
  });

  it("reports an unknown flag rather than ignoring it", () => {
    expect(parseArgs(["module", "b", "--force"]).unknown).toStrictEqual([
      "--force",
    ]);
  });

  it("reports a third positional", () => {
    expect(parseArgs(["module", "b", "c"]).unknown).toStrictEqual(["c"]);
  });

  it("does not treat --help as unknown", () => {
    expect(parseArgs(["--help"]).unknown).toStrictEqual([]);
  });
});

describe(renderFindings, () => {
  it("prints each finding's path and message", () => {
    const line = stripAnsi(
      renderFindings([
        { message: 'names "api"', module: "billing", where: "/dependsOn/0" },
      ]).join("\n")
    );

    expect(line).toContain("/dependsOn/0");
    expect(line).toContain('names "api"');
  });
});

/** `runNew` with stdout captured, so the clack rail can be read back. */
async function runCommand(
  args: string[]
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  try {
    return { code: await runNew(args), out: lines.join("") };
  } finally {
    process.stdout.write = originalWrite;
  }
}

// Command-level behaviour. Every case runs non-interactively (vitest owns no TTY), which
// is the same path a CI run takes, so the flags carry what the prompts would have asked.
describe(runNew, () => {
  const ORIGINAL_CWD = process.cwd();
  let repo: string;

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "saasaloy-new-"));
    process.chdir(repo);
  });

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD);
    await rm(repo, { force: true, recursive: true });
  });

  it("scaffolds a descriptor, a files folder and a prefixed skill", async () => {
    const { code } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
    ]);

    expect(code).toBe(0);
    for (const path of [
      "registry-item.json",
      "files/.gitkeep",
      "skills/saasaloy-billing/SKILL.md",
    ]) {
      await expect(
        pathExists(join(repo, "modules", "billing", ...path.split("/")))
      ).resolves.toBeTruthy();
    }
  });

  it("writes a schema-valid descriptor", async () => {
    await runCommand(["module", "billing", "--type", "saasaloy:capability"]);

    const parsed = JSON.parse(
      await readFile(join(repo, "modules/billing/registry-item.json"), "utf-8")
    ) as unknown;

    const result = await validateRegistryItem(parsed);

    expect(result.errors).toStrictEqual([]);
  });

  // C10: the scaffold's whole promise. `doctor` is run here the same way the command runs
  // it in-process, with no hand edit in between.
  it("leaves a module that passes doctor with no findings", async () => {
    const { code, out } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
    ]);

    const reports = await checkTarget(
      await resolveDoctorTarget(join(repo, "modules", "billing"))
    );

    expect(reports.flatMap((report) => report.findings)).toStrictEqual([]);
    expect(code).toBe(0);
    expect(out).not.toContain("Doctor");
  });

  it("records the dependencies the author named", async () => {
    await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
      "--depends-on",
      "api, database",
    ]);

    const parsed = JSON.parse(
      await readFile(join(repo, "modules/billing/registry-item.json"), "utf-8")
    ) as { dependsOn: string[] };

    expect(parsed.dependsOn).toStrictEqual(["api", "database"]);
  });

  it("reports a doctor finding without pretending the scaffold failed", async () => {
    // `api` is in no registry here, so the dependency it names cannot resolve.
    const { code, out } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
      "--depends-on",
      "api",
    ]);

    expect(code).toBe(0);
    expect(out).toContain("/dependsOn/0");
    await expect(
      pathExists(join(repo, "modules/billing/registry-item.json"))
    ).resolves.toBeTruthy();
  });

  // C9: the guard that keeps a registry scaffold out of a consumer's repo.
  it("refuses inside a generated project and writes nothing", async () => {
    await writeFile(join(repo, "saasaloy.json"), "{}\n", "utf-8");

    const { code, out } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
    ]);

    expect(code).toBe(2);
    expect(out).toContain("saasaloy.json");
    await expect(pathExists(join(repo, "modules"))).resolves.toBeFalsy();
  });

  it("refuses when a saasaloy.json sits in an ancestor directory", async () => {
    await writeFile(join(repo, "saasaloy.json"), "{}\n", "utf-8");
    const nested = join(repo, "packages", "thing");
    await mkdir(nested, { recursive: true });
    process.chdir(nested);

    const { code } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
    ]);

    expect(code).toBe(2);
    await expect(pathExists(join(nested, "modules"))).resolves.toBeFalsy();
  });

  it("refuses to merge into a module folder that already exists", async () => {
    await mkdir(join(repo, "modules", "billing"), { recursive: true });

    const { code, out } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
    ]);

    expect(code).toBe(2);
    expect(out).toContain("already exists");
    await expect(
      pathExists(join(repo, "modules/billing/registry-item.json"))
    ).resolves.toBeFalsy();
  });

  it("refuses a name the schema's pattern would reject", async () => {
    const { code, out } = await runCommand([
      "module",
      "Billing",
      "--type",
      "saasaloy:feature",
    ]);

    expect(code).toBe(2);
    expect(out).toContain("Billing");
    await expect(pathExists(join(repo, "modules"))).resolves.toBeFalsy();
  });

  it("refuses a noun it does not know, naming the ones it does", async () => {
    const { code, out } = await runCommand(["provider", "billing"]);

    expect(code).toBe(2);
    expect(out).toContain("module");
  });

  it("refuses a tier that is not one of the two", async () => {
    const { code, out } = await runCommand([
      "module",
      "billing",
      "--type",
      "feature",
    ]);

    expect(code).toBe(2);
    expect(out).toContain("saasaloy:feature");
    await expect(pathExists(join(repo, "modules"))).resolves.toBeFalsy();
  });

  it("refuses rather than hanging when there is no terminal to ask for the tier", async () => {
    const { code, out } = await runCommand(["module", "billing"]);

    expect(code).toBe(2);
    expect(out).toContain("--type");
  });

  it("refuses rather than hanging when there is no terminal to ask for the name", async () => {
    const { code, out } = await runCommand([
      "module",
      "--type",
      "saasaloy:feature",
    ]);

    expect(code).toBe(2);
    expect(out).toContain(USAGE_LINE);
  });

  it("reports an unknown flag rather than scaffolding anyway", async () => {
    const { code, out } = await runCommand([
      "module",
      "billing",
      "--type",
      "saasaloy:feature",
      "--force",
    ]);

    expect(code).toBe(2);
    expect(out).toContain("--force");
    await expect(pathExists(join(repo, "modules"))).resolves.toBeFalsy();
  });

  it("answers --help without writing anything", async () => {
    const { code } = await runCommand(["--help"]);

    expect(code).toBe(0);
    await expect(pathExists(join(repo, "modules"))).resolves.toBeFalsy();
  });
});
