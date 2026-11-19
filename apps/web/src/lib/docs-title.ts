// The remark plugin that drops a wiki page's own `# Title`. Each page starts with one so it
// reads right on GitHub, and the docs layout prints the page title itself as the page's h1,
// so keeping both would give the page two. The title still reaches the site: docs-nav.ts
// reads the H1 of a glob entry (the module pages) from the raw body.

interface MdastNode {
  type: string;
  depth?: number;
  value?: string;
  children?: MdastNode[];
}

function textOf(node: MdastNode): string {
  return node.value ?? (node.children ?? []).map(textOf).join("");
}

const STAMP_TEXT =
  /^Verified against \S+@[0-9a-f]{7,40} on \d{4}-\d{2}-\d{2}\.$/;

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

/**
 * Removes the stamp paragraph, `_Verified against `main`@`42cbf03` on 2026-09-11._`. The
 * layout shows the stamp in the page header as a link to the commit (lib/docs-stamp.ts), so
 * the line at the page's end would say it twice. The raw Markdown keeps the line.
 */
export function remarkDropStamp() {
  return (tree: MdastNode): void => {
    const children = tree.children ?? [];
    const index = children.findLastIndex(
      (node) => node.type === "paragraph" && STAMP_TEXT.test(textOf(node))
    );
    if (index !== -1) {
      children.splice(index, 1);
    }
  };
}
