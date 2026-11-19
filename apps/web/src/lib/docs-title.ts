// The remark plugin that drops a wiki page's own `# Title`. Each page starts with one so it
// reads right on GitHub, and the docs layout prints the page title itself as the page's h1,
// so keeping both would give the page two. The title still reaches the site: docs-nav.ts
// reads the H1 of a glob entry (the module pages) from the raw body.

interface MdastNode {
  type: string;
  depth?: number;
  children?: MdastNode[];
}

/** Removes the first top-level `# heading` of the page. */
export function remarkDropTitle() {
  return (tree: MdastNode): void => {
    const children = tree.children ?? [];
    const index = children.findIndex(
      (node) => node.type === "heading" && node.depth === 1
    );
    if (index !== -1) {
      children.splice(index, 1);
    }
  };
}
