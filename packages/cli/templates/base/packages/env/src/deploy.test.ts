import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  checkProduction,
  childEnv,
  deployService,
  parseArgs,
  parseJsonc,
  readWorkerConfig,
  runWithProduction,
  secretsFor,
} from "./deploy.ts";
import type { LoginCheck, Runner } from "./deploy.ts";
import { SERVICES } from "./services.ts";
import { local } from "./sources.ts";

// Every file lands in a temp directory, and the runner is a fake. Nothing here builds,
// deploys or reaches Cloudflare.

// The base seeds `web` and `deploy`; `saasaloy add api` appends this row.
if (!SERVICES.some((row) => row.name === "api")) {
  SERVICES.push({
    name: "api",
    file: "apps/api/.env",
    environment: "dev",
    omit: [],
  });
}

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

const EXAMPLE = [
  "# @services web",
  "PUBLIC_SITE_URL=http://localhost:3000",
  "# Blank on purpose: no analytics.",
  "PUBLIC_ANALYTICS_ID=",
  "# @services api",
  "SECRET=",
  "PLAIN=",
  "# @services deploy",
  "# Blank on purpose: wrangler login.",
  "CLOUDFLARE_API_TOKEN=",
  "# Blank on purpose: the one account.",
  "CLOUDFLARE_ACCOUNT_ID=",
  "",
].join("\n");

const PROD = [
  "PUBLIC_SITE_URL=https://example.com",
  "SECRET=s3cret",
  "PLAIN=plain",
  "CLOUDFLARE_API_TOKEN=token",
  "CLOUDFLARE_ACCOUNT_ID=account",
  "",
].join("\n");

/** A project root with the key list, the production values and an `apps/api` Worker. */
function makeRoot(prod: string | null = PROD): string {
  const root = mkdtempSync(path.join(tmpdir(), "env-deploy-"));
  roots.push(root);
  mkdirSync(path.join(root, "packages/env"), { recursive: true });
  writeFileSync(path.join(root, "packages/env/.env.example"), EXAMPLE);
  writeFileSync(path.join(root, "packages/env/.env"), "SECRET=dev\n");
  if (prod !== null) {
    writeFileSync(path.join(root, "packages/env/.env.prod"), prod);
  }
  mkdirSync(path.join(root, "apps/api"), { recursive: true });
  writeFileSync(
    path.join(root, "apps/api/wrangler.jsonc"),
    '{\n  // the api\n  "name": "api",\n  "main": "src/worker.ts",\n  "vars": { "PLAIN": "plain" },\n}\n'
  );
  mkdirSync(path.join(root, "apps/web"), { recursive: true });
  writeFileSync(
    path.join(root, "apps/web/wrangler.jsonc"),
    '{ "name": "web", "assets": { "directory": "./dist" } }\n'
  );
  return root;
}

interface Call {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  /** The secrets file's contents while the command ran, when it named one. */
  secrets?: string;
  /** The file's permission bits in octal, such as `600`. */
  secretsMode?: string;
}

/** A runner that records each call, and fails the one `failOn` names. */
function fakeRunner(failOn?: string): { run: Runner; calls: Call[] } {
  const calls: Call[] = [];
  const run: Runner = async (command, args, { env }) => {
    const index = args.indexOf("--secrets-file");
    const file = index === -1 ? undefined : args[index + 1];
    calls.push({
      command,
      args,
      env,
      secrets: file === undefined ? undefined : readFileSync(file, "utf-8"),
      secretsMode:
        file === undefined
          ? undefined
          : statSync(file).mode.toString(8).slice(-3),
    });
    return await Promise.resolve(command === failOn ? 1 : 0);
  };
  return { run, calls };
}

const loggedOut: LoginCheck = () => false;
const loggedIn: LoginCheck = () => true;

function secretsPath(call: Call | undefined): string | undefined {
  const index = call?.args.indexOf("--secrets-file") ?? -1;
  return index === -1 ? undefined : call?.args[index + 1];
}

describe("secretsFor", () => {
  const values = new Map([
    ["SECRET", "s3cret"],
    ["PLAIN", "plain"],
    ["CLOUDFLARE_API_TOKEN", "token"],
    ["EMPTY", ""],
  ]);

  it("drops the credentials, the keys in vars and an empty value", () => {
    assert.deepEqual(
      secretsFor(values, { main: "src/worker.ts", vars: { PLAIN: "plain" } }),
      { SECRET: "s3cret" }
    );
  });

  it("gives an assets-only Worker no secrets", () => {
    assert.deepEqual(secretsFor(values, { vars: {} }), {});
  });
});

