// The rich-text editor, exported as `@repo/cms/editor`. `apps/admin` imports it for every
// `richText` field, and a later module (ecommerce product descriptions) imports the same
// component. No other workspace imports Tiptap: this package owns every Tiptap dependency
// (ADR 0020), and React is a peer dependency, so the app's own React is the one that runs.
//
// It edits Tiptap JSON and hands Tiptap JSON back. It never produces HTML; the api renders
// once at publish with `renderRichText`.
//
// The link rule is the renderer's: `isSafeHref` backs the Link extension's `isAllowedUri`
// in `cmsExtensions()`, and the link button checks it again before it sets a mark.
//
// The toolbar is data, not markup. The editor works out every tool's label, its pressed
// and disabled state and what it runs, and hands that to the host's `toolbar` render prop,
// so `apps/admin` draws it with its own shell primitives and icons and this package
// imports no design system. Without the prop, a plain toolbar of text buttons renders.

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { cmsExtensions } from "./extensions";
import type { MediaValue, RichTextDocument } from "./fields";
import { isSafeHref } from "./links";

/** An image the host picked: the stored object, and the URL that shows it in the editor. */
export interface PickedImage extends MediaValue {
  /** The public URL. The editor stores it as `src`; the renderer builds its own from `key`. */
  url?: string;
}

/** Every tool the toolbar offers. `image` appears only when the host can pick one. */
export type EditorToolId =
  | "bold"
  | "italic"
  | "strike"
  | "code"
  | "bulletList"
  | "orderedList"
  | "blockquote"
  | "codeBlock"
  | "link"
  | "image"
  | "undo"
  | "redo";

/** The groups a toolbar separates. `history` sits at the far end. */
export type EditorToolGroup = "marks" | "blocks" | "insert" | "history";

export interface EditorTool {
  id: EditorToolId;
  group: EditorToolGroup;
  label: string;
  active: boolean;
  disabled: boolean;
  run: () => void;
}

/** The block style of the selection, for the "Paragraph / Heading" picker. */
export type EditorTextStyle = "paragraph" | "heading2" | "heading3";

export const TEXT_STYLES: readonly { value: EditorTextStyle; label: string }[] =
  [
    { label: "Paragraph", value: "paragraph" },
    { label: "Heading 2", value: "heading2" },
    { label: "Heading 3", value: "heading3" },
  ];

/** What the `toolbar` render prop receives. */
export interface EditorToolbarState {
  tools: EditorTool[];
  textStyle: EditorTextStyle;
  setTextStyle: (style: EditorTextStyle) => void;
}

export interface RichTextEditorProps {
  /** The stored document, or `undefined` for an empty body. */
  value: RichTextDocument | undefined;
  /** Called with the new document on every change the admin makes. */
  onChange: (value: RichTextDocument) => void;
  /**
   * Called when the editor rewrites a document nobody edited. Tiptap adds default
   * attributes to links and lists as it loads a body, and the trailing-node plugin adds an
   * empty last paragraph, so a body written through the api never equals what the editor
   * hands back. The host takes this value as its saved baseline too, or the form reads as
   * changed the moment it opens. Left out, these rewrites go to `onChange`.
   */
  onNormalize?: (value: RichTextDocument) => void;
  /** Read-only when false. Default true. */
  editable?: boolean;
  /**
   * Ask the host for an image to insert. `apps/admin` opens the `file-uploads` picker and
   * resolves with the stored object, or `null` when the admin cancels. Leave it out to hide
   * the image tool.
   */
  onRequestImage?: () => Promise<PickedImage | null>;
  /**
   * Ask the host for a link URL. Default `window.prompt`. Resolve `null` to cancel and an
   * empty string to remove the link.
   */
  onRequestLink?: (current: string | undefined) => Promise<string | null>;
  /**
   * Called with a URL the link rule refused, so the host can say why. The rule: http,
   * https, mailto, tel, or a relative URL.
   */
  onLinkRefused?: (href: string) => void;
  /** Draw the toolbar. Leave it out for the plain one. */
  toolbar?: (state: EditorToolbarState) => ReactNode;
  /** The accessible name of the content area. */
  label?: string;
  /** The id of the element that labels the content area, instead of `label`. */
  labelledBy?: string;
  /** The wrapper around the toolbar and the content. */
  className?: string;
  /** The editable content area. */
  contentClassName?: string;
  /** The plain toolbar's row. Unused when `toolbar` is given. */
  toolbarClassName?: string;
}

