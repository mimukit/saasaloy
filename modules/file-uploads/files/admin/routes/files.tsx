import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";

import { ErrorState } from "@repo/ui/blocks/error-state";
import { FileUploads } from "@repo/ui/blocks/file-uploads";
import type { FileRow } from "@repo/ui/blocks/file-uploads";

import { api } from "@admin/lib/api";

// The Files screen. It supplies the block with rows and three callbacks and does nothing
// else — the markup lives in `@repo/ui/blocks/file-uploads`, per ADR 0030.
//
// The upload it runs is three steps, and they are here rather than in the block because
// the middle one is a raw `fetch` to whatever origin the api named:
//
//   1. `POST /files/uploads` records the intent and returns an upload target.
//   2. The browser PUTs the bytes to that target. It is a presigned vendor URL when the
//      provider can sign one, and the capability's own proxy route when it cannot, and
//      this step is written once for both — that is the whole point of `UploadTarget`.
//   3. `POST /files/uploads/:id/complete` heads the real object and marks the row `ready`.
//
// The PUT carries no credentials. The target is authorized by its own signature or token,
// so `credentials: "omit"` is deliberate: sending the session cookie to a vendor origin
// would leak it, and the presigned URL would refuse the extra header anyway.

interface FilesPayload {
  objects: FileRow[];
  cursor?: string;
  settings: { publicUploads: boolean; imageTransforms: boolean };
}

const filesQuery = queryOptions({
  queryKey: ["files"],
  queryFn: async (): Promise<FilesPayload> => {
    const response = await api.files.$get({ query: {} });
    if (!response.ok) {
      throw new Error("The api refused the file list.");
    }
    return (await response.json()) as FilesPayload;
  },
});

export const Route = createFileRoute("/files")({
  loader: ({ context }) => context.queryClient.ensureQueryData(filesQuery),
  component: Files,
  errorComponent: FilesError,
});

type Write =
  | { kind: "upload"; file: File; visibility: "private" | "public" }
  | { kind: "download"; id: string }
  | { kind: "delete"; id: string };

function Files() {
  const queryClient = useQueryClient();
  const files = useQuery(filesQuery);

  // One mutation for all three actions. They differ only in which requests they send, and
  // three mutations would mean three `isPending` flags for one "is anything running"
  // question.
  const write = useMutation({
    mutationFn: (input: Write) => send(input),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: filesQuery.queryKey }),
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Files</h1>
        <p className="text-muted-foreground text-sm">
          Everything this tenant has uploaded. A private file is served through
          a signed link that expires; a public one has a stable URL anyone with
          it can read.
        </p>
      </div>

      <FileUploads
        files={files.data?.objects ?? []}
        busy={write.isPending}
        error={write.error?.message ?? null}
        imageTransforms={files.data?.settings.imageTransforms ?? false}
        publicUploads={files.data?.settings.publicUploads ?? false}
        onUpload={(file, visibility) =>
          write.mutate({ file, kind: "upload", visibility })
        }
        onDownload={(id) => write.mutate({ id, kind: "download" })}
        onDelete={(id) => write.mutate({ id, kind: "delete" })}
      />
    </main>
  );
}

async function send(input: Write): Promise<void> {
  if (input.kind === "delete") {
    const response = await api.files[":id"].$delete({
      param: { id: input.id },
    });
    if (!response.ok) {
      throw new Error(await refusal(response, "delete that file"));
    }
    return;
  }

  if (input.kind === "download") {
    const response = await api.files[":id"].download.$get({
      param: { id: input.id },
    });
    if (!response.ok) {
      throw new Error(await refusal(response, "issue a download link"));
    }
    const target = (await response.json()) as { url: string };
    globalThis.open(target.url, "_blank", "noreferrer");
    return;
  }

  const started = await api.files.uploads.$post({
    json: {
      contentType: input.file.type || "application/octet-stream",
      filename: input.file.name,
      size: input.file.size,
      visibility: input.visibility,
    },
  });
  if (!started.ok) {
    throw new Error(await refusal(started, "accept that upload"));
  }
  const { id, upload } = (await started.json()) as {
    id: string;
    upload: { url: string; method: "PUT"; headers: Record<string, string> };
  };

  const put = await globalThis.fetch(upload.url, {
    body: input.file,
    credentials: "omit",
    headers: upload.headers,
    method: upload.method,
  });
  if (!put.ok) {
    throw new Error(
      `The storage target refused the file (${String(put.status)}).`
    );
  }

  const completed = await api.files.uploads[":id"].complete.$post({
    param: { id },
  });
  if (!completed.ok) {
    throw new Error(await refusal(completed, "accept the uploaded file"));
  }
}

/**
 * The api's `{ error: { message } }` envelope, or the status when the body is not one.
 *
 * Structurally typed rather than taking a `Response`, because `hc` hands back its own
 * `ClientResponse`, which carries the route's response type and not the two Workers-only
 * fields a `Response` declares.
 */
async function refusal(
  response: { json: () => Promise<unknown>; status: number },
  action: string
): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    if (body.error?.message) {
      return body.error.message;
    }
  } catch {
    // Fall through to the status.
  }
  return `The api refused to ${action} (${String(response.status)}).`;
}

// DESIGN.md: every app renders the `error-state` block rather than its own error markup,
// so a theme change reaches all three at once.
function FilesError({ error, reset }: ErrorComponentProps) {
  return (
    <ErrorState
      code="500"
      title="Files did not load"
      description={`${error.message} Check that the api is running, that STORAGE_PROVIDER names an installed provider, and that you are signed in.`}
      primaryAction={{ label: "Try again", onClick: reset }}
    />
  );
}
