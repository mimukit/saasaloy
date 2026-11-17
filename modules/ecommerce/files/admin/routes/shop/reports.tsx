import { useQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import { useState } from "react";
import type { ReactNode } from "react";

import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FilterChips } from "@repo/ui/blocks/shell/filter-chips";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@repo/ui/components/shell/card";
import { DateRangePicker } from "@repo/ui/components/shell/date-picker";
import { formatDay } from "@repo/ui/lib/calendar";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { OrderStatusPill } from "@admin/components/shop/shop-pills";
import { reportQuery } from "@admin/lib/shop-api";
import type { Report, ReportRangeId } from "@admin/lib/shop-api";
import { SHOP_LOCALE, shownDay } from "@admin/lib/shop-dates";
import { ORDER_STATUSES, money, percent } from "@admin/lib/shop-format";
import { useNow } from "@admin/lib/cms-now";

// The shop's Reports at `/shop/reports`: sales by day, top products, orders by status and
// the COD figures, for one range (plan 0106, "Reports"). The api computes every figure at
// read time and counts a day from midnight in the shop's time zone. The range lives in the
// search params, so a report is a link. A custom range takes the shell's date range picker.

interface ReportSearch {
  range: ReportRangeId;
  from: string;
  to: string;
}

const RANGES: readonly { id: ReportRangeId; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 days" },
  { id: "30d", label: "30 days" },
  { id: "custom", label: "Custom" },
];

const DAY = /^\d{4}-\d{2}-\d{2}$/;

const DEFAULT_SEARCH: ReportSearch = { from: "", range: "7d", to: "" };

function parseSearch(search: Record<string, unknown>): ReportSearch {
  const range = RANGES.some((item) => item.id === search.range)
    ? (search.range as ReportRangeId)
    : "7d";
  const day = (value: unknown) =>
    typeof value === "string" && DAY.test(value) ? value : "";
  const from = day(search.from);
  const to = day(search.to);
  // A custom range with a missing end falls back to the default, so the api never gets
  // half a range.
  return range === "custom" && (from === "" || to === "")
    ? DEFAULT_SEARCH
    : { from, range, to };
}

export const Route = createFileRoute("/shop/reports")({
  validateSearch: parseSearch,
  search: { middlewares: [stripSearchParams(DEFAULT_SEARCH)] },
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureQueryData(
      reportQuery(deps.range, deps.from, deps.to)
    ),
  component: Reports,
  errorComponent: ReportsError,
});

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="gap-1 p-4">
        <CardDescription>{label}</CardDescription>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          {value}
        </p>
      </CardHeader>
    </Card>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="rounded-xl">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardPanel className="p-4 pt-0">{children}</CardPanel>
    </Card>
  );
}

/** "17 Nov" for a bar's label, from a `YYYY-MM-DD` day, in the project's locale. */
function shortDay(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(SHOP_LOCALE, {
    day: "numeric",
    month: "short",
    numberingSystem: "latn",
  }).format(new Date(year ?? 2000, (month ?? 1) - 1, date ?? 1));
}

/**
 * Sales by day as columns. The bars carry no colour of their own, only the foreground
 * tone, so the chart follows the theme; the table under it states every figure for a
 * screen reader.
 */
