import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { HistoryIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { DetailPanel } from "@repo/ui/blocks/shell/detail-panel";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Avatar, AvatarFallback } from "@repo/ui/components/shell/avatar";
import { Button } from "@repo/ui/components/shell/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/shell/input-group";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/shell/select";
import { Skeleton } from "@repo/ui/components/shell/skeleton";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/shell/table";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
import { errors } from "@repo/ui/content/errors";
import { useCommands } from "@repo/ui/lib/shell/commands";
import type { Command } from "@repo/ui/lib/shell/commands";

import {
  ACTIVITY_RANGES,
  RANGE_LABELS,
  activitySearch,
  changeRows,
  exactTime,
  isActivityRange,
  searchOf,
  valueText,
  whenLabel,
} from "@admin/lib/activity";
import type { ActivityRange } from "@admin/lib/activity";
import { activityPeopleQuery, activityQuery } from "@admin/lib/activity-query";
import type { ActivityEvent } from "@admin/lib/activity-query";
import { initialsOf } from "@admin/lib/initials";

// The Activity page at `/activity`: the admin audit log. Every change an admin made
// through an admin write route, newest first, 50 rows a page with "Load older". The
// person, the area and the date range live in the address (`validateSearch`), so a link
// such as the Members panel's `/activity?actor=<id>` opens it filtered. The search box
// narrows by target label on the api, a moment after the typing stops.
//
// A row shows the plain words the api sends with it (`label`, from the action's entry in
// the module's action file). The raw action key shows in the detail panel only, beside
// the change field by field.

export const Route = createFileRoute("/activity")({
  validateSearch: activitySearch,
  component: Activity,
  errorComponent: ActivityError,
});

/** The person menu's value for everyone: a Select item needs a string. */
const EVERYONE = "everyone";

const RANGE_ITEMS = ACTIVITY_RANGES.map((range) => ({
  label: RANGE_LABELS[range],
  value: range,
}));

/** The search box's text, a moment after the typing stops. */
function useSettled(text: string, delayMs = 300): string {
  const [settled, setSettled] = useState(text);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(text);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [text, delayMs]);
  return settled;
}

function Person({ event }: { event: ActivityEvent }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className="size-6">
        <AvatarFallback className="text-[0.625rem]">
          {initialsOf(event.actor.name)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate">{event.actor.name}</span>
    </div>
  );
}

const COLUMNS: readonly DataTableColumn<ActivityEvent>[] = [
  {
    id: "when",
    header: "When",
    card: "trailing",
    value: (event) => new Date(event.createdAt),
    cell: (event) => (
      <time
        dateTime={event.createdAt}
        className="text-muted-foreground tabular-nums"
      >
        {whenLabel(event.createdAt, new Date())}
      </time>
    ),
  },
  {
    id: "who",
    header: "Who",
    value: (event) => event.actor.name,
    cell: (event) => <Person event={event} />,
  },
  {
    id: "action",
    header: "Action",
    card: "title",
    value: (event) => event.label,
  },
  {
    id: "target",
    header: "Target",
    value: (event) => event.target.label,
  },
];

