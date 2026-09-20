import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defineConfig,
  defineSection,
  defineSections,
} from "../packages/cli/templates/base/packages/config/src/define.ts";

// The merge rules `@repo/config` has to keep, and the two it has to refuse (#154).
//
// The code under test is template payload, not a workspace of this repo: it ships inside
// the CLI and runs in a scaffolded project, which declares no test runner of its own. So
// the guard lives here, beside `table-names.test.ts`, and runs on `pnpm test:scripts`. The
// import carries its `.ts` extension because this file is Node's to run; the payload
// itself imports extensionless, the way every consumer's bundler expects.

const app = () =>
  defineSection("app", {
    name: "Acme",
    locale: "en",
    legal: { termsPath: "/terms", privacyPath: "/privacy" },
    tags: ["one", "two"],
  });

const plans = () => defineSection("plans", { tiers: { free: { id: "free" } } });

test("composes one property per section key", () => {
  const config = defineConfig({
    sections: defineSections({ sections: [app(), plans()] }),
  });
  assert.equal(config.app.name, "Acme");
  assert.deepEqual(config.plans.tiers, { free: { id: "free" } });
});

test("an override replaces a leaf and keeps its siblings", () => {
  const config = defineConfig({
    sections: defineSections({ sections: [app()] }),
    overrides: { app: { name: "Ledgerly" } },
  });
  assert.equal(config.app.name, "Ledgerly");
  assert.equal(config.app.locale, "en");
});

test("an override replaces a nested record whole", () => {
  const config = defineConfig({
    sections: defineSections({ sections: [app()] }),
    overrides: {
      app: { legal: { termsPath: "/legal", privacyPath: "/legal/privacy" } },
    },
  });
  assert.deepEqual(config.app.legal, {
    termsPath: "/legal",
    privacyPath: "/legal/privacy",
  });
});

test("an override replaces an array whole", () => {
  const config = defineConfig({
    sections: defineSections({ sections: [app()] }),
    overrides: { app: { tags: ["three"] } },
  });
  assert.deepEqual(config.app.tags, ["three"]);
});

test("an explicit undefined keeps the seeded value", () => {
  const config = defineConfig({
    sections: defineSections({ sections: [app()] }),
    overrides: { app: { name: undefined } },
  });
  assert.equal(config.app.name, "Acme");
});

test("the result and every section are frozen", () => {
  const config = defineConfig({
    sections: defineSections({ sections: [app()] }),
  });
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.app));
  assert.throws(() => {
    (config.app as { name: string }).name = "nope";
  });
});

test("a section never mutates the values it was declared with", () => {
  const section = app();
  defineConfig({
    sections: defineSections({ sections: [section] }),
    overrides: { app: { name: "Ledgerly" } },
  });
  assert.equal(section.values.name, "Acme");
});

test("two sections claiming one key throw, naming the key", () => {
  assert.throws(
    () =>
      defineConfig({
        sections: defineSections({
          sections: [app(), defineSection("app", { name: "Other" })],
        }),
      }),
    /claim the key "app"/
  );
});

test("an override of a section nothing defines throws", () => {
  assert.throws(
    () =>
      defineConfig({
        sections: defineSections({ sections: [app()] }),
        // Only reachable by hand-editing: `ProjectOverride` rejects this at typecheck.
        overrides: { billing: { appName: "Acme" } } as never,
      }),
    /overrides the section "billing"/
  );
});
