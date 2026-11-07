import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { ErrorState } from "@repo/ui/blocks/shell/error-state";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { EntryEditor } from "@admin/components/cms/entry-editor";
import { CmsRequestError, collectionFor, entryQuery } from "@admin/lib/cms-api";

// One stored entry of any collection, at `/cms/<collection>/<id>`. The loader reads the
// entry; the editor keeps its own copy from then on, so a background refetch never
// overwrites what the admin is typing. A conflict is shown by the editor, not here.
export const Route = createFileRoute("/cms/$collection/$entryId")({
  loader: async ({ context, params }) => {
    if (!collectionFor(params.collection)) {
      throw notFound();
    }
    try {
      return await context.queryClient.ensureQueryData(
        entryQuery(params.collection, params.entryId)
      );
    } catch (error) {
      if (error instanceof CmsRequestError && error.status === 404) {
        throw notFound();
      }
      throw error;
    }
  },
  component: StoredEntry,
  errorComponent: StoredEntryError,
});

function StoredEntry() {
  const { collection, entryId } = Route.useParams();
  const { data } = useQuery(entryQuery(collection, entryId));
  const definition = collectionFor(collection);
  if (!data || !definition) {
    return null;
  }
  // Keyed by id, so moving from a new entry to its stored address keeps one editor, and
  // opening another entry starts a fresh one.
  return <EntryEditor key={data.id} collection={definition} entry={data} />;
}

function StoredEntryError({ error, reset }: ErrorComponentProps) {
  return (
    <PageLayout>
      <PageHeader title="Content" />
      <ErrorState
        code="500"
        title="The entry did not load"
        description="Check that the api is running and that you are signed in as an admin."
        detail={error instanceof Error ? error.message : undefined}
        primaryAction={{ label: "Try again", onClick: reset }}
        secondaryAction={null}
      />
    </PageLayout>
  );
}
