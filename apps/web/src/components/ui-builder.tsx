import { useEffect, useRef, useState } from "react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  XIcon,
} from "lucide-react";

import { buttonVariants } from "@web/components/button";
import { uiRegistry } from "@web/content/ui-registry";
import { interpolate } from "@web/lib/interpolate";
import {
  addableBlocks,
  addBlock,
  blockKit,
  builderCommand,
  builderQuery,
  canMove,
  canRemove,
  moveBlock,
  parseBuilderQuery,
  previewQuery,
  removeBlock,
  TEMPLATE_NAMES,
  templateState,
  THEME_NAMES,
} from "@web/lib/ui-builder";
import type { BuilderState, PageBlock } from "@web/lib/ui-builder";
import { cn } from "@web/lib/utils";

// The Saasaloy UI builder (/ui/builder, plan 0121, Phase 7), from round r3 of the builder
// mockup (0121-r3-builder-*.png, decided by the afkkit run on 2026-11-22). Two panes, as
// assumption 7 settles: the controls on the left (template, theme, the ordered block list
// with move up, move down and remove, an add-block select, the command), the live preview
// on the right. Below `lg` the panes stack, and an Edit and Preview tab pair picks one.
// No drag and drop: the plan's non-goal.
//
// The state lives in the page URL (lib/ui-builder.ts), written with `replaceState` on each
// edit, so a link reproduces the builder. The page renders this island `client:only`,
// because the first state comes from that URL.
//
// The preview is the composed page frame (/ui/preview/page). Its first URL carries the
// state, and each edit after it reaches the frame as a `saasaloy-ui-compose` message, so
// the frame keeps its scroll position. The frame follows the site's light or dark mode.

const copy = uiRegistry.builder;
const COPIED_MS = 2000;
const MOBILE_WIDTH = 390;

const segmentClass =
  "aria-pressed:bg-muted aria-pressed:text-foreground aria-pressed:border-highlight border-border text-muted-foreground hover:text-foreground focus-visible:outline-ring -ml-px inline-flex h-10 cursor-pointer items-center justify-center gap-2 border px-3 font-mono text-sm first:ml-0 focus-visible:relative focus-visible:outline-2 focus-visible:outline-offset-2";
const selectClass =
  "border-border bg-background text-foreground focus-visible:outline-ring h-10 w-full cursor-pointer border px-3 font-mono text-sm focus-visible:outline-2";
const iconButtonClass =
  "border-border text-foreground hover:bg-muted focus-visible:outline-ring inline-flex size-8 cursor-pointer items-center justify-center border focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40 pointer-coarse:size-11";
const headingClass = "text-foreground text-sm font-semibold";
const tabClass =
  "aria-selected:border-primary aria-selected:text-foreground text-muted-foreground focus-visible:outline-ring -mb-px h-11 cursor-pointer border-b-2 border-transparent px-5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2";

type Focus = { block: PageBlock; control: "up" | "down" | "remove" } | "add";

