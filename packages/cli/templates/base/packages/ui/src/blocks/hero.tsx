import {
  ArrowRightIcon,
  FileIcon,
  FolderIcon,
  PackageIcon,
} from "lucide-react";

import { siteName as defaultSiteName } from "@repo/ui";
import { buttonVariants } from "@repo/ui/components/button";
import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// Fully static — no state, no effects, so index.astro renders it with no `client:*`
// directive and it ships zero JavaScript. Keep it that way: adding a hook here forces
// the whole above-the-fold block into a hydrated island. The motion is CSS: `blur-in`
// from ../styles/globals.css, staggered with `--blur-in-delay`, and still under reduced
// motion.
//
// Every word comes from ../content/landing.ts. Edit the copy there, not here.
//
// THE PRODUCT VISUAL. The frame under the buttons draws a terminal from
// `landing.hero.terminalLines` and a project tree from `landing.hero.tree`. To show a
// screenshot instead, put the image in apps/web/public and replace the <Terminal />
// element below with an <img> carrying a real `alt`. Keep the frame around it: the
// border, the padding and the fade at the bottom are what make it read as the product.

type TerminalLine = (typeof landing.hero.terminalLines)[number];
type TreeEntry = (typeof landing.hero.tree)[number];

const TREE_ICONS: Record<string, typeof FileIcon> = {
  file: FileIcon,
  folder: FolderIcon,
  package: PackageIcon,
};

function treeIcon(name: string): typeof FileIcon {
  return (
    (Object.hasOwn(TREE_ICONS, name) ? TREE_ICONS[name] : undefined) ?? FileIcon
  );
}

export interface HeroAction {
  label: string;
  href: string;
}

export interface HeroProps {
  siteName?: string;
  announcement?: string;
  announcementHref?: string;
  title?: string;
  description?: string;
  primaryAction?: HeroAction;
  /** Pass `null` to render a single call to action. */
  secondaryAction?: HeroAction | null;
  terminalLines?: TerminalLine[];
  tree?: TreeEntry[];
}

// Hoisted out of the parameter list: an object literal written as a default prop is a
// fresh object on every render, which defeats memoization downstream. The labels still
// come from the content module — only the wrapper object is stable.
const DEFAULT_PRIMARY_ACTION: HeroAction = {
  label: landing.hero.primaryActionLabel,
  href: landing.hero.primaryActionHref,
};
const DEFAULT_SECONDARY_ACTION: HeroAction = {
  label: landing.hero.secondaryActionLabel,
  href: landing.hero.secondaryActionHref,
};