const EMPTY: RichTextDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function promptLink(current: string | undefined): Promise<string | null> {
  // oxlint-disable-next-line no-alert -- the plain fallback; apps/admin passes its own dialog
  return Promise.resolve(window.prompt("Link URL", current ?? ""));
}

async function editLink(
  editor: Editor,
  request: (current: string | undefined) => Promise<string | null>,
  refused: ((href: string) => void) | undefined
): Promise<void> {
  const current: unknown = editor.getAttributes("link").href;
  const next = await request(typeof current === "string" ? current : undefined);
  if (next === null) {
    return;
  }
  const href = next.trim();
  if (href === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  if (!isSafeHref(href)) {
    refused?.(href);
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
}

async function insertImage(
  editor: Editor,
  request: () => Promise<PickedImage | null>
): Promise<void> {
  const image = await request();
  if (!image) {
    return;
  }
  editor
    .chain()
    .focus()
    .insertContent({
      attrs: {
        alt: image.alt ?? "",
        objectId: image.objectId,
        src: image.url ?? null,
        storageKey: image.key,
      },
      type: "image",
    })
    .run();
}

/** The selection's state the toolbar reads. Selected once per transaction. */
function selectState(editor: Editor | null) {
  if (!editor) {
    return null;
  }
  return {
    blockquote: editor.isActive("blockquote"),
    bold: editor.isActive("bold"),
    bulletList: editor.isActive("bulletList"),
    canRedo: editor.can().redo(),
    canUndo: editor.can().undo(),
    code: editor.isActive("code"),
    codeBlock: editor.isActive("codeBlock"),
    heading2: editor.isActive("heading", { level: 2 }),
    heading3: editor.isActive("heading", { level: 3 }),
    italic: editor.isActive("italic"),
    link: editor.isActive("link"),
    orderedList: editor.isActive("orderedList"),
    strike: editor.isActive("strike"),
  };
}

/** A Tiptap editor over one `richText` field's value. */
export function RichTextEditor({
  className,
  contentClassName,
  editable = true,
  label,
  labelledBy,
  onChange,
  onLinkRefused,
  onNormalize,
  onRequestImage,
  onRequestLink = promptLink,
  toolbar,
  toolbarClassName,
  value,
}: RichTextEditorProps) {
  const attributes: Record<string, string> = { role: "textbox" };
  if (labelledBy) {
    attributes["aria-labelledby"] = labelledBy;
  } else if (label) {
    attributes["aria-label"] = label;
  }
  attributes["aria-multiline"] = "true";
  if (contentClassName) {
    attributes.class = contentClassName;
  }

  const editor = useEditor({
    content: value ?? EMPTY,
    editable,
    editorProps: { attributes },
    extensions: cmsExtensions(),
    immediatelyRender: false,
    onUpdate({ editor: current, transaction }) {
      const next = current.getJSON() as RichTextDocument;
      // An update with no step of its own did not come from the admin. `setEditable`
      // emits one on mount, and the trailing-node plugin adds its paragraph on the first
      // click into a loaded body.
      if (transaction.steps.length === 0 && onNormalize) {
        onNormalize(next);
        return;
      }
      onChange(next);
    },
  });

  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => selectState(current),
  });

  // The newest `onNormalize`, read by the effect below. The host passes a new function on
  // every render, and the effect must run on a new value only.
  const normalize = useRef(onNormalize);
  useEffect(() => {
    normalize.current = onNormalize;
  }, [onNormalize]);

  // A value set from outside, such as a restored revision, replaces the content. A value
  // that only echoes the editor's own last change is left alone, or the cursor would jump.
  useEffect(() => {
    if (!editor) {
      return;
    }
    const next = JSON.stringify(value ?? EMPTY);
    if (JSON.stringify(editor.getJSON()) === next) {
      return;
    }
    // Out of the undo history: undo must not step back past a restore or a load.
    editor
      .chain()
      .setMeta("addToHistory", false)
      .setContent(value ?? EMPTY, { emitUpdate: false })
      .run();
    // The editor's own form of the loaded document, when it differs from the stored one.
    const settled = editor.getJSON() as RichTextDocument;
    if (JSON.stringify(settled) !== next) {
      normalize.current?.(settled);
    }
  }, [editor, value]);

  useEffect(() => {
    // `setEditable` emits an update with no step. `onUpdate` reports it as a normalised
    // document, not as an edit, and that first report is also what draws the toolbar.
    editor?.setEditable(editable);
  }, [editor, editable]);

  if (!editor || !state) {
    return null;
  }

  const chain = () => editor.chain().focus();
  const tool = (
    id: EditorToolId,
    group: EditorToolGroup,
    toolLabel: string,
    run: () => unknown,
    active = false,
    disabled = false
  ): EditorTool => ({
    active,
    disabled,
    group,
    id,
    label: toolLabel,
    run: () => {
      void run();
    },
  });

  const tools: EditorTool[] = [
    tool("bold", "marks", "Bold", () => chain().toggleBold().run(), state.bold),
    tool(
      "italic",
      "marks",
      "Italic",
      () => chain().toggleItalic().run(),
      state.italic
    ),
    tool(
      "strike",
      "marks",
      "Strikethrough",
      () => chain().toggleStrike().run(),
      state.strike
    ),
    tool(
      "code",
      "marks",
      "Inline code",
      () => chain().toggleCode().run(),
      state.code
    ),
    tool(
      "bulletList",
      "blocks",
      "Bulleted list",
      () => chain().toggleBulletList().run(),
      state.bulletList
    ),
    tool(
      "orderedList",
      "blocks",
      "Numbered list",
      () => chain().toggleOrderedList().run(),
      state.orderedList
    ),
    tool(
      "blockquote",
      "blocks",
      "Quote",
      () => chain().toggleBlockquote().run(),
      state.blockquote
    ),
    tool(
      "codeBlock",
      "blocks",
      "Code block",
      () => chain().toggleCodeBlock().run(),
      state.codeBlock
    ),
    tool(
      "link",
      "insert",
      "Link",
      () => editLink(editor, onRequestLink, onLinkRefused),
      state.link
    ),
    ...(onRequestImage
      ? [
          tool("image", "insert", "Image", () =>
            insertImage(editor, onRequestImage)
          ),
        ]
      : []),
    tool(
      "undo",
      "history",
      "Undo",
      () => chain().undo().run(),
      false,
      !state.canUndo
    ),
    tool(
      "redo",
      "history",
      "Redo",
      () => chain().redo().run(),
      false,
      !state.canRedo
    ),
  ];

  const textStyle: EditorTextStyle = state.heading2
    ? "heading2"
    : state.heading3
      ? "heading3"
      : "paragraph";
  const setTextStyle = (style: EditorTextStyle) => {
    if (style === "paragraph") {
      chain().setParagraph().run();
    } else {
      chain()
        .setHeading({ level: style === "heading2" ? 2 : 3 })
        .run();
    }
  };

  const plain = (
    <div className={toolbarClassName} role="toolbar" aria-label="Formatting">
      {tools.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-label={item.label}
          aria-pressed={item.active}
          disabled={item.disabled}
          onClick={() => {
            item.run();
          }}
          title={item.label}
        >
          {item.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className={className}>
      {editable
        ? toolbar
          ? toolbar({ setTextStyle, textStyle, tools })
          : plain
        : null}
      <EditorContent editor={editor} />
    </div>
  );
}