describe("childEnv", () => {
  it("lets an exported variable win over the value source", () => {
    const merged = childEnv(new Map([["A", "source"]]), {
      A: "shell",
      B: "shell",
    });
    assert.deepEqual(merged, { A: "shell", B: "shell" });
  });

  it("keeps a blank credential out, so wrangler falls back to its login", () => {
    const merged = childEnv(
      new Map([
        ["CLOUDFLARE_API_TOKEN", ""],
        ["PUBLIC_EMPTY", ""],
      ]),
      {}
    );
    assert.deepEqual(merged, { PUBLIC_EMPTY: "" });
  });
});

describe("parseJsonc", () => {
  it("strips comments and trailing commas outside strings", () => {
    assert.deepEqual(
      parseJsonc(
        '{\n  // note\n  "a": "http://x", /* b */\n  "c": [1, 2,],\n}\n'
      ),
      { a: "http://x", c: [1, 2] }
    );
  });
});

describe("readWorkerConfig", () => {
  it("follows the build's redirect to the config wrangler deploys", () => {
    const root = makeRoot();
    const web = path.join(root, "apps/web");
    mkdirSync(path.join(web, ".wrangler/deploy"), { recursive: true });
    mkdirSync(path.join(web, "dist/server"), { recursive: true });
    writeFileSync(
      path.join(web, ".wrangler/deploy/config.json"),
      '{ "configPath": "../../dist/server/wrangler.json" }'
    );
    writeFileSync(
      path.join(web, "dist/server/wrangler.json"),
      '{ "name": "web", "main": "entry.mjs" }'
    );
    assert.equal(readWorkerConfig(web).main, "entry.mjs");
  });
});

describe("parseArgs", () => {
  it("reads the three forms", () => {
    assert.deepEqual(parseArgs(["--check"]), { kind: "check" });
    assert.deepEqual(parseArgs(["api"]), {
      kind: "deploy",
      service: "api",
      wranglerArgs: [],
    });
    assert.deepEqual(parseArgs(["api", "--", "--dry-run"]), {
      kind: "deploy",
      service: "api",
      wranglerArgs: ["--dry-run"],
    });
    assert.deepEqual(parseArgs(["--run", "deploy", "--", "node", "x.ts"]), {
      kind: "run",
      service: "deploy",
      command: "node",
      args: ["x.ts"],
    });
  });

  it("refuses anything else", () => {
    assert.throws(() => parseArgs([]), /Usage: env-deploy/);
    assert.throws(() => parseArgs(["--run", "deploy"]), /Usage: env-deploy/);
    assert.throws(() => parseArgs(["api", "--dry-run"]), /Usage: env-deploy/);
  });
});

describe("checkProduction", () => {
  it("passes when every service has its production values", async () => {
    const problems = await checkProduction({
      root: makeRoot(),
      source: local,
      processEnv: {},
      loggedIn: loggedOut,
    });
    assert.deepEqual(problems, []);
  });

  it("names each blank key across every service", async () => {
    const problems = await checkProduction({
      root: makeRoot("CLOUDFLARE_API_TOKEN=token\nPLAIN=plain\n"),
      source: local,
      processEnv: {},
      loggedIn: loggedOut,
    });
    assert.deepEqual(problems, [
      "web has no production value for PUBLIC_SITE_URL.",
      "api has no production value for SECRET.",
    ]);
  });

  it("takes a value the shell exports", async () => {
    const problems = await checkProduction({
      root: makeRoot("CLOUDFLARE_API_TOKEN=token\nPLAIN=plain\n"),
      source: local,
      processEnv: { PUBLIC_SITE_URL: "https://example.com", SECRET: "x" },
      loggedIn: loggedOut,
    });
    assert.deepEqual(problems, []);
  });

  it("stops on a blank token with no wrangler login", async () => {
    const prod = PROD.replace("CLOUDFLARE_API_TOKEN=token", "");
    const root = makeRoot(prod);
    const problems = await checkProduction({
      root,
      source: local,
      processEnv: {},
      loggedIn: loggedOut,
    });
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? "", /CLOUDFLARE_API_TOKEN has no value/);
    assert.deepEqual(
      await checkProduction({
        root,
        source: local,
        processEnv: {},
        loggedIn,
      }),
      []
    );
  });

  it("never reads the dev values", async () => {
    await assert.rejects(
      checkProduction({
        root: makeRoot(null),
        source: local,
        processEnv: {},
        loggedIn,
      }),
      /packages\/env\/\.env\.prod does not exist/
    );
  });
});