function Terminal({
  label,
  lines,
  tree,
}: {
  label: string;
  lines: TerminalLine[];
  tree: TreeEntry[];
}) {
  return (
    <figure className="bg-card grid overflow-hidden rounded-xl border text-left md:grid-cols-[1fr_16rem]">
      <figcaption className="sr-only">{label}</figcaption>
      <div>
        <p
          aria-hidden="true"
          className="text-muted-foreground border-b px-4 py-2.5 font-mono text-xs"
        >
          {landing.hero.terminalTitle}
        </p>
        <pre className="overflow-x-auto px-4 pt-5 pb-14 font-mono text-[0.8125rem] leading-[1.9] whitespace-pre-wrap">
          <code>
            {lines.map((line) =>
              line.kind === "command" ? (
                <span key={line.id} className="block">
                  <span aria-hidden="true" className="text-muted-foreground">
                    ${" "}
                  </span>
                  {line.text}
                </span>
              ) : (
                <span
                  key={line.id}
                  className="text-muted-foreground block pl-4"
                >
                  {line.text}
                </span>
              )
            )}
            <span
              aria-hidden="true"
              className="bg-foreground inline-block h-4 w-2 align-[-0.15rem] motion-safe:animate-pulse"
            />
          </code>
        </pre>
      </div>
      <div className="bg-muted hidden border-l p-4 md:block">
        <p className="mb-3 font-mono text-xs font-semibold">
          {landing.hero.treeTitle}
        </p>
        <ul className="flex flex-col">
          {tree.map((entry) => {
            const Icon = treeIcon(entry.icon);
            return (
              <li
                key={entry.id}
                className="flex items-center gap-2 font-mono text-xs leading-8"
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="flex-1">{entry.path}</span>
                <span className="bg-background text-muted-foreground rounded-full border px-1.5 text-[0.6875rem] leading-normal">
                  {entry.addedBy}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </figure>
  );
}

export function Hero({
  siteName = defaultSiteName,
  announcement = landing.hero.announcement,
  announcementHref = landing.hero.announcementHref,
  title = interpolate(landing.hero.title, { siteName }),
  description = interpolate(landing.hero.description, { siteName }),
  primaryAction = DEFAULT_PRIMARY_ACTION,
  secondaryAction = DEFAULT_SECONDARY_ACTION,
  terminalLines = landing.hero.terminalLines,
  tree = landing.hero.tree,
}: HeroProps) {
  return (
    <section className="relative isolate overflow-hidden pt-24 md:pt-36">
      {/* A masked grid and two soft light beams. Decoration only, drawn from tokens, so a
          theme preset recolours them with everything else. */}
      <div
        aria-hidden="true"
        className="grid-pattern absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_60%_50%_at_50%_30%,#000,transparent_75%)] [--grid-size:64px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden opacity-50 dark:opacity-100"
      >
        <span className="absolute -top-120 -left-24 h-280 w-md -rotate-45 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--foreground)_6%,transparent),transparent)]" />
        <span className="absolute -top-120 left-24 h-280 w-56 -rotate-45 rounded-full bg-[radial-gradient(closest-side,color-mix(in_oklch,var(--foreground)_5%,transparent),transparent)]" />
      </div>

      <div className="section-container-wide flex flex-col items-center gap-6 text-center">
        {announcement && (
          <a
            href={announcementHref}
            className="group bg-background hover:bg-muted blur-in flex items-center gap-4 rounded-full border py-1 pr-1 pl-4 text-sm shadow-md shadow-black/5 transition-colors"
          >
            <span className="shine-text">{announcement}</span>
            <span aria-hidden="true" className="bg-border h-4 w-px" />
            <span
              aria-hidden="true"
              className="bg-muted group-hover:bg-background size-6 overflow-hidden rounded-full transition-colors"
            >
              <span className="flex w-12 -translate-x-1/2 transition-transform duration-500 group-hover:translate-x-0">
                <ArrowRightIcon className="m-1.5 size-3" />
                <ArrowRightIcon className="m-1.5 size-3" />
              </span>
            </span>
          </a>
        )}

        <h1 className="text-display blur-in max-w-[16ch] text-balance [--blur-in-delay:100ms]">
          {title}
        </h1>
        <p className="text-lead text-muted-foreground blur-in max-w-2xl text-balance [--blur-in-delay:200ms]">
          {description}
        </p>

        <div className="blur-in mt-2 flex flex-wrap items-center justify-center gap-2 [--blur-in-delay:300ms]">
          <span className="bg-foreground/5 rounded-[calc(var(--radius)+4px)] border p-0.5">
            <a
              href={primaryAction.href}
              className={cn(buttonVariants({ size: "lg" }), "h-10 px-4")}
            >
              {primaryAction.label}
            </a>
          </span>
          {secondaryAction && (
            <a
              href={secondaryAction.href}
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "h-10 px-4"
              )}
            >
              {secondaryAction.label}
            </a>
          )}
        </div>
      </div>

      <div className="section-container-wide mt-12 md:mt-20">
        <div className="blur-in [mask-image:linear-gradient(to_bottom,#000_60%,transparent)] [--blur-in-delay:450ms]">
          <div className="max-w-page bg-background mx-auto rounded-[1.25rem] border p-3 shadow-[0_30px_60px_-20px_color-mix(in_oklch,var(--foreground)_15%,transparent)]">
            <Terminal
              label={interpolate(landing.hero.terminalLabel, { siteName })}
              lines={terminalLines}
              tree={tree}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
