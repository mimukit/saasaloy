import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { MAINTENANCE_KEY } from "@repo/feature-flags";
import { ErrorState } from "@repo/ui/blocks/error-state";
import { FeatureFlags } from "@repo/ui/blocks/feature-flags";

import { api } from "@admin/lib/api";

// The Flags screen. It supplies the block with rows and four callbacks and does nothing else
// — the markup lives in `@repo/ui/blocks/feature-flags`, per ADR 0030.
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: flagsQuery.queryKey }),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Flags</h1>
        <p className="text-muted-foreground text-sm">
          Toggle a feature, roll one out to a share of users, or close the site.
          A change reaches every location in about a minute.
        </p>
      </div>

      <FeatureFlags
        flags={flags.data?.flags ?? []}
        overrides={flags.data?.overrides ?? []}
        busy={write.isPending}
        error={write.error?.message ?? null}
        maintenanceKey={MAINTENANCE_KEY}
        onSave={(key, value) => write.mutate({ key, kind: "global", value })}
        onSaveOverride={(key, tenantId, value) =>
          write.mutate({ key, kind: "override", tenantId, value })
        }
        onClearOverride={(key, tenantId) =>
          write.mutate({ key, kind: "clear", tenantId })
        }
      />
    </main>
  );
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

// DESIGN.md: every app renders the `error-state` block rather than its own error markup, so
// a theme change reaches all three at once.
function FlagsError({ error, reset }: ErrorComponentProps) {
  return (
    <ErrorState
      code="500"
      title="Flags did not load"
      description={`${error.message} Check that the api is running and that you are signed in as an admin.`}
      primaryAction={{ label: "Try again", onClick: reset }}
    />
  );
}
