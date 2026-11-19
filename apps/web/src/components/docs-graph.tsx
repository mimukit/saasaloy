import { useState } from "react";

import type { GraphData, GraphModule } from "@web/lib/docs-blocks-data";
import { cn } from "@web/lib/utils";

// The `saasaloy-graph` block's island (plan 0114 Phase 4). The remark plugin in
// lib/docs-blocks.ts writes the same facts as a plain list, which a reader without
// JavaScript keeps; lib/docs-blocks-client.ts mounts this component over that list. From
// 48rem (`md`) the drawing shows the selected module between what it depends on and its
// providers or drivers, and the panel names them again. Below 48rem the drawing is
// `display: none`: the reader gets the list of modules and the panel, which carry every
// fact the drawing does. The drawing is aria-hidden and its nodes are out of the tab order,
// so the list is the one control a keyboard or a screen reader uses.

/** Nodes one side of the drawing shows before "+N more". The panel lists them all. */
const DRAWN = 6;

const chip =
  "press border-border bg-card hover:bg-muted inline-flex h-8 items-center border px-2 font-mono text-[13px] leading-none";
const chipOn =
  "border-primary bg-primary text-primary-foreground hover:bg-primary";

function ModuleButton({
  name,
  selected,
  onPick,
  hidden = false,
  className,
}: {
  name: string;
  selected: boolean;
  onPick: (name: string) => void;
  /** A drawing node: out of the tab order, since the list holds the accessible control. */
  hidden?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={hidden ? undefined : selected}
      tabIndex={hidden ? -1 : undefined}
      className={cn(chip, selected && chipOn, className)}
      onClick={() => {
        onPick(name);
      }}
    >
      {name}
    </button>
  );
}

/** One side of the drawing: a rail with a stub to each node. */
function Side({
  side,
  children,
  more,
}: {
  side: "left" | "right";
  children: React.ReactNode[];
  more: number;
}) {
  if (children.length === 0) {
    return (
      <span className="text-muted-foreground font-mono text-xs">none</span>
    );
  }
  const left = side === "left";
  return (
    <div
      className={cn(
        "relative flex flex-col gap-3",
        "after:bg-border after:absolute after:inset-y-4 after:w-px after:content-['']",
        left ? "items-end pr-5 after:right-0" : "items-start pl-5 after:left-0"
      )}
    >
      {children.map((child, index) => (
        <div
          // The drawing's order is fixed, so the index is the identity.
          // oxlint-disable-next-line react/no-array-index-key
          key={index}
          className={cn(
            "relative",
            left
              ? "after:bg-border after:absolute after:top-1/2 after:left-full after:h-px after:w-5 after:content-['']"
              : "before:bg-border before:absolute before:top-1/2 before:right-full before:h-px before:w-5 before:content-['']"
          )}
        >
          {child}
        </div>
      ))}
      {more > 0 && (
        <span className="text-muted-foreground font-mono text-xs">
          +{more} more
        </span>
      )}
    </div>
  );
}

function Drawing({
  current,
  onPick,
}: {
  current: GraphModule;
  onPick: (name: string) => void;
}) {
  const needs = current.needs.slice(0, DRAWN);
  const variants = current.variants.slice(0, DRAWN);
  const usedBy = current.usedBy.slice(0, Math.max(0, DRAWN - variants.length));
  const rightCount = variants.length + usedBy.length;
  const rightMore =
    current.variants.length + current.usedBy.length - rightCount;
  return (
    <div
      aria-hidden="true"
      className="hidden min-h-64 grid-cols-[1fr_auto_1fr] items-center gap-x-5 p-6 md:grid"
    >
      <div className="flex justify-end">
        <Side side="left" more={current.needs.length - needs.length}>
          {needs.map((name) => (
            <ModuleButton
              key={name}
              name={name}
              selected={false}
              onPick={onPick}
              hidden
            />
          ))}
        </Side>
      </div>
      <span
        className={cn(
          chip,
          chipOn,
          "relative",
          needs.length > 0 &&
            "before:bg-border before:absolute before:top-1/2 before:right-full before:h-px before:w-5 before:content-['']",
          rightCount > 0 &&
            "after:bg-border after:absolute after:top-1/2 after:left-full after:h-px after:w-5 after:content-['']"
        )}
      >
        {current.name}
      </span>
      <div className="flex justify-start">
        <Side side="right" more={rightMore}>
          {[
            ...variants.map((variant) => (
              <span key={variant.name} className={cn(chip, "border-highlight")}>
                {variant.name}
              </span>
            )),
            ...usedBy.map((name) => (
              <ModuleButton
                key={name}
                name={name}
                selected={false}
                onPick={onPick}
                hidden
                className="border-dashed"
              />
            )),
          ]}
        </Side>
      </div>
    </div>
  );
}

function PanelGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <p className="text-muted-foreground font-mono text-xs uppercase">
        {label}
      </p>
      <ul className="saasaloy-list mt-1.5 flex flex-wrap gap-1.5">
        {children}
      </ul>
    </div>
  );
}

function PanelNone() {
  return <li className="text-muted-foreground font-mono text-xs">None</li>;
}

export function DocsGraph({ data }: { data: GraphData }) {
  const [selected, setSelected] = useState(data.selected);
  const current =
    data.modules.find((item) => item.name === selected) ?? data.modules[0];
  if (!current) {
    return null;
  }
  const providers = current.variants.filter((v) => v.tier === "provider");
  const drivers = current.variants.filter((v) => v.tier === "driver");
  return (
    <div className="border-border bg-card grid border md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="min-w-0">
        <Drawing current={current} onPick={setSelected} />
        <nav aria-label="Modules" className="md:border-border p-4 md:border-t">
          <ul className="saasaloy-list flex flex-wrap gap-1.5">
            {data.modules.map((item) => (
              <li key={item.name}>
                <ModuleButton
                  name={item.name}
                  selected={item.name === current.name}
                  onPick={setSelected}
                />
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <section
        aria-label="Selected module"
        aria-live="polite"
        className="border-border border-t p-4 md:border-t-0 md:border-l"
      >
        <p className="font-mono text-base font-semibold">{current.name}</p>
        <p className="text-muted-foreground mt-1 text-sm">
          {current.description}
        </p>
        <PanelGroup label="Depends on">
          {current.needs.length === 0 && <PanelNone />}
          {current.needs.map((name) => (
            <li key={name}>
              <ModuleButton name={name} selected={false} onPick={setSelected} />
            </li>
          ))}
        </PanelGroup>
        <PanelGroup label="Used by">
          {current.usedBy.length === 0 && <PanelNone />}
          {current.usedBy.map((name) => (
            <li key={name}>
              <ModuleButton name={name} selected={false} onPick={setSelected} />
            </li>
          ))}
        </PanelGroup>
        {providers.length > 0 && (
          <PanelGroup label="Providers">
            {providers.map((variant) => (
              <li key={variant.name} className={cn(chip, "border-highlight")}>
                {variant.name}
              </li>
            ))}
          </PanelGroup>
        )}
        {drivers.length > 0 && (
          <PanelGroup label="Drivers">
            {drivers.map((variant) => (
              <li key={variant.name} className={cn(chip, "border-highlight")}>
                {variant.name}
              </li>
            ))}
          </PanelGroup>
        )}
      </section>
    </div>
  );
}
