// The rehype plugin that frames each code block and table. A code block gets a Copy button. The button is
// plain HTML with the `hidden` attribute: the docs layout's script shows it and wires it
// up, so a reader without JavaScript sees a code block and no dead control. Like
// docs-links.ts it has no dependency, and astro.config.mjs lists it in
// `markdown.rehypePlugins`.

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

function element(
  tagName: string,
  properties: Record<string, unknown>,
  children: HastNode[]
): HastNode {
  return { type: "element", tagName, properties, children };
}

function frame(pre: HastNode, copy: boolean): HastNode {
  return element("div", { className: ["docs-code"], "data-docs-code": "" }, [
    pre,
    ...(copy ? [copyButton()] : []),
  ]);
}

function copyButton(): HastNode {
  return element(
    "button",
    {
      type: "button",
      className: ["docs-copy"],
      hidden: true,
      "data-docs-copy": "",
      "data-pagefind-ignore": "",
    },
    [{ type: "text", value: "Copy" }]
  );
}

/**
 * A table scrolls sideways inside its own box, which a keyboard can focus and scroll. The box
 * is a named region, so a screen reader says what the tab stop is.
 */
function scrollBox(table: HastNode): HastNode {
  return element(
    "div",
    {
      className: ["docs-scroll"],
      tabIndex: 0,
      role: "region",
      ariaLabel: "Table",
    },
    [table]
  );
}

/** True for the `saasaloy-command` block of lib/docs-blocks.ts, which has its own Copy button. */
function isCommandBlock(node: HastNode): boolean {
  const names = node.properties?.className;
  return Array.isArray(names) && names.includes("saasaloy-command");
}

function wrap(node: HastNode, copy = true): void {
  const { children } = node;
  if (children === undefined) {
    return;
  }
  for (const [index, child] of children.entries()) {
    if (child.type === "element" && child.tagName === "pre") {
      child.properties = { ...child.properties, tabIndex: 0 };
      children[index] = frame(child, copy);
    } else if (child.type === "element" && child.tagName === "table") {
      children[index] = scrollBox(child);
    } else {
      wrap(child, copy && !isCommandBlock(child));
    }
  }
}

/**
 * Frames every `<pre>` with a hidden Copy button, except inside a `saasaloy-command` block,
 * and every `<table>` in a scroll box.
 */
export function rehypeCodeFrame() {
  return (tree: HastNode): void => {
    wrap(tree);
  };
}