export function UiBuilder() {
  const [state, setState] = useState<BuilderState>(() =>
    parseBuilderQuery(globalThis.location.search)
  );
  // The frame's first URL. Later edits reach it as messages, so the URL never changes.
  // oxlint-disable-next-line react/hook-use-state -- fixed at mount, so it needs no setter
  const [initialPreview] = useState(
    () => `/ui/preview/page?${previewQuery(state)}`
  );
  const [view, setView] = useState<"edit" | "preview">("edit");
  const [width, setWidth] = useState<"desktop" | "mobile">("desktop");
  const [copied, setCopied] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const frameRef = useRef<HTMLIFrameElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const addRef = useRef<HTMLSelectElement>(null);
  const focusAfter = useRef<Focus | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const command = builderCommand(state);
  const addable = addableBlocks(state.blocks);

  // Each edit: the URL, then the frame.
  useEffect(() => {
    const query = builderQuery(state);
    globalThis.history.replaceState(
      null,
      "",
      `${globalThis.location.pathname}?${query}`
    );
    frameRef.current?.contentWindow?.postMessage(
      { type: "saasaloy-ui-compose", ...state, blocks: [...state.blocks] },
      globalThis.location.origin
    );
  }, [state]);

  // A move keeps focus on the moved block's button; a removal moves it to Add block.
  // It runs after every render and acts only when an edit asked for it.
  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === null) {
      return;
    }
    if (target === "add") {
      addRef.current?.focus();
      return;
    }
    const row = listRef.current?.querySelector<HTMLElement>(
      `[data-block="${target.block}"]`
    );
    const wanted = row?.querySelector<HTMLButtonElement>(
      `[data-control="${target.control}"]`
    );
    const fallback = row?.querySelector<HTMLButtonElement>(
      "button:not(:disabled)"
    );
    (wanted && !wanted.disabled ? wanted : fallback)?.focus();
  });

  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
    },
    []
  );

  function move(index: number, step: -1 | 1) {
    const block = state.blocks[index];
    if (block === undefined) {
      return;
    }
    focusAfter.current = { block, control: step === -1 ? "up" : "down" };
    setState(moveBlock(state, index, step));
    setAnnouncement(
      interpolate(copy.moved, { block, position: String(index + step + 1) })
    );
  }

  function remove(index: number) {
    const block = state.blocks[index];
    if (block === undefined) {
      return;
    }
    focusAfter.current = "add";
    setState(removeBlock(state, index));
    setAnnouncement(interpolate(copy.removed, { block }));
  }

  function add(block: PageBlock) {
    setState(addBlock(state, block));
    setAnnouncement(interpolate(copy.added, { block }));
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setCopied(true);
    setAnnouncement(copy.copiedAnnouncement);
    if (timer.current) {
      clearTimeout(timer.current);
    }
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        role="tablist"
        aria-label={copy.viewLabel}
        className="border-border flex border-b lg:hidden"
      >
        {(["edit", "preview"] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`builder-tab-${id}`}
            aria-selected={view === id}
            aria-controls={`builder-panel-${id}`}
            tabIndex={view === id ? 0 : -1}
            className={tabClass}
            onClick={() => setView(id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                event.preventDefault();
                const next = id === "edit" ? "preview" : "edit";
                setView(next);
                document
                  .querySelector<HTMLElement>(`#builder-tab-${next}`)
                  ?.focus();
              }
            }}
          >
            {id === "edit" ? copy.edit : copy.preview}
          </button>
        ))}
      </div>

      <div className="border-border grid border lg:grid-cols-[22rem_1fr]">
        <div
          id="builder-panel-edit"
          role="tabpanel"
          aria-labelledby="builder-tab-edit"
          className={cn(
            "border-border flex-col gap-6 p-4 sm:p-5 lg:flex lg:border-r",
            view === "edit" ? "flex" : "hidden"
          )}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="builder-template" className={headingClass}>
              {copy.template}
            </label>
            <select
              id="builder-template"
              className={selectClass}
              value={state.template}
              onChange={(event) => {
                const name = TEMPLATE_NAMES.find(
                  (template) => template === event.target.value
                );
                if (name !== undefined) {
                  setState(templateState(name));
                }
              }}
            >
              {TEMPLATE_NAMES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <span id="builder-theme" className={headingClass}>
              {copy.theme}
            </span>
            <div
              role="group"
              aria-labelledby="builder-theme"
              className="grid grid-cols-4"
            >
              {THEME_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className={cn(segmentClass, "h-14 flex-col gap-1 px-1")}
                  aria-pressed={state.theme === name}
                  onClick={() => setState({ ...state, theme: name })}
                >
                  <span
                    data-theme-sample={name}
                    className="bg-primary border-border size-3 shrink-0 border"
                    aria-hidden="true"
                  />
                  {name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <h2 id="builder-blocks" className={headingClass}>
              {copy.blocks}
            </h2>
            <ol
              ref={listRef}
              aria-labelledby="builder-blocks"
              aria-describedby="builder-blocks-note"
              className="border-border flex flex-col border"
            >
              {state.blocks.map((block, index) => {
                const kit = blockKit(state.template, block);
                return (
                  <li
                    key={block}
                    data-block={block}
                    className="border-border flex items-center gap-2 border-t px-3 py-1.5 first:border-t-0"
                  >
                    <span className="text-foreground min-w-0 flex-1 truncate font-mono text-sm">
                      {block}
                    </span>
                    <span
                      className="bg-secondary text-secondary-foreground px-1.5 font-mono text-xs leading-5"
                      aria-label={interpolate(copy.kitLabel, { kit })}
                    >
                      {kit}
                    </span>
                    <button
                      type="button"
                      data-control="up"
                      className={iconButtonClass}
                      aria-label={interpolate(copy.moveUp, { block })}
                      disabled={!canMove(state.blocks, index, -1)}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-control="down"
                      className={iconButtonClass}
                      aria-label={interpolate(copy.moveDown, { block })}
                      disabled={!canMove(state.blocks, index, 1)}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon className="size-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      data-control="remove"
                      className={iconButtonClass}
                      aria-label={interpolate(copy.remove, { block })}
                      disabled={!canRemove(state.blocks)}
                      onClick={() => remove(index)}
                    >
                      <XIcon className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
            <p
              id="builder-blocks-note"
              className="text-muted-foreground text-xs"
            >
              {copy.blocksNote}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="builder-add" className={headingClass}>
              {copy.add}
            </label>
            <select
              id="builder-add"
              ref={addRef}
              className={selectClass}
              value=""
              disabled={addable.length === 0}
              onChange={(event) => {
                const block = addable.find(
                  (name) => name === event.target.value
                );
                if (block !== undefined) {
                  add(block);
                }
              }}
            >
              <option value="" disabled>
                {addable.length === 0 ? copy.addNone : copy.addPlaceholder}
              </option>
              {addable.map((block) => (
                <option key={block} value={block}>
                  {block}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <h2 id="builder-command" className={headingClass}>
              {copy.command}
            </h2>
            <pre
              aria-labelledby="builder-command"
              className="border-border bg-background text-foreground border p-3 font-mono text-sm leading-6 break-words whitespace-pre-wrap"
              data-builder-command
            >
              {command}
            </pre>
            <button
              type="button"
              className={cn(buttonVariants(), "w-full")}
              onClick={copyCommand}
            >
              {copied ? (
                <CheckIcon className="size-4" aria-hidden="true" />
              ) : (
                <CopyIcon className="size-4" aria-hidden="true" />
              )}
              {copied ? copy.copied : copy.copy}
            </button>
          </div>
        </div>

        <div
          id="builder-panel-preview"
          role="tabpanel"
          aria-labelledby="builder-tab-preview"
          className={cn(
            "min-w-0 flex-col lg:flex",
            view === "preview" ? "flex" : "hidden"
          )}
        >
          <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="text-foreground text-base font-semibold">
              {copy.livePreview}
            </h2>
            <div role="group" aria-label={copy.widthLabel} className="flex">
              {(["desktop", "mobile"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={segmentClass}
                  aria-pressed={width === id}
                  onClick={() => setWidth(id)}
                >
                  {id === "desktop" ? copy.desktop : copy.mobile}
                </button>
              ))}
            </div>
          </div>
          <div className="bg-muted flex flex-1 justify-center">
            {/* oxlint-disable-next-line react/iframe-missing-sandbox -- a same-origin page of this site that reads its parent's mode */}
            <iframe
              ref={frameRef}
              src={initialPreview}
              title={copy.previewTitle}
              className="bg-background block h-[48rem] w-full lg:h-[calc(100svh-12rem)] lg:min-h-[36rem]"
              style={
                width === "mobile"
                  ? { maxWidth: `${MOBILE_WIDTH}px` }
                  : undefined
              }
              onLoad={() =>
                frameRef.current?.contentWindow?.postMessage(
                  {
                    type: "saasaloy-ui-compose",
                    ...state,
                    blocks: [...state.blocks],
                  },
                  globalThis.location.origin
                )
              }
            />
          </div>
        </div>
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
