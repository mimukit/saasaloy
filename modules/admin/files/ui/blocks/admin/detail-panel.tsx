import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { AttributeList } from "@repo/ui/blocks/admin/attribute-list";
import type { Attribute } from "@repo/ui/blocks/admin/attribute-list";
import { Button } from "@repo/ui/components/admin/button";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@repo/ui/components/admin/collapsible";
import { ScrollArea } from "@repo/ui/components/admin/scroll-area";
import {
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@repo/ui/components/admin/tabs";
import { cn } from "@repo/ui/lib/utils";

// The panel a selected record opens in: a header with the record's face, name and
// status, an optional banner and tab strip, then a scrolling body of attributes,
// collapsible groups, and the record's actions, and an optional pinned footer.
//
// Only the body scrolls. The header, the banner and the footer stay in view however long
// the body grows, so a warning about the record and the decision it waits on are never
// scrolled away. `actions` stays inside the body on purpose: a role select or a members
// form can be tall, and pinning it would leave no room for the record. A panel that sets
// none of `status`, `banner` and `footer` renders exactly as it did before they existed.
//
// The panel is route-owned. It holds no selection state and fetches nothing — the route
// decides which row is selected, builds the groups from it, and hands the whole panel to
// PageLayout as its `detail` node. That is what lets the same panel dock beside the list
// at desktop and fill a bottom sheet below `md` without knowing which it is in.
//
// It draws no border or panel fill of its own. PageLayout's dock and its sheet supply
// the edge, so the panel reads as one column of the content panel, not a card inside it.

export interface DetailGroup {
  /** Stable across renders; the React key and the tab-independent group identity. */
  id: string;
  label: string;
  /** An optional lucide icon component, rendered before the label. */
  icon?: ComponentType<{ className?: string }>;
  items: readonly Attribute[];
  /** Groups start open unless a caller says otherwise. */
  defaultOpen?: boolean;
}

export interface DetailTab {
  id: string;
  label: string;
  /** The tab's body. Leave it out and the tab renders an empty panel. */
  content?: ReactNode;
}

const DETAILS_TAB = "details";

export function DetailPanel({
  title,
  description,
  media,
  attributes,
  groups,
  tabs,
  actions,
  status,
  banner,
  footer,
  onOpenInNew,
  onClose,
  className,
}: {
  /** The record's name. It is the panel's heading and its accessible name. */
  title: string;
  /** A second line under the title, such as an email address. */
  description?: ReactNode;
  /** An avatar or an icon tile shown before the title. */
  media?: ReactNode;
  attributes?: readonly Attribute[];
  groups?: readonly DetailGroup[];
  /** Tabs shown after "Details". With none, the panel shows no tab strip at all. */
  tabs?: readonly DetailTab[];
  /** The record's controls, below the attributes: a role select, a destructive button. */
  actions?: ReactNode;
  /** The record's state, after the title in the header: one StatusPill, or two. */
  status?: ReactNode;
  /**
   * A note about the record, under the header and above the tabs, that does not scroll.
   * Pass an `Alert` from `ui/components/admin/alert`; the panel adds only the gutter.
   */
  banner?: ReactNode;
  /** The record's main decision, pinned under the body behind a hairline. */
  footer?: ReactNode;
  /** Renders the open-in-new action when given. Omit it and the action is gone. */
  onOpenInNew?: () => void;
  onClose: () => void;
  className?: string;
}) {
  const details = (
    <div className="flex flex-col gap-1 px-4 py-3">
      {attributes === undefined || attributes.length === 0 ? null : (
        <AttributeList items={attributes} />
      )}

      {groups?.map((group) => {
        const Icon = group.icon;

        return (
          <Collapsible
            key={group.id}
            defaultOpen={group.defaultOpen ?? true}
            className="border-border flex flex-col border-t py-1 first:border-t-0"
          >
            <CollapsibleTrigger className="group/detail-group hover:text-foreground flex min-h-8 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-medium transition-colors">
              {Icon === undefined ? null : (
                <Icon className="text-muted-foreground size-4 shrink-0" />
              )}
              <span className="min-w-0 flex-1 truncate">{group.label}</span>
              {/* The chevron follows aria-expanded, which the trigger already sets. */}
              <ChevronRightIcon className="text-muted-foreground size-4 shrink-0 group-aria-expanded/detail-group:hidden" />
              <ChevronDownIcon className="text-muted-foreground hidden size-4 shrink-0 group-aria-expanded/detail-group:block" />
            </CollapsibleTrigger>

            <CollapsiblePanel className="px-1 pb-1">
              <AttributeList items={group.items} />
            </CollapsiblePanel>
          </Collapsible>
        );
      })}

      {actions === undefined ? null : (
        <div className="border-border mt-2 flex flex-col gap-3 border-t pt-4">
          {actions}
        </div>
      )}
    </div>
  );

  return (
    <section
      aria-label={title}
      className={cn(
        "text-card-foreground flex min-h-0 w-full flex-col overflow-hidden",
        className
      )}
    >
      <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
        {media}
        <div className="min-w-0 flex-1">
          {status === undefined ? (
            <h2 className="truncate text-sm font-semibold">{title}</h2>
          ) : (
            // The title gives way to the status: it truncates, the pills never do.
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-sm font-semibold">
                {title}
              </h2>
              <span className="flex shrink-0 items-center gap-1">{status}</span>
            </div>
          )}
          {description === undefined ? null : (
            <p className="text-muted-foreground truncate text-xs">
              {description}
            </p>
          )}
        </div>

        {onOpenInNew === undefined ? null : (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Open ${title} in a new view`}
            onClick={onOpenInNew}
          >
            <ExternalLinkIcon />
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>

      {banner === undefined ? null : (
        <div className="shrink-0 px-4 pt-3">{banner}</div>
      )}

      {tabs === undefined || tabs.length === 0 ? (
        <ScrollArea className="min-h-0 flex-1">{details}</ScrollArea>
      ) : (
        <Tabs
          defaultValue={DETAILS_TAB}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <div className="shrink-0 px-4 pt-3">
            <TabsList>
              <TabsTab value={DETAILS_TAB}>Details</TabsTab>
              {tabs.map((tab) => (
                <TabsTab key={tab.id} value={tab.id}>
                  {tab.label}
                </TabsTab>
              ))}
            </TabsList>
          </div>

          <TabsPanel
            value={DETAILS_TAB}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ScrollArea className="min-h-0 flex-1">{details}</ScrollArea>
          </TabsPanel>

          {tabs.map((tab) => (
            <TabsPanel
              key={tab.id}
              value={tab.id}
              className="flex min-h-0 flex-1 flex-col"
            >
              <ScrollArea className="min-h-0 flex-1">
                <div className="px-4 py-3">{tab.content}</div>
              </ScrollArea>
            </TabsPanel>
          ))}
        </Tabs>
      )}

      {footer === undefined ? null : (
        <footer className="border-border flex shrink-0 flex-col gap-2 border-t px-4 py-3">
          {footer}
        </footer>
      )}
    </section>
  );
}