function SalesChart({ report }: { report: Report }) {
  const days = report.salesByDay;
  const top = Math.max(0, ...days.map((day) => day.total));
  const label = (day: (typeof days)[number]) =>
    `${shownDay(`${day.day}T00:00:00`)}: ${money(day.total, report.currency, SHOP_LOCALE)}, ${day.orders} ${day.orders === 1 ? "order" : "orders"}`;
  const showEvery = Math.ceil(days.length / 15);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs tabular-nums">
        Highest day {money(top, report.currency, SHOP_LOCALE)}
      </p>
      <div aria-hidden="true" className="flex h-48 items-end gap-1">
        {days.map((day) => (
          <div
            key={day.day}
            title={label(day)}
            className="bg-foreground/80 min-h-px flex-1 rounded-t-sm"
            style={{
              height: top === 0 ? "1px" : `${(day.total / top) * 100}%`,
            }}
          />
        ))}
      </div>
      <div aria-hidden="true" className="flex gap-1">
        {days.map((day, index) => (
          <span
            key={day.day}
            className="text-muted-foreground flex-1 truncate text-center text-[0.625rem] tabular-nums"
          >
            {index % showEvery === 0 ? shortDay(day.day) : ""}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>Sales by day</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Sales</th>
            <th scope="col">Orders</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{shownDay(`${day.day}T00:00:00`)}</th>
              <td>{money(day.total, report.currency, SHOP_LOCALE)}</td>
              <td>{day.orders}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reports() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const [custom, setCustom] = useState(search.range === "custom");
  // A custom range may end today at the latest. The shared clock ticks every minute.
  const today = formatDay(useNow(60_000));
  const [draft, setDraft] = useState({ from: search.from, to: search.to });
  const { data } = useQuery(reportQuery(search.range, search.from, search.to));

  const sales = data?.salesByDay.reduce((sum, day) => sum + day.total, 0) ?? 0;
  const orders =
    data?.salesByDay.reduce((sum, day) => sum + day.orders, 0) ?? 0;
  const currency = data?.currency ?? "BDT";
  const first = data?.salesByDay[0]?.day;
  const last = data?.salesByDay.at(-1)?.day;
  const span =
    first === undefined || last === undefined
      ? undefined
      : first === last
        ? shownDay(`${first}T00:00:00`)
        : `${shownDay(`${first}T00:00:00`)} to ${shownDay(`${last}T00:00:00`)}`;
  const cod = data?.cod;
  const codOutcomes = (cod?.delivered.count ?? 0) + (cod?.returned.count ?? 0);

  return (
    <PageLayout>
      <PageHeader title="Reports" description={span} />
      <div className="border-border flex shrink-0 flex-wrap items-end gap-3 border-b px-(--page-gutter) py-2">
        <FilterChips
          label="Report range"
          selectedId={custom ? "custom" : search.range}
          chips={RANGES}
          onSelect={(id) => {
            if (id === "custom") {
              setCustom(true);
              return;
            }
            setCustom(false);
            void navigate({
              search: { from: "", range: id as ReportRangeId, to: "" },
            });
          }}
        />
        {custom ? (
          <DateRangePicker
            id="report-range"
            size="sm"
            value={draft}
            max={today}
            clearable={false}
            fieldClassName="w-36"
            labelClassName="text-xs text-muted-foreground"
            onChange={(range) => {
              setDraft(range);
              if (range.from !== "" && range.to !== "") {
                void navigate({ search: { ...range, range: "custom" } });
              }
            }}
          />
        ) : null}
      </div>
      <PageBody className="flex flex-col gap-4">
        {data === undefined ? null : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <Stat label="Sales" value={money(sales, currency, SHOP_LOCALE)} />
              <Stat label="Orders" value={orders} />
              <Stat
                label="Average order"
                value={
                  orders === 0
                    ? "None"
                    : money(Math.round(sales / orders), currency, SHOP_LOCALE)
                }
              />
              <Stat
                label="COD collected"
                value={
                  codOutcomes === 0
                    ? "No COD outcome"
                    : `${percent(cod?.collectionRate ?? 0, SHOP_LOCALE)} of orders, ${money(cod?.collected.amount ?? 0, currency, SHOP_LOCALE)}`
                }
              />
              <Stat
                label="COD refused"
                value={`${cod?.returned.count ?? 0} ${cod?.returned.count === 1 ? "order" : "orders"} (${percent(cod?.refusalRate ?? 0, SHOP_LOCALE)})`}
              />
            </div>

            <Panel title="Sales by day">
              <SalesChart report={data} />
            </Panel>

            <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
              <Panel title="Top products">
                {data.topProducts.length === 0 ? (
                  <p className="text-muted-foreground py-4 text-sm">
                    No product sold in this range.
                  </p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="text-muted-foreground text-xs">
                      <tr className="border-border border-b">
                        <th scope="col" className="py-2 text-start font-medium">
                          Product
                        </th>
                        <th scope="col" className="py-2 text-end font-medium">
                          Units
                        </th>
                        <th scope="col" className="py-2 text-end font-medium">
                          Revenue
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.map((product) => (
                        <tr
                          key={product.productId ?? product.productTitle}
                          className="border-border border-b last:border-0"
                        >
                          <td className="py-2">{product.productTitle}</td>
                          <td className="py-2 text-end tabular-nums">
                            {product.quantity}
                          </td>
                          <td className="py-2 text-end tabular-nums">
                            {money(product.revenue, currency, SHOP_LOCALE)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
              <Panel title="Orders by status">
                <ul className="flex flex-col">
                  {ORDER_STATUSES.map((status) => (
                    <li
                      key={status}
                      className="border-border flex items-center justify-between border-b py-2 last:border-0"
                    >
                      <OrderStatusPill status={status} />
                      <span className="text-sm tabular-nums">
                        {data.ordersByStatus[status]}
                      </span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </div>
          </>
        )}
      </PageBody>
    </PageLayout>
  );
}

function ReportsError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Reports" />
      <ErrorState
        code="500"
        title="The report did not load"
        description="Check that the api is running and that the range is a real pair of days."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
