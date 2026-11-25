// The facts the `saasaloy-*` docs blocks show, built from the module descriptors and the
// agent prompts. Pure, and it imports only module-catalog.ts and content/prompts.ts, so the
// remark plugin (which runs in Node at build time), the React islands (which run in the
// browser) and `node --test` all load it. The plugin serialises one `GraphData`,
// `ProvidersData` or `CommandData` into the block's markup, and the island reads it back,
// so the two never read the registry on their own.

import { agentPrompt, isPromptTask, prompts } from "../content/prompts.ts";
import type { AgentPrompt } from "../content/prompts.ts";
import { catalogRows } from "./module-catalog.ts";
import type { CatalogVariant, RegistryDescriptor } from "./module-catalog.ts";

/** The part of a descriptor the blocks read, on top of what the catalog reads. */
export interface BlockDescriptor extends RegistryDescriptor {
  envVars?: Record<string, string>;
}

/** One tile of the catalog and its neighbours. */
export interface GraphModule {
  name: string;
  tier: "capability" | "feature";
  description: string;
  /** The modules it depends on, in `dependsOn` order. */
  needs: string[];
  /** The modules that depend on it, by name. */
  usedBy: string[];
  /** Its providers and drivers. */
  variants: CatalogVariant[];
}

export interface GraphData {
  /** Every tile, in catalog order. */
  modules: GraphModule[];
  /** The module the block opens on. */
  selected: string;
}

export interface ProviderOption {
  name: string;
  /** The value of the selector variable that picks this provider. */
  value: string;
  description: string;
}

export interface ProvidersData {
  capability: string;
  description: string;
  /** The env var that picks one provider at runtime, such as `EMAIL_PROVIDER`. */
  selector: string;
  /**
   * True when the selector takes a comma list in priority order (`PAYMENT_PROVIDER`), as its
   * `envVars` description says, rather than one name.
   */
  list: boolean;
  providers: ProviderOption[];
}

/** Every module of the graph and the module the block opens on. Throws on an unknown focus. */
export function graphData(
  descriptors: readonly BlockDescriptor[],
  focus?: string
): GraphData {
  const rows = catalogRows([...descriptors]);
  const modules: GraphModule[] = rows.map((row) => ({
    name: row.name,
    tier: row.tier,
    description: row.description,
    needs: row.needs,
    usedBy: rows
      .filter((other) => other.needs.includes(row.name))
      .map((other) => other.name),
    variants: row.variants,
  }));
  const [first] = modules;
  if (!first) {
    throw new Error("saasaloy-graph: the registry holds no module");
  }
  if (focus !== undefined && !modules.some((item) => item.name === focus)) {
    throw new Error(
      `saasaloy-graph: focus=${focus} is not a module with a tile. Use a capability or feature name such as email.`
    );
  }
  return { modules, selected: focus ?? first.name };
}

/** One capability, its providers and its selector variable. Throws when it has none. */
export function providersData(
  descriptors: readonly BlockDescriptor[],
  capability: string
): ProvidersData {
  const row = catalogRows([...descriptors]).find(
    (item) => item.name === capability
  );
  const descriptor = descriptors.find((item) => item.name === capability);
  const providers = (row?.variants ?? []).filter(
    (variant) => variant.tier === "provider"
  );
  if (!row || !descriptor || providers.length === 0) {
    throw new Error(
      `saasaloy-providers: capability=${capability} is not a module that takes providers.`
    );
  }
  const selector = Object.keys(descriptor.envVars ?? {}).find((key) =>
    key.endsWith("_PROVIDER")
  );
  if (selector === undefined) {
    throw new Error(
      `saasaloy-providers: ${capability} declares no *_PROVIDER variable in envVars.`
    );
  }
  return {
    capability,
    description: row.description,
    selector,
    list: /comma list/i.test(descriptor.envVars?.[selector] ?? ""),
    providers: providers.map((variant) => ({
      name: variant.name,
      value: variant.label,
      description:
        descriptors.find((item) => item.name === variant.name)?.description ??
        "",
    })),
  };
}

/**
 * The `key=value` words after the language of a fenced block, such as `focus=email`. A value
 * in double quotes may hold spaces: `section="Roll back"`.
 */
export function parseBlockArgs(
  meta: string | null | undefined,
  allowed: readonly string[],
  language: string
): Record<string, string> {
  const fail = (word: string): Error =>
    new Error(
      `${language}: cannot read "${word}". The block takes ${
        allowed.length === 0
          ? "no argument"
          : allowed.map((name) => `${name}=<name>`).join(" ")
      }.`
    );
  const source = meta ?? "";
  if (source.split('"').length % 2 === 0) {
    throw fail(source.trim());
  }
  const args: Record<string, string> = {};
  for (const word of source.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []) {
    const [, key = "", quoted, bare] =
      /^([^="]+)=(?:"([^"]*)"|([^="]+))$/.exec(word) ?? [];
    const value = quoted ?? bare ?? "";
    if (value.trim() === "" || !allowed.includes(key)) {
      throw fail(word);
    }
    args[key] = value;
  }
  return args;
}

/** What a `saasaloy-command` block shows: the agent prompt and the commands the CLI tab copies. */
export interface CommandData {
  prompt: string;
  /** One command for each line, in the order the fence body lists them. */
  commands: string[];
}

/**
 * The prompt and the commands of one `saasaloy-command` fence. Throws on an unknown task, a
 * `name` the task does not take or that names no module, a missing `name`, and an empty body.
 */
export function commandData(
  descriptors: readonly BlockDescriptor[],
  args: Record<string, string>,
  body: string
): CommandData {
  const { task, name, section } = args;
  if (task === undefined || !isPromptTask(task)) {
    throw new Error(
      `saasaloy-command: ${task === undefined ? "the block needs task=<task>" : `task=${task} is not a prompt task`}. Use one of: ${Object.keys(prompts).join(", ")}.`
    );
  }
  const entry: AgentPrompt = prompts[task];
  const takesName = `${entry.task}${entry.slug}`.includes("{name}");
  if (takesName && name === undefined) {
    throw new Error(`saasaloy-command: task=${task} needs name=<module>.`);
  }
  if (!takesName && name !== undefined) {
    throw new Error(`saasaloy-command: task=${task} takes no name.`);
  }
  if (name !== undefined && !descriptors.some((item) => item.name === name)) {
    throw new Error(`saasaloy-command: name=${name} is not a module.`);
  }
  const commands = body
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  if (commands.length === 0) {
    throw new Error(
      `saasaloy-command: task=${task} has no command. Write the CLI commands in the fence body.`
    );
  }
  return { prompt: agentPrompt(task, { name, section }), commands };
}
