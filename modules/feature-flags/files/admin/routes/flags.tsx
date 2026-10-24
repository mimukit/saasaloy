import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { MAINTENANCE_KEY } from "@repo/feature-flags";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { FeatureFlags } from "@repo/ui/blocks/admin/feature-flags";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageBody } from "@repo/ui/containers/shell/page-body";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { api } from "@admin/lib/api";

// The Flags screen. It renders the page header and supplies the block with rows and four
// callbacks — the editor's markup lives in `@repo/ui/blocks/admin/feature-flags`, per ADR
// 0030. It renders inside the page frame the root route provides, so it writes no padding
// and no page width of its own. The toggle list is an editor, not a list of records, so it
// sits in PageBody rather than in a DataTable.
//
// Every value on this screen comes from `GET /flags`, which reads the database directly. The
// published kv document is deliberately up to ~70 seconds behind, and showing an operator a
// stale copy of the switch they just moved is the failure this whole split exists to
// prevent. The cost is that the number here can be *ahead* of what a live request sees, for
// about a minute after a toggle. That is the right way round.

interface FlagsPayload {
  flags: {
    key: string;
    type: "boolean" | "percentage";
    description: string | null;
    enabled: boolean;
    percentage: number | null;
    codeDefault: boolean;
    hasRow: boolean;
  }[];
  overrides: {
    flagKey: string;
    tenantId: string;
    enabled: boolean;
    percentage: number | null;
  }[];
}

const flagsQuery = queryOptions({
  queryKey: ["flags"],
  queryFn: async (): Promise<FlagsPayload> => {
    const response = await api.flags.$get();
    if (!response.ok) {
      throw new Error("The api refused the flag list.");
    }
    return (await response.json()) as FlagsPayload;
  },
});

export const Route = createFileRoute("/flags")({
  loader: ({ context }) => context.queryClient.ensureQueryData(flagsQuery),
  component: Flags,
  errorComponent: FlagsError,
});

interface FlagValueInput {
  enabled: boolean;
  percentage: number | null;
}

type Write =
  | { kind: "global"; key: string; value: FlagValueInput }
  | { kind: "override"; key: string; tenantId: string; value: FlagValueInput }
  | { kind: "clear"; key: string; tenantId: string };

function Flags() {
  const queryClient = useQueryClient();
  const flags = useQuery(flagsQuery);

  // One mutation for all three writes. They differ only in which request they send, and
  // three mutations would mean three `isPending` flags for one "is anything saving" question.
  const write = useMutation({
    mutationFn: async (input: Write) => {
      const response = await sendWrite(input);
      if (!response.ok) {
        throw new Error(
          `The api refused the change (${String(response.status)}).`
        );
      }
    },
    // Each result raises a toast, the failure included: the switch shows the server's value,
    // so a refused write would otherwise look like a click that did nothing. The invalidation
    // is still awaited, so `isPending` holds the controls until the refetch lands.
    onSuccess: async (_data, input) => {
      toastManager.add({ type: "success", ...describeWrite(input) });
      await queryClient.invalidateQueries({ queryKey: flagsQuery.queryKey });
    },
    onError: (error) => {
      toastManager.add({
        type: "error",
        title: "The change did not save",
        description: error.message,
      });
    },
  });

  return (
    // No `detail` prop: a flag has nothing more to show than its card, so PageLayout
    // renders a single column.
    <PageLayout>
      <PageHeader
        title="Flags"
        count={flags.data?.flags.length}
        description="Toggle a feature, roll one out to a share of users, or close the site. A change reaches every location in about a minute."
      />

      <PageBody>
        <FeatureFlags
          flags={flags.data?.flags ?? []}
          overrides={flags.data?.overrides ?? []}
          busy={write.isPending}
          maintenanceKey={MAINTENANCE_KEY}
          onSave={(key, value) => {
            write.mutate({ key, kind: "global", value });
          }}
          onSaveOverride={(key, tenantId, value) => {
            write.mutate({ key, kind: "override", tenantId, value });
          }}
          onClearOverride={(key, tenantId) => {
            write.mutate({ key, kind: "clear", tenantId });
          }}
        />
      </PageBody>
    </PageLayout>
  );
}

// The words for a saved write. The maintenance flag gets its own, because "Saved
// system.maintenance" hides that the whole site just closed or reopened.
function describeWrite(input: Write): { title: string; description: string } {
  const reach = "It reaches every location in about a minute.";
  if (input.kind === "clear") {
    return {
      title: "Override cleared",
      description: `${input.tenantId} inherits the global ${input.key} again. ${reach}`,
    };
  }
  if (input.kind === "override") {
    return {
      title: "Override saved",
      description: `${input.key} for ${input.tenantId}. ${reach}`,
    };
  }
  if (input.key === MAINTENANCE_KEY) {
    return {
      title: input.value.enabled ? "Site closed" : "Site reopened",
      description: reach,
    };
  }
  return {
    title: `${input.key} is ${input.value.enabled ? "on" : "off"}`,
    description:
      input.value.percentage === null
        ? reach
        : `Rollout ${String(input.value.percentage)}%. ${reach}`,
  };
}

function sendWrite(input: Write) {
  if (input.kind === "global") {
    return api.flags[":key"].$put({
      json: input.value,
      param: { key: input.key },
    });
  }
  if (input.kind === "override") {
    return api.flags[":key"].tenants[":tenantId"].$put({
      json: input.value,
      param: { key: input.key, tenantId: input.tenantId },
    });
  }
  return api.flags[":key"].tenants[":tenantId"].$delete({
    param: { key: input.key, tenantId: input.tenantId },
  });
}

// The router's default error screen would do, but these words name the two likely causes.
// The header stays, so a failed load still reads as the Flags page inside the shell.
function FlagsError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Flags" />
      <ErrorState
        code="500"
        title="Flags did not load"
        description="Check that the api is running and that you are signed in as an admin."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
