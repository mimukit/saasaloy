// Tests for the vendor-blind core: provider selection, the four-step model id lookup and
// the wrap of a failed normalizer. This file is not in the descriptor's scaffold list, so
// `add ai` never copies it into a project. It runs on `node:test` via `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { config } from "@repo/config";
import { defineAi, featureModelKey } from "./define.ts";
import { AiError } from "./provider.ts";
import type { AiEnv, AiProvider } from "./provider.ts";

/** A provider whose model only records the id it was built for. */
function fake(overrides: Partial<AiProvider> = {}): AiProvider {
  return {
    languageModel(_env: AiEnv, modelId: string): LanguageModelV4 {
      return { modelId } as unknown as LanguageModelV4;
    },
    name: "fake",
    normalizeError(error: unknown): AiError {
      return new AiError("rate_limited", "slow down", {
        cause: error,
        retryable: true,
        status: 429,
      });
    },
    ...overrides,
  };
}

const MODELS = { copilot: "config/copilot" };

function client(env: AiEnv, provider: AiProvider = fake()) {
  return defineAi({
    defaultModel: "config/default",
    models: MODELS,
    providers: [provider],
  }).create(env);
}

describe("provider selection", () => {
  it("throws when AI_PROVIDER is unset, and names the registered providers", () => {
    assert.throws(() => client({}), /AI_PROVIDER is not set\. .*fake/);
  });

  it("throws when AI_PROVIDER names a provider that is not registered", () => {
    assert.throws(
      () => client({ AI_PROVIDER: "openai" }),
      /AI_PROVIDER is "openai", which is not registered/
    );
  });

  it("selects the named provider", () => {
    assert.equal(client({ AI_PROVIDER: "fake" }).provider, "fake");
  });
});

describe("model(feature)", () => {
  const all: AiEnv = {
    AI_MODEL: "env/all",
    AI_PROVIDER: "fake",
    COPILOT_MODEL: "env/copilot",
  };

  function idOf(env: AiEnv, feature = "copilot"): string {
    const model = client(env).model(feature) as unknown as { modelId: string };
    return model.modelId;
  }

  it("takes the feature's own env key first", () => {
    assert.equal(idOf(all), "env/copilot");
  });

  it("takes config.ai.models next", () => {
    assert.equal(idOf({ ...all, COPILOT_MODEL: "" }), "config/copilot");
  });

  it("takes AI_MODEL next", () => {
    assert.equal(idOf(all, "search"), "env/all");
  });

  it("takes config.ai.defaultModel last", () => {
    assert.equal(idOf({ AI_PROVIDER: "fake" }, "search"), "config/default");
  });

  it("throws not_configured when no id resolves", () => {
    const empty = defineAi({
      defaultModel: "",
      models: {},
      providers: [fake()],
    }).create({ AI_PROVIDER: "fake" });
    assert.throws(
      () => empty.model("copilot"),
      (error: unknown) =>
        error instanceof AiError &&
        error.code === "not_configured" &&
        error.message.includes("COPILOT_MODEL")
    );
  });

  it("reads the shipped config section when the registry sets none", () => {
    const shipped = defineAi({ providers: [fake()] }).create({
      AI_PROVIDER: "fake",
    });
    assert.equal(shipped.modelId("search"), config.ai.defaultModel);
    assert.match(config.ai.defaultModel, /^[a-z]+\/[\w.-]+$/);
  });

  it("does not read an inherited key as a feature's model", () => {
    assert.equal(idOf({ AI_PROVIDER: "fake" }, "toString"), "config/default");
  });
});

describe("featureModelKey", () => {
  it("upper-snake-cases the feature name", () => {
    assert.equal(featureModelKey("copilot"), "COPILOT_MODEL");
    assert.equal(featureModelKey("supportChat"), "SUPPORT_CHAT_MODEL");
    assert.equal(featureModelKey("support-chat"), "SUPPORT_CHAT_MODEL");
  });

  it("refuses a name that cannot be an env key", () => {
    assert.throws(() => featureModelKey("1st"), /must start with a letter/);
    assert.throws(() => featureModelKey("a b"), /must start with a letter/);
  });
});

describe("normalizeError", () => {
  it("returns the provider's AiError", () => {
    const error = client({ AI_PROVIDER: "fake" }).normalizeError(
      new Error("429")
    );
    assert.equal(error.code, "rate_limited");
    assert.equal(error.retryable, true);
    assert.equal(error.status, 429);
  });

  it("passes an AiError through without asking the provider", () => {
    const original = new AiError("not_configured", "no model");
    const provider = fake({
      normalizeError() {
        throw new Error("must not run");
      },
    });
    assert.equal(
      client({ AI_PROVIDER: "fake" }, provider).normalizeError(original),
      original
    );
  });

  it("gives unknown when the provider's normalizer throws", () => {
    const original = new Error("socket hang up");
    const provider = fake({
      normalizeError() {
        throw new TypeError("cannot read status");
      },
    });
    const error = client({ AI_PROVIDER: "fake" }, provider).normalizeError(
      original
    );
    assert.ok(error instanceof AiError);
    assert.equal(error.code, "unknown");
    assert.equal(error.retryable, false);
    assert.equal(error.cause, original);
  });

  it("gives unknown when the provider's normalizer returns something else", () => {
    const original = new Error("boom");
    const provider = fake({
      normalizeError: () => ({ code: "auth" }) as unknown as AiError,
    });
    const error = client({ AI_PROVIDER: "fake" }, provider).normalizeError(
      original
    );
    assert.equal(error.code, "unknown");
    assert.equal(error.cause, original);
  });
});
