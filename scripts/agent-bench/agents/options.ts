// Shared model and effort options for the built-in benchmark adapters.

export function agentOptions(args: string[]): {
  model: string | undefined;
  effort: string;
  extra: string[];
} {
  let model: string | undefined;
  let effort = "medium";
  const extra: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    const [flag, inline] = arg.split(/[=](.*)/s);
    if (flag !== "--model" && flag !== "-m" && flag !== "--effort") {
      extra.push(arg);
      continue;
    }
    const value = inline ?? args[++index];
    if (!value || value.startsWith("-")) {
      throw new Error(`${flag} needs a value`);
    }
    if (flag === "--effort") {
      effort = value;
    } else {
      model = value;
    }
  }
  return { model, effort, extra };
}

/** The newest versioned Sol model in the logged-in user's Codex model list. */
export function latestSol(cache: unknown): string {
  const models =
    typeof cache === "object" && cache !== null && "models" in cache
      ? cache.models
      : undefined;
  const candidates = (Array.isArray(models) ? models : []).flatMap(
    (model: unknown) => {
      const slug =
        typeof model === "object" && model !== null && "slug" in model
          ? model.slug
          : undefined;
      const version =
        typeof slug === "string"
          ? /^gpt-(\d+)(?:\.(\d+))?-sol$/.exec(slug)
          : null;
      return version
        ? [
            {
              slug: version[0],
              major: Number(version[1]),
              minor: Number(version[2] ?? 0),
            },
          ]
        : [];
    }
  );
  candidates.sort((a, b) => b.major - a.major || b.minor - a.minor);
  const model = candidates[0]?.slug;
  if (!model) {
    throw new Error(
      "No Sol model is listed in the Codex model cache; pass --model explicitly."
    );
  }
  return model;
}
