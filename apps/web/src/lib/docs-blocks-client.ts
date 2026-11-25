// Mounts the `saasaloy-*` islands. docs-blocks.ts writes each block as a plain list inside
// `<div data-saasaloy-block data-props>`; this replaces the list with the React component
// that draws the same facts. Nothing loads on a page with no block, and a block whose
// props do not parse keeps its list.

import type {
  CommandData,
  GraphData,
  ProvidersData,
} from "./docs-blocks-data.ts";

export async function mountDocsBlocks(root: ParentNode = document) {
  const hosts = [
    ...root.querySelectorAll<HTMLElement>("[data-saasaloy-block]"),
  ];
  if (hosts.length === 0) {
    return;
  }
  const [{ createElement }, { createRoot }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
  ]);
  for (const host of hosts) {
    try {
      const props: unknown = JSON.parse(host.dataset.props ?? "");
      if (host.dataset.saasaloyBlock === "command") {
        const { DocsCommand } = await import("@web/components/docs-command");
        createRoot(host).render(
          createElement(DocsCommand, { data: props as CommandData })
        );
      } else if (host.dataset.saasaloyBlock === "graph") {
        const { DocsGraph } = await import("@web/components/docs-graph");
        createRoot(host).render(
          createElement(DocsGraph, { data: props as GraphData })
        );
      } else if (host.dataset.saasaloyBlock === "providers") {
        const { DocsProviders } =
          await import("@web/components/docs-providers");
        createRoot(host).render(
          createElement(DocsProviders, { data: props as ProvidersData })
        );
      }
      host.dataset.mounted = "";
    } catch (error) {
      // A block that fails to mount keeps its plain list; the console tells the author why.
      // oxlint-disable-next-line no-console
      console.error("saasaloy block did not mount", error);
    }
  }
}
