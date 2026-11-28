import type { LanguageModelV4 } from "@ai-sdk/provider";
import { config as projectConfig } from "@repo/config";
import { AiError } from "./provider";
import type { AiEnv, AiProvider } from "./provider";

export interface AiConfig {
  providers: AiProvider[];
  /** The last model id `model()` falls back to. Defaults to `config.ai.defaultModel`. */
  defaultModel?: string;
  /** A model id per feature. Defaults to `config.ai.models`. */
  models?: Readonly<Record<string, string>>;
}

/** What a caller asks for models with. Returned by `createAi(env)`. */
export interface AiClient {
  /** The selected provider's name, for a log line. */
  provider: string;
  /** The model id `model(feature)` uses. Throws `AiError` `not_configured` when none resolves. */
  modelId(feature: string): string;
  /** The model for a feature, such as `model("copilot")`. */
  model(feature: string): LanguageModelV4;
  /** Any thrown value as `AiError`, through the selected provider's `normalizeError`. */
  normalizeError(error: unknown): AiError;
}

export interface AiRegistry {
  providers: AiProvider[];
  create(env: AiEnv): AiClient;
}

const FEATURE = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * The env key that sets one feature's model: `copilot` reads `COPILOT_MODEL`, and
 * `supportChat` or `support-chat` reads `SUPPORT_CHAT_MODEL`.
 */
export function featureModelKey(feature: string): string {
  if (!FEATURE.test(feature)) {
    throw new Error(
      `AI feature name ${JSON.stringify(feature)} must start with a letter and hold only ` +
        `letters, digits, "-" and "_": it becomes an env key.`
    );
  }
  const snake = feature
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replaceAll("-", "_")
    .toUpperCase();
  return `${snake}_MODEL`;
}

/**
 * Build the provider registry. `providers` holds the generated `ai.providers` table: every
 * `ai-<provider>` module adds a row. See `src/index.ts`.
 */
export function defineAi(config: AiConfig): AiRegistry {
  const { providers } = config;
  const defaultModel = config.defaultModel ?? projectConfig.ai.defaultModel;
  const models = config.models ?? projectConfig.ai.models;

  return {
    create(env: AiEnv): AiClient {
      const provider = selectProvider(providers, env.AI_PROVIDER);

      function modelId(feature: string): string {
        const key = featureModelKey(feature);
        const id =
          filled(env[key]) ??
          filled(
            Object.hasOwn(models, feature) ? models[feature] : undefined
          ) ??
          filled(env.AI_MODEL) ??
          filled(defaultModel);
        if (id === undefined) {
          throw new AiError(
            "not_configured",
            `No model id for the "${feature}" feature. Set ${key} or AI_MODEL, or set ` +
              `config.ai.models["${feature}"] or config.ai.defaultModel in ` +
              `packages/config/src/project.ts.`
          );
        }
        return id;
      }

      return {
        model(feature: string): LanguageModelV4 {
          return provider.languageModel(env, modelId(feature));
        },
        modelId,
        normalizeError(error: unknown): AiError {
          return normalize(provider, error);
        },
        provider: provider.name,
      };
    },
    providers,
  };
}

/** A non-blank string, or `undefined`: an env file writes an unset key as `""`. */
function filled(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== ""
    ? value.trim()
    : undefined;
}

/**
 * `AI_PROVIDER` is required even with one provider installed, and an unknown value throws.
 * A fallback either way is worse: a deploy that quietly answers from the mock, or a test
 * run that quietly spends tokens on a real gateway.
 */
function selectProvider(
  providers: AiProvider[],
  selected: string | undefined
): AiProvider {
  const registered = providers.map((p) => p.name);
  const known =
    registered.length > 0
      ? `Registered providers: ${registered.join(", ")}.`
      : "No providers are registered. Install one, such as `saasaloy add ai-mock`.";

  if (!selected) {
    throw new Error(`AI_PROVIDER is not set. ${known}`);
  }

  const provider = providers.find((p) => p.name === selected);
  if (!provider) {
    throw new Error(
      `AI_PROVIDER is "${selected}", which is not registered. ${known}`
    );
  }
  return provider;
}

/**
 * A provider written in a project may not keep the contract, and a caller's `catch` must
 * still see one shape. A normalizer that throws or returns something else gives `unknown`
 * with the original error in `cause`.
 */
function normalize(provider: AiProvider, error: unknown): AiError {
  if (error instanceof AiError) {
    return error;
  }
  try {
    const normalized = provider.normalizeError(error);
    if (normalized instanceof AiError) {
      return normalized;
    }
  } catch {
    // The original error is the useful one, so the normalizer's own failure is dropped.
  }
  return new AiError("unknown", `${provider.name}: the model call failed`, {
    cause: error,
  });
}
