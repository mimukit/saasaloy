import {
  BoldIcon,
  CodeIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  Redo2Icon,
  SquareCodeIcon,
  StrikethroughIcon,
  Undo2Icon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Fragment } from "react";

import { TEXT_STYLES } from "@repo/cms/editor";
import type {
  EditorTextStyle,
  EditorToolbarState,
  EditorToolId,
} from "@repo/cms/editor";
import { Separator } from "@repo/ui/components/shell/separator";
import { Toggle } from "@repo/ui/components/shell/toggle";

// The rich-text toolbar, drawn from the state `@repo/cms/editor` hands its `toolbar` render
// prop. The editor decides what each tool does and whether it is pressed; this file only
// picks the icon and the layout: the text-style picker, then marks, blocks and inserts with
// a separator between groups, and undo and redo at the far end.

const ICONS: Record<EditorToolId, LucideIcon> = {
  blockquote: QuoteIcon,
  bold: BoldIcon,
  bulletList: ListIcon,
  code: CodeIcon,
  codeBlock: SquareCodeIcon,
  image: ImageIcon,
  italic: ItalicIcon,
  link: LinkIcon,
  orderedList: ListOrderedIcon,
  redo: Redo2Icon,
  strike: StrikethroughIcon,
  undo: Undo2Icon,
};

export function EditorToolbar({
  setTextStyle,
  textStyle,
  tools,
}: EditorToolbarState) {
  const leading = tools.filter((tool) => tool.group !== "history");
  const history = tools.filter((tool) => tool.group === "history");

  const button = (tool: (typeof tools)[number]) => {
    const Icon = ICONS[tool.id];
    return (
      <Toggle
        key={tool.id}
        size="sm"
        aria-label={tool.label}
        title={tool.label}
        pressed={tool.active}
        disabled={tool.disabled}
        onClick={() => {
          tool.run();
        }}
      >
        <Icon />
      </Toggle>
    );
  };

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="border-border bg-muted/40 flex flex-wrap items-center gap-0.5 border-b px-1.5 py-1"
    >
      <select
        aria-label="Text style"
        className="text-foreground hover:bg-accent focus-visible:ring-ring h-7 rounded-md bg-transparent px-1.5 text-sm font-medium outline-none focus-visible:ring-2"
        value={textStyle}
        onChange={(event) => {
          setTextStyle(event.target.value as EditorTextStyle);
        }}
      >
        {TEXT_STYLES.map((style) => (
          <option key={style.value} value={style.value}>
            {style.label}
          </option>
        ))}
      </select>
      {leading.map((tool, index) => (
        <Fragment key={tool.id}>
          {index === 0 || leading[index - 1]?.group !== tool.group ? (
            <Separator orientation="vertical" className="mx-1 h-5" />
          ) : null}
          {button(tool)}
        </Fragment>
      ))}
      <span className="ms-auto flex items-center gap-0.5">
        {history.map(button)}
      </span>
    </div>
  );
}

/**
 * The content area's type: the same sizes the admin body uses, with the rich-text blocks
 * styled by descendant selectors, because Tiptap renders plain elements.
 */
export const EDITOR_CONTENT_CLASS =
  "min-h-80 space-y-3 px-4 py-3 text-sm leading-6 outline-none [&_a]:underline [&_a]:underline-offset-2 [&_blockquote]:border-border [&_blockquote]:text-muted-foreground [&_blockquote]:border-s-2 [&_blockquote]:ps-3 [&_code]:bg-muted [&_code]:rounded [&_code]:px-1 [&_code]:font-mono [&_code]:text-[0.8125rem] [&_h2]:pt-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-semibold [&_img]:max-h-96 [&_img]:rounded-lg [&_img.ProseMirror-selectednode]:ring-ring [&_img.ProseMirror-selectednode]:ring-2 [&_li]:ms-5 [&_ol]:list-decimal [&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:px-3 [&_pre]:py-2 [&_pre]:font-mono [&_pre]:text-[0.8125rem] [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc";
