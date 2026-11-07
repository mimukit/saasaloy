import { createFileRoute, notFound } from "@tanstack/react-router";

import { EntryEditor } from "@admin/components/cms/entry-editor";
import { collectionFor } from "@admin/lib/cms-api";

// A new entry of any collection, at `/cms/<collection>/new`. The first Save draft or
// Publish creates it and moves the address to `/cms/<collection>/<id>`.
export const Route = createFileRoute("/cms/$collection/new")({
  beforeLoad: ({ params }) => {
    if (!collectionFor(params.collection)) {
      throw notFound();
    }
  },
  component: NewEntry,
});

function NewEntry() {
  const { collection } = Route.useParams();
  const definition = collectionFor(collection);
  return definition ? (
    <EntryEditor collection={definition} entry={undefined} />
  ) : null;
}
