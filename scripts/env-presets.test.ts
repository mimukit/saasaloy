// Guards the one seam the `env` capability leaves open (#153): a module's `envVars` and
// the `definePreset` in the file it ships have to name the same keys.
//
// `envVars` is what `saasaloy add` writes into `packages/env/.env.example`, and the preset
// is what `createEnv` validates. A key in one and not the other is a silent half-failure:
// declared-but-not-validated means the gate never checks it, and validated-but-not-
// declared means the key list never carries it, so every `.env` is written without it and
// the Worker throws on the first request that needs it.
//
// It reads the files as text rather than importing them: a preset imports `@repo/env`,
// which resolves only inside a scaffolded project. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");

/**
 * The base template's own `createEnv` call. `waitlist` ships a form into `apps/web` and
 * declares `PUBLIC_API_URL`, but the key is already declared and validated there — Vite
 * inlines a literal `import.meta.env.PUBLIC_X` and nothing else, so a frontend key cannot
 * arrive through a preset a module patches in. A module whose keys the base already
 * covers ships no preset of its own, and that is correct rather than missing.
 */
const BASE_ENV = join(ROOT, "packages/cli/templates/base/apps/web/src/env.ts");

/** The services a `# @services` line and an `envServices` entry may name. */
const SERVICES = new Set(["api", "web", "admin", "infra"]);

interface Descriptor {
  envVars?: Record<string, string>;
  envServices?: Record<string, string[]>;
  envOptional?: string[];
}

/** Every preset file a module ships, wherever the descriptor puts it. */
function presetFiles(module: string): string[] {
  const candidates = [
    join(MODULES, module, "files", "src", "env-preset.ts"),
    join(MODULES, module, "files", "env.ts"),
    join(MODULES, module, "files", "src", "env.ts"),
  ];
  return candidates.filter((path) => existsSync(path));
}

/**
 * The keys a preset or a `createEnv` call declares.
 *
 * The shape is fixed by the repo's own convention — `server: { KEY: z…. }` — so a regex
 * over the `server`, `client` and `shared` blocks answers it without a parser. A key the
 * regex cannot see fails this test rather than passing it quietly, because the comparison
 * below is two-way.
 */
function declaredKeys(source: string): Set<string> {
  const keys = new Set<string>();
  for (const match of source.matchAll(/^\s{4}([A-Z][A-Z0-9_]*)\s*:\s*z\b/gm)) {
    if (match[1]) {
      keys.add(match[1]);
    }
  }
  return keys;
}

function modules(): string[] {
  return readdirSync(MODULES, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(MODULES, entry.name, "registry-item.json"))
    )
    .map((entry) => entry.name)
    .toSorted();
}

function descriptorOf(module: string): Descriptor {
  return JSON.parse(
    readFileSync(join(MODULES, module, "registry-item.json"), "utf-8")
  ) as Descriptor;
}

describe("env presets and descriptors agree", () => {
  for (const module of modules()) {
    const descriptor = descriptorOf(module);
    const declared = Object.keys(descriptor.envVars ?? {});
    const files = presetFiles(module);

    const coveredByBase = declaredKeys(readFileSync(BASE_ENV, "utf-8"));
    const mine = declared.filter((key) => !coveredByBase.has(key));

    if (declared.length === 0) {
      it(`${module} ships no preset, because it declares no env var`, () => {
        assert.deepEqual(
          files,
          [],
          `${module} has no envVars but ships ${files.join(", ")}.`
        );
      });
      continue;
    }

    it(`${module} ships a preset for its envVars`, () => {
      assert.ok(
        files.length > 0 || mine.length === 0,
        `${module} declares ${mine.join(", ")} in envVars but ships no env preset. Add one so createEnv validates them.`
      );
    });

    it(`${module}'s preset names exactly its envVars`, () => {
      if (files.length === 0) {
        return;
      }
      const inPreset = new Set(
        files.flatMap((file) => [...declaredKeys(readFileSync(file, "utf-8"))])
      );
      const missing = mine.filter((key) => !inPreset.has(key));
      const extra = [...inPreset].filter((key) => !declared.includes(key));

      assert.deepEqual(
        missing,
        [],
        `${module}'s preset does not declare ${missing.join(", ")}, which its envVars does.`
      );
      assert.deepEqual(
        extra,
        [],
        `${module}'s preset declares ${extra.join(", ")}, which its envVars does not, so the key list never carries them.`
      );
    });
  }
});

describe("every module that declares an env var routes it", () => {
  for (const module of modules()) {
    const descriptor = descriptorOf(module);
    const declared = Object.keys(descriptor.envVars ?? {});
    if (declared.length === 0) {
      continue;
    }

    it(`${module} declares envServices`, () => {
      assert.ok(
        descriptor.envServices,
        `${module} declares ${declared.join(", ")} with no envServices, so the PUBLIC_ prefix fallback decides which service reads each one.`
      );
    });

    it(`${module}'s envOptional names keys it declares`, () => {
      for (const key of descriptor.envOptional ?? []) {
        assert.ok(
          declared.includes(key),
          `${module}'s envOptional names ${key}, which its envVars does not.`
        );
      }
    });

    it(`${module}'s envServices names real keys and real services`, () => {
      for (const [key, services] of Object.entries(
        descriptor.envServices ?? {}
      )) {
        assert.ok(
          key === "default" || declared.includes(key),
          `${module}'s envServices names ${key}, which its envVars does not.`
        );
        for (const service of services) {
          assert.ok(
            SERVICES.has(service),
            `${module}'s envServices names ${service}, which is not a service.`
          );
        }
      }
    });
  }
});
