// The Saasaloy UI blocks the /ui pages list, read from apps/web/registry.json at build
// time. The Code tab shows the same public source the registry build writes: the template
// block's raw text through `inlineSource` (./registry-inline.ts), with the template's own
// content and config. Vite resolves `@repo/ui` and `@repo/config` to the template
// (astro.config.mjs), so this file and the registry build read one copy of each.

import { config } from "@repo/config";
import { errors } from "@repo/ui/content/errors";
import { landing, ui } from "@repo/ui/content/landing";

import registry from "../../registry.json";
import { repoUrl } from "@web/site";
import { inlineSource, withProvenance } from "@web/lib/registry-inline";

/** One block, as the index card and the block page show it. */
export interface UiBlock {
  /** The registry name, `ink-hero` or `auth-sign-in`. */
  name: string;
  /** The path under `blocks/` without `.tsx`: `hero`, or `auth/sign-in` for a module block. */
  block: string;
  title: string;
  description: string;
  category: string;
  /** Where shadcn writes the file in a project. */
  target: string;
  /** The template file on GitHub. */
  sourceUrl: string;
  /** The `@repo/ui` import path inside a generated Saasaloy project. */
  localImport: string;
  /** The source file, from the repo root. */
  sourcePath: string;
  /** The Saasaloy module that ships the block (`auth`), or `undefined` for a kit block. */
  module: string | undefined;
}

// The raw block sources, keyed by their path from this file. `?raw` keeps them as text.
// Module blocks (plan 0121, Phase 5) sit in their module's files/ui/blocks/ folder.
const RAW_BLOCKS = import.meta.glob<string>(
  [
    "../../../../packages/cli/templates/base/packages/ui/src/blocks/*.tsx",
    "../../../../modules/*/files/ui/blocks/**/*.tsx",
  ],
  { query: "?raw", import: "default", eager: true }
);

/** Every block item in apps/web/registry.json, in file order. */
export function uiBlocks(): UiBlock[] {
  return registry.items
    .filter((item) => item.type === "registry:block")
    .map((item) => {
      const [file] = item.files;
      if (
        file === undefined ||
        !("target" in file) ||
        file.target === undefined
      ) {
        throw new Error(
          `${item.name}: a block item needs one file with a target.`
        );
      }
      const block = file.target
        .replace(/^components\/blocks\//, "")
        .replace(/\.tsx$/, "");
      const fromRepo = file.path.replace(/^\.\.\/\.\.\//, "");
      return {
        name: item.name,
        block,
        title: item.title,
        description: item.description,
        category: item.categories?.[0] ?? "",
        target: file.target,
        sourceUrl: `${repoUrl}/blob/main/${fromRepo}`,
        localImport: `@repo/ui/blocks/${block}`,
        sourcePath: fromRepo,
        module: /^modules\/([^/]+)\//.exec(fromRepo)?.[1],
      };
    });
}

/** The public source of a block: what `shadcn add` writes into a project. */
export function publicSource(block: UiBlock): string {
  const key = Object.keys(RAW_BLOCKS).find((path) =>
    path.endsWith(`/${block.sourcePath}`)
  );
  const raw = key === undefined ? undefined : RAW_BLOCKS[key];
  if (raw === undefined) {
    throw new Error(`${block.name}: no source at ${block.sourcePath}.`);
  }
  return withProvenance(
    block.name,
    inlineSource(
      raw,
      {
        content: { landing: { landing, ui }, errors: { errors } },
        config: { config },
      },
      block.name
    )
  );
}
