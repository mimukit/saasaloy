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

function frame(pre: HastNode): HastNode {
  return element("div", { className: ["docs-code"], "data-docs-code": "" }, [
    pre,
    element(
      "button",
      {
        type: "button",
        className: ["docs-copy"],
        hidden: true,
        "data-docs-copy": "",
        "data-pagefind-ignore": "",
      },
      [{ type: "text", value: "Copy" }]
    ),
  ]);
}

/** A table scrolls sideways inside its own box, which a keyboard can focus and scroll. */
function scrollBox(table: HastNode): HastNode {
  return element("div", { className: ["docs-scroll"], tabIndex: 0 }, [table]);
}

function wrap(node: HastNode): void {
  const { children } = node;
  if (children === undefined) {
    return;
  }
  for (const [index, child] of children.entries()) {
    if (child.type === "element" && child.tagName === "pre") {
      child.properties = { ...child.properties, tabIndex: 0 };
      children[index] = frame(child);
    } else if (child.type === "element" && child.tagName === "table") {
      children[index] = scrollBox(child);
    } else {
      wrap(child);
    }
  }
}

/** Frames every `<pre>` with a hidden Copy button and every `<table>` in a scroll box. */
export function rehypeCodeFrame() {
  return (tree: HastNode): void => {
    wrap(tree);
  };
}