function ChangeTable({ event }: { event: ActivityEvent }) {
  const rows = changeRows(
    event.before as Record<string, unknown> | null,
    event.after as Record<string, unknown> | null
  );
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">What changed</h3>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No field is stored for this change.
        </p>
      ) : (
        <Table className="font-mono text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Field</TableHead>
              <TableHead>Before</TableHead>
              <TableHead>After</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.field}>
                <TableCell className="align-top">{row.field}</TableCell>
                <TableCell className="text-destructive-foreground align-top break-words whitespace-normal">
                  {valueText(row.before)}
                </TableCell>
                <TableCell className="text-success-foreground align-top break-words whitespace-normal">
                  {valueText(row.after)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function EventDetail({
  event,
  onClose,
}: {
  event: ActivityEvent;
  onClose: () => void;
}) {
  return (
    <DetailPanel
      title={event.label}
      onClose={onClose}
      attributes={[
        { label: "When", value: exactTime(event.createdAt) },
        {
          label: "Who",
          value: (
            <span className="flex items-center gap-1.5">
              {event.actor.name}
              <StatusPill label={event.actor.role} tone="open" />
            </span>
          ),
        },
        { label: "Target", value: event.target.label },
        {
          label: "Action",
          value: <span className="font-mono text-xs">{event.action}</span>,
        },
      ]}
      actions={<ChangeTable event={event} />}
    />
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-(--page-gutter) py-4" aria-hidden>
      {[0, 1, 2, 3].map((key) => (
        <div key={key} className="flex items-center gap-8">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
      ))}
    </div>
  );
}

function Activity() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const area = search.area ?? "all";
  const range: ActivityRange = search.range ?? "7d";
  const { actor } = search;
  const [text, setText] = useState("");
  const q = useSettled(text);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const log = useInfiniteQuery(activityQuery({ actor, area, q, range }));
  const people = useQuery(activityPeopleQuery);

  const events = useMemo(
    () => log.data?.pages.flatMap((page) => page.events) ?? [],
    [log.data]
  );
  const first = log.data?.pages[0];
  const selected = events.find((event) => event.id === selectedId);

  const chips = [
    { count: first?.counts.all, id: "all", label: "All" },
    ...(first?.areas ?? []).map((item) => ({
      count: first?.counts[item.id],
      id: item.id,
      label: item.label,
    })),
  ];

  const personItems = [
    { label: "Everyone", value: EVERYONE },
    ...(people.data?.people ?? []).map((person) => ({
      label: person.removed ? `${person.name} (removed)` : person.name,
      value: person.id,
    })),
  ];
  const personName =
    personItems.find((item) => item.value === actor)?.label ?? "Everyone";

  const filtered =
    actor !== undefined || area !== "all" || range !== "7d" || q !== "";
  const clearFilters = () => {
    setText("");
    setSelectedId(null);
    void navigate({ search: {} });
  };
  const go = (next: {
    actor?: string;
    area?: string;
    range?: ActivityRange;
  }) => {
    setSelectedId(null);
    void navigate({
      search: searchOf(
        "actor" in next ? next.actor : actor,
        next.area ?? area,
        next.range ?? range
      ),
    });
  };

  const commands: Command[] = [
    {
      id: "admin.clear-activity-filters",
      title: "Clear activity filters",
      group: "page",
      when: () => filtered,
      run: clearFilters,
    },
    {
      id: "admin.close-activity-details",
      title: "Close activity details",
      group: "page",
      when: () => selectedId !== null,
      run: () => {
        setSelectedId(null);
      },
    },
  ];
  useCommands(commands, { scope: "route", label: "Activity" });

  const who = actor === undefined ? "anyone" : personName;
  const when = range === "all" ? "" : ` ${RANGE_LABELS[range].toLowerCase()}`;
  const what = q === "" ? "" : ` matches “${q}”`;

  let body;
  if (log.isError) {
    body = (
      <ErrorState
        code={errors.renderFailure.code}
        title="The activity did not load"
        description="GET /admin/audit-events answers 403 unless the signed-in account is an admin or a superadmin, and 500 when the api fails."
        detail={log.error.message}
        primaryAction={{
          label: errors.renderFailure.retryLabel,
          onClick: () => {
            void log.refetch();
          },
        }}
        secondaryAction={null}
      />
    );
  } else if (log.data === undefined) {
    body = <ListSkeleton />;
  } else {
    body = (
      <>
        <DataTable
          caption="Admin changes, newest first, with who made each one, the action and its target."
          columns={COLUMNS}
          rows={events}
          rowId={(event) => event.id}
          selectedId={selectedId}
          onRowClick={(event) => {
            setSelectedId(event.id);
          }}
          onDismiss={() => {
            setSelectedId(null);
          }}
          emptyState={
            <EmptyState
              icon={HistoryIcon}
              title="No activity matches"
              description={
                filtered
                  ? `Nothing ${who} did${when}${what === "" ? " matches" : what}.`
                  : "A change an admin makes shows here."
              }
              action={
                filtered ? (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
        {log.hasNextPage ? (
          <div className="flex shrink-0 justify-center px-(--page-gutter) py-3">
            <Button
              variant="outline"
              size="sm"
              disabled={log.isFetchingNextPage}
              onClick={() => {
                void log.fetchNextPage();
              }}
            >
              {log.isFetchingNextPage ? "Loading…" : "Load older"}
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <PageLayout
      detailLabel={selected?.label}
      onDetailClose={() => {
        setSelectedId(null);
      }}
      detail={
        selected === undefined ? undefined : (
          <EventDetail
            event={selected}
            onClose={() => {
              setSelectedId(null);
            }}
          />
        )
      }
    >
      <PageHeader title="Activity" description={RANGE_LABELS[range]} />

      <div className="border-border flex shrink-0 flex-col gap-2 border-b px-(--page-gutter) py-2">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="max-w-60">
            <InputGroupAddon>
              <SearchIcon aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search target"
              placeholder="Search target"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
              }}
            />
          </InputGroup>
          <Select
            value={actor ?? EVERYONE}
            items={personItems}
            onValueChange={(next: string | null) => {
              if (next !== null) {
                go({ actor: next === EVERYONE ? undefined : next });
              }
            }}
          >
            <SelectTrigger aria-label="Person" className="w-auto min-w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {personItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <Select
            value={range}
            items={RANGE_ITEMS}
            onValueChange={(next: string | null) => {
              if (next !== null && isActivityRange(next)) {
                go({ range: next });
              }
            }}
          >
            <SelectTrigger aria-label="Date range" className="w-auto min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {RANGE_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <FilterChips
          chips={chips}
          selectedId={area}
          label="Filter the activity by area"
          onSelect={(id) => {
            go({ area: id });
          }}
        />
      </div>

      {body}
    </PageLayout>
  );
}

function ActivityError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Activity" />
      <ErrorState
        code={errors.renderFailure.code}
        title="The activity did not load"
        description="GET /admin/audit-events answers 403 unless the signed-in account is an admin or a superadmin, and 500 when the api fails."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{
          label: errors.renderFailure.retryLabel,
          onClick: reset,
        }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
