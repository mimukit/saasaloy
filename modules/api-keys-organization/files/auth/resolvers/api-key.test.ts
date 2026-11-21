import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";

const modules = new Map([
  ["@repo/db/tenant", "export const asTenantId = (value) => value;"],
  [
    "hono/http-exception",
    "export class HTTPException extends Error { constructor(status, {message}) { super(message); this.status = status; } }",
  ],
  [
    "../auth",
    "export const auth = { api: {}, $context: { internalAdapter: {} } };",
  ],
  ["../db-provider", "export const withAuthScope = (_, run) => run();"],
  [
    "../tenant-rules",
    "export const ORGANIZATION_HEADER = 'x-organization-id'; export const headerDenial = () => ({ status: 403, message: 'organization header forbidden' });",
  ],
]);
const resolverUrl = new URL("api-key.ts", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = modules.get(specifier);
    if (
      stub &&
      (context.parentURL === resolverUrl ||
        context.parentURL === import.meta.url)
    ) {
      return {
        url: `data:text/javascript,${encodeURIComponent(stub)}`,
        shortCircuit: true,
      };
    }
    const shared = new Map([
      [
        "./api-key-owner",
        new URL(
          "../../../../api-keys/files/auth/api-key-owner.ts",
          import.meta.url
        ).href,
      ],
      [
        "./plugins/api-key-options",
        new URL(
          "../../../../api-keys/files/auth/plugins/api-key-options.ts",
          import.meta.url
        ).href,
      ],
      [
        "../plugins/api-key-options",
        new URL(
          "../../../../api-keys/files/auth/plugins/api-key-options.ts",
          import.meta.url
        ).href,
      ],
    ]);
    return nextResolve(shared.get(specifier) ?? specifier, context);
  },
});

const { auth } = await import("../auth");
const { apiKeyTenant } = await import("./api-key.ts");
hooks.deregister();

test("the bearer resolver checks the creator's current ban on every request", async () => {
  const c = {
    req: {
      raw: new Request("https://example.test/projects", {
        headers: { authorization: "Bearer sk_example" },
      }),
    },
  } as Parameters<ReturnType<typeof apiKeyTenant>["resolve"]>[0];
  const key = {
    id: "key",
    referenceId: "org",
    metadata: { saasaloyCreatorId: "creator" },
  };
  const creator = { banned: false, banExpires: null as Date | null };
  const fake = auth as unknown as {
    api: { verifyApiKey: () => Promise<unknown> };
    $context: {
      internalAdapter: { findUserById: (id: string) => Promise<unknown> };
    };
  };
  fake.api.verifyApiKey = async () => ({ valid: true, key });
  fake.$context.internalAdapter.findUserById = async (id) => {
    assert.equal(id, "creator");
    return creator;
  };

  const resolver = apiKeyTenant();
  assert.equal((await resolver.resolve(c)).organizationId, "org");
  creator.banned = true;
  await assert.rejects(resolver.resolve(c), {
    status: 401,
    message: "invalid api key",
  });
  creator.banExpires = new Date(0);
  assert.equal((await resolver.resolve(c)).organizationId, "org");

  fake.api.verifyApiKey = async () => ({
    valid: true,
    key: { ...key, metadata: null },
  });
  fake.$context.internalAdapter.findUserById = async () => {
    throw new Error("A legacy key has no creator to look up");
  };
  assert.equal((await resolver.resolve(c)).organizationId, "org");
});
