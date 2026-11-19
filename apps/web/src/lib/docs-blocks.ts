// The remark plugin behind the `saasaloy-*` fenced blocks (plan 0114 Phase 4). A page writes
//
//     ```saasaloy-graph focus=email
//     ```
//
// and the plugin replaces the fence with a `<div data-saasaloy-block>` that holds the facts
// twice: as a plain list, which is all a reader sees with JavaScript off and which the
// search index reads, and as JSON in `data-props`, which docs-blocks-client.ts hands to the
// React island that takes the list's place. The facts come from `modules/*/registry-item.json`
// at build time, so a block cannot go stale. The body of the fence is the block's data for a
// reader of the raw Markdown (GitHub, an agent): the generator writes it, the plugin ignores
// it. A fence whose language starts with `saasaloy-` and names no block fails the build,
// like a link to a missing page does, so a typo never ships as a code block.
//
// Like docs-links.ts it runs only in Node: astro.config.mjs lists it in
// `markdown.remarkPlugins`, so it may read the registry with node:fs.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  graphData,
  parseBlockArgs,
  providersData,
} from "./docs-blocks-data.ts";
import type {
  BlockDescriptor,
  GraphData,
  ProvidersData,
} from "./docs-blocks-data.ts";

export const BLOCK_LANGUAGES = [
  "saasaloy-graph",
  "saasaloy-providers",
] as const;

interface MdastNode {
  type: string;
  lang?: string | null;
  meta?: string | null;
  value?: string;
  ordered?: boolean | null;
  spread?: boolean | null;
  children?: MdastNode[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const text = (value: string): MdastNode => ({ type: "text", value });
const mono = (value: string): MdastNode => ({ type: "inlineCode", value });
const paragraph = (children: MdastNode[]): MdastNode => ({
  type: "paragraph",
  children,
});

/** `a`, `b` and `c` as inline code with a comma between; empty for no names. */
function names(list: readonly string[]): MdastNode[] {
  return list.flatMap((name, index) =>
    index === 0 ? [mono(name)] : [text(", "), mono(name)]
  );
}

function bulletList(items: MdastNode[][]): MdastNode {
  return {
    type: "list",
    ordered: false,
    spread: false,
    children: items.map((children) => ({
      type: "listItem",
      spread: false,
      children: [paragraph(children)],
    })),
  };
}

function block(
  kind: string,
  props: GraphData | ProvidersData,
  children: MdastNode[]
): MdastNode {
  return {
    type: "saasaloyBlock",
    data: {
      hName: "div",
      hProperties: {
        className: ["saasaloy-block"],
        "data-saasaloy-block": kind,
        "data-props": JSON.stringify(props),
      },
    },
    children,
  };
}

/** The graph as a list: one line for each module with its dependencies and variants. */
function graphBlock(data: GraphData): MdastNode {
  const lines = data.modules.map((item) => {
    const line: MdastNode[] = [mono(item.name), text(` (${item.tier})`)];
    const parts: [string, string[]][] = [
      ["depends on", item.needs],
      ["used by", item.usedBy],
      [
        "providers",
        item.variants.filter((v) => v.tier === "provider").map((v) => v.name),
      ],
      [
        "drivers",
        item.variants.filter((v) => v.tier === "driver").map((v) => v.name),
      ],
    ];
    const shown = parts.filter(([, list]) => list.length > 0);
    for (const [index, [label, list]] of shown.entries()) {
      line.push(text(`${index === 0 ? ": " : "; "}${label} `), ...names(list));
    }
    return line;
  });
  return block("graph", data, [
    paragraph([
      text(
        "Module dependencies. Each line names a module, then what it depends on, what depends on it, and its providers or drivers."
      ),
    ]),
    bulletList(lines),
  ]);
}

/** The providers block as a list: the selector variable and one line for each provider. */
function providersBlock(data: ProvidersData): MdastNode {
  return block("providers", data, [
    paragraph([
      mono(data.capability),
      text(" picks its provider at runtime. Set "),
      mono(data.selector),
      text(" to one of these values."),
    ]),
    bulletList(
      data.providers.map((provider) => [
        mono(`${data.selector}=${provider.value}`),
        text(" uses "),
        mono(provider.name),
        text(provider.description === "" ? "." : `. ${provider.description}`),
      ])
    ),
  ]);
}

function readDescriptors(repoRoot: string): BlockDescriptor[] {
  const modules = join(repoRoot, "modules");
  return readdirSync(modules, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        JSON.parse(
          readFileSync(join(modules, entry.name, "registry-item.json"), "utf-8")
        ) as BlockDescriptor
    );
}

/** The block one fence stands for. Throws on an unknown language or argument. */
export function blockFor(
  language: string,
  meta: string | null | undefined,
  descriptors: readonly BlockDescriptor[]
): MdastNode {
  if (language === "saasaloy-graph") {
    const args = parseBlockArgs(meta, ["focus"], language);
    return graphBlock(graphData(descriptors, args.focus));
  }
  if (language === "saasaloy-providers") {
    const args = parseBlockArgs(meta, ["capability"], language);
    if (args.capability === undefined) {
      throw new Error(`${language}: the block needs capability=<name>.`);
    }
    return providersBlock(providersData(descriptors, args.capability));
  }
  throw new Error(
    `Unknown block "${language}". The known blocks are ${BLOCK_LANGUAGES.join(", ")}.`
  );
}

function replace(
  node: MdastNode,
  load: () => readonly BlockDescriptor[]
): void {
  const { children } = node;
  if (children === undefined) {
    return;
  }
  for (const [index, child] of children.entries()) {
    if (child.type === "code" && child.lang?.startsWith("saasaloy-")) {
      children[index] = blockFor(child.lang, child.meta, load());
    } else {
      replace(child, load);
    }
  }
}

/** Replaces each `saasaloy-*` fence with its block, and fails the build on an unknown one. */
export function remarkDocsBlocks(options: { repoRoot: string }) {
  let descriptors: BlockDescriptor[] | undefined;
  const load = (): readonly BlockDescriptor[] => {
    descriptors ??= readDescriptors(options.repoRoot);
    return descriptors;
  };
  return (tree: MdastNode, file?: { path?: string }): void => {
    try {
      replace(tree, load);
    } catch (error) {
      const where = file?.path === undefined ? "" : ` (in ${file.path})`;
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${where}`,
        { cause: error }
      );
    }
  };
}

/**
 * Scans a page body for fenced blocks whose language starts with `saasaloy-` and throws on one
 * that is not in BLOCK_LANGUAGES. The remark plugin throws too, but Astro's content loader logs
 * a render error and goes on, so the build exits 0. The raw Markdown route calls this from
 * `getStaticPaths`, which Astro does not catch, so an unknown block fails the build there.
 */
export function assertKnownBlocks(body: string, path: string): void {
  let open: { char: string; size: number } | undefined;
  for (const line of body.split("\n")) {
    const match = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line);
    if (match === null) {
      continue;
    }
    const [, fence = "", lang = ""] = match;
    const char = fence.charAt(0);
    if (open !== undefined) {
      if (
        char === open.char &&
        fence.length >= open.size &&
        lang === "" &&
        line.trim() === fence
      ) {
        open = undefined;
      }
      continue;
    }
    open = { char, size: fence.length };
    if (
      lang.startsWith("saasaloy-") &&
      !(BLOCK_LANGUAGES as readonly string[]).includes(lang)
    ) {
      throw new Error(
        `Unknown block "${lang}". The known blocks are ${BLOCK_LANGUAGES.join(", ")}. (in ${path})`
      );
    }
  }
}