describe("deployService", () => {
  it("builds with the production values, then deploys with a secrets file", async () => {
    const root = makeRoot();
    const { run, calls } = fakeRunner();
    await deployService({
      root,
      name: "api",
      cwd: path.join(root, "apps/api"),
      source: local,
      processEnv: { PATH: "/bin" },
      run,
      loggedIn: loggedOut,
    });

    const [build, deploy] = calls;
    assert.deepEqual([build?.command, build?.args], ["pnpm", ["run", "build"]]);
    assert.equal(build?.env.SECRET, "s3cret");
    assert.equal(build?.env.CLOUDFLARE_API_TOKEN, "token");
    assert.equal(build?.env.PATH, "/bin");
    assert.equal(build?.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, "false");
    assert.equal(deploy?.command, "wrangler");
    assert.equal(deploy?.args[0], "deploy");
    assert.deepEqual(JSON.parse(deploy?.secrets ?? ""), { SECRET: "s3cret" });
    assert.equal(deploy?.secretsMode, "600");
    assert.equal(existsSync(secretsPath(deploy) ?? ""), false);
  });

  it("deletes the secrets file when the deploy fails", async () => {
    const root = makeRoot();
    const { run, calls } = fakeRunner("wrangler");
    await assert.rejects(
      deployService({
        root,
        name: "api",
        cwd: path.join(root, "apps/api"),
        source: local,
        processEnv: {},
        run,
        loggedIn: loggedOut,
      }),
      /wrangler deploy failed for api/
    );
    const file = secretsPath(calls[1]);
    assert.ok(file !== undefined);
    assert.equal(existsSync(file), false);
  });

  it("sets a key the source leaves out to empty, so no dev .env fills it", async () => {
    const root = makeRoot();
    const { run, calls } = fakeRunner();
    await deployService({
      root,
      name: "web",
      cwd: path.join(root, "apps/web"),
      source: local,
      processEnv: {},
      run,
      loggedIn: loggedOut,
    });
    assert.equal(calls[0]?.env.PUBLIC_ANALYTICS_ID, "");
  });

  it("sends an assets-only Worker no secrets file", async () => {
    const root = makeRoot();
    const { run, calls } = fakeRunner();
    await deployService({
      root,
      name: "web",
      cwd: path.join(root, "apps/web"),
      source: local,
      processEnv: {},
      run,
      loggedIn: loggedOut,
      wranglerArgs: ["--dry-run"],
    });
    assert.equal(calls[0]?.env.PUBLIC_SITE_URL, "https://example.com");
    assert.deepEqual(calls[1]?.args, ["deploy", "--dry-run"]);
  });

  it("builds nothing when a key is blank", async () => {
    const root = makeRoot(PROD.replace("SECRET=s3cret", "SECRET="));
    const { run, calls } = fakeRunner();
    await assert.rejects(
      deployService({
        root,
        name: "api",
        cwd: path.join(root, "apps/api"),
        source: local,
        processEnv: {},
        run,
        loggedIn: loggedOut,
      }),
      /api has no production value for SECRET/
    );
    assert.deepEqual(calls, []);
  });

  it("deploys nothing when the build fails", async () => {
    const root = makeRoot();
    const { run, calls } = fakeRunner("pnpm");
    await assert.rejects(
      deployService({
        root,
        name: "api",
        cwd: path.join(root, "apps/api"),
        source: local,
        processEnv: {},
        run,
        loggedIn: loggedOut,
      }),
      /The api build failed/
    );
    assert.equal(calls.length, 1);
  });
});

describe("runWithProduction", () => {
  it("runs the command with the deploy credentials", async () => {
    const root = makeRoot();
    const { run, calls } = fakeRunner();
    const code = await runWithProduction({
      root,
      name: "deploy",
      cwd: root,
      source: local,
      processEnv: {},
      run,
      loggedIn: loggedOut,
      command: "node",
      args: ["scripts/migrate-prod.ts"],
    });
    assert.equal(code, 0);
    assert.equal(calls[0]?.env.CLOUDFLARE_ACCOUNT_ID, "account");
    assert.equal(calls[0]?.env.SECRET, undefined);
  });
});
