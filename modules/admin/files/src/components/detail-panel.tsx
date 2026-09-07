import {
  ChevronDownIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";

import { Button } from "@repo/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@repo/ui/components/collapsible";
import { ScrollArea } from "@repo/ui/components/scroll-area";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@repo/ui/components/tabs";
import { cn } from "@repo/ui/lib/utils";

import { AttributeList } from "@admin/components/attribute-list";
import type { Attribute } from "@admin/components/attribute-list";

// The rightmost panel of the reference: a tab strip across the top, an open-in-new and a
// close control at its right edge, then a scrolling body of collapsible attribute groups.
//
// The panel is route-owned. It holds no selection state and fetches nothing — the route
// decides which row is selected, builds the groups from it, and hands the whole panel to
// PageLayout as its `detail` node. That is what lets the same panel render as a side
// panel at desktop and inside a sheet below `md` without knowing which it is in.
//
// `attributes` are the ungrouped rows the reference stacks above the first group
// ("Assignee", "Team Inbox"). `groups` are everything below the first hairline.

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
  /**
   * The tab's body. Leave it out and the tab renders an empty panel — which is exactly
   * what the reference's second tab is until something has content to put there.
   */
  content?: ReactNode;
}

const DETAILS_TAB = "details";

export function DetailPanel({
  title,
  attributes,
  groups,
  tabs,
  onOpenInNew,
  onClose,
  className,
}: {
  /** Names the panel for a screen reader and labels the first tab's content. */
  title: string;
  attributes?: readonly Attribute[];
  groups?: readonly DetailGroup[];
  /** Tabs shown after "Details". Each one with no `content` renders an empty panel. */
  tabs?: readonly DetailTab[];
  /** Renders the open-in-new action when given. Omit it and the action is gone. */
  onOpenInNew?: () => void;
  onClose: () => void;
  className?: string;
}) {
  return (
    <section
      aria-label={title}
      className={cn(
        "bg-card text-card-foreground border-border flex min-h-0 w-full flex-col overflow-hidden rounded-xl border",
        className
      )}
    >
      <Tabs
        defaultValue={DETAILS_TAB}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <div className="border-border flex h-12 shrink-0 items-center gap-1 border-b pr-2 pl-3">
          {/* `line` is the underlined strip the reference draws, not a segmented
              control — the panel header has no room for a filled pill row. */}
          <TabsList variant="line" className="h-8 min-w-0 flex-1 justify-start">
            <TabsTrigger value={DETAILS_TAB}>Details</TabsTrigger>
            {tabs?.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id}>
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

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
        </div>

        <TabsContent
          value={DETAILS_TAB}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col px-3 py-2">
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
                    <CollapsibleTrigger
                      className={cn(
                        "group/detail-group hover:text-foreground flex min-h-8 items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-medium transition-colors"
                      )}
                    >
                      {Icon === undefined ? null : (
                        <Icon className="text-muted-foreground size-4 shrink-0" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {group.label}
                      </span>
                      {/* The chevron follows aria-expanded, which the trigger already
                          sets — the same hook nav-panel.tsx uses. */}
                      <ChevronRightIcon className="text-muted-foreground size-4 shrink-0 group-aria-expanded/detail-group:hidden" />
                      <ChevronDownIcon className="text-muted-foreground hidden size-4 shrink-0 group-aria-expanded/detail-group:block" />
                    </CollapsibleTrigger>

                    <CollapsibleContent className="px-1 pb-1">
                      <AttributeList items={group.items} />
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </ScrollArea>
        </TabsContent>

        {tabs?.map((tab) => (
          <TabsContent
            key={tab.id}
            value={tab.id}
            className="flex min-h-0 flex-1 flex-col"
          >
            <ScrollArea className="min-h-0 flex-1">
              <div className="px-3 py-2">{tab.content}</div>
            </ScrollArea>
          </TabsContent>
        ))}
      </Tabs>
    </section>
  );
}
