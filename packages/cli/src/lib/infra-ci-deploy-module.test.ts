import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateRegistryItem } from "./schema.js";

// `infra-ci-deploy` ships one file, a GitHub Actions workflow, and GitHub reads workflows
// only from the repository root. So the descriptor's one target has to go through `@root`,
// and the workflow has to keep the three things issue #199 asks of it: the push trigger on
// main, the `pnpm deploy:production` step, and every credential from a repository secret.
// The module skill lists those secrets, so a secret the workflow reads and the skill
// leaves out fails here too.

const repoRoot = new URL("../../../../", import.meta.url);

function repoFile(path: string): string {
  return fileURLToPath(new URL(path, repoRoot));
}

const MODULE = "modules/infra-ci-deploy";

interface Descriptor {
  name: string;
  type: string;
  dependsOn: string[];
  envVars: Record<string, string>;
  files: { path: string; target: string }[];
  scaffolds: { workspace: string; aliases: Record<string, string> }[];
  agent: { skills: string[] };
}

async function readDescriptor(): Promise<Descriptor> {
  return JSON.parse(
    await readFile(repoFile(`${MODULE}/registry-item.json`), "utf-8")
  ) as Descriptor;
}

function readWorkflow(): Promise<string> {
  return readFile(repoFile(`${MODULE}/files/workflows/deploy.yml`), "utf-8");
}

/** Every `secrets.<NAME>` the workflow reads. */
function secretsRead(workflow: string): string[] {
  const names = [...workflow.matchAll(/\$\{\{\s*secrets\.(\w+)\s*\}\}/g)].map(
    (match) => match[1] ?? ""
  );
  return [...new Set(names)].toSorted();
}

describe("infra-ci-deploy module", () => {
  it("writes one workflow at the repository root through @root", async () => {
    const descriptor = await readDescriptor();

    await expect(
      validateRegistryItem(descriptor as unknown as Record<string, unknown>)
    ).resolves.toMatchObject({ valid: true });
    expect(descriptor.name).toBe("infra-ci-deploy");
    expect(descriptor.type).toBe("saasaloy:feature");
    // The base owns `pnpm deploy:production`, so the module needs no capability.
    expect(descriptor.dependsOn).toStrictEqual([]);
    // The credentials are repository secrets, not project keys.
    expect(descriptor.envVars).toStrictEqual({});
    expect(descriptor.files).toStrictEqual([
      {
        path: "files/workflows/deploy.yml",
        target: "@root/.github/workflows/deploy.yml",
      },
    ]);
    expect(descriptor.scaffolds).toStrictEqual([
      { workspace: ".", aliases: { "@root": "." }, files: [] },
    ]);
    expect(descriptor.agent.skills).toStrictEqual([
      "skills/saasaloy-infra-ci-deploy",
    ]);
  });

  it("runs pnpm deploy:production on a push to main", async () => {
    const workflow = await readWorkflow();

    expect(workflow).toMatch(/^on:\n {2}push:\n {4}branches: \[main\]$/m);
    expect(workflow).toMatch(/^ {8}run: pnpm deploy:production\b/m);
    // The deploy reads the last deploy tag and pushes the next one.
    expect(workflow).toMatch(/^ {10}fetch-depth: 0$/m);
    expect(workflow).toMatch(/^ {2}contents: write$/m);
  });

  it("takes every credential from a repository secret", async () => {
    expect(secretsRead(await readWorkflow())).toStrictEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_TOKEN",
      "ENV_PROD",
      "ENV_SOURCE",
      "INFISICAL_CLIENT_ID",
      "INFISICAL_CLIENT_SECRET",
    ]);
  });

  it("lists every secret the workflow reads in the module skill", async () => {
    const skill = await readFile(
      repoFile(`${MODULE}/skills/saasaloy-infra-ci-deploy/SKILL.md`),
      "utf-8"
    );

    for (const name of secretsRead(await readWorkflow())) {
      expect(skill).toContain(`| \`${name}\` |`);
    }
  });
});
