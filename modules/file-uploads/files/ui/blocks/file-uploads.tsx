import { useState } from "react";
import type { SubmitEvent } from "react";

import { Badge } from "@repo/ui/components/badge";
import { Button, buttonVariants } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { FileDrop } from "@repo/ui/components/file-drop";
import type { FileDropLabels } from "@repo/ui/components/file-drop";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@repo/ui/components/table";
import { interpolate } from "@repo/ui/lib/interpolate";
import { imageUrl } from "@repo/ui/lib/public-image";
import { cn } from "@repo/ui/lib/utils";

// The Files screen's markup, and nothing else.
//
// **This block knows nothing about the network.** It takes the rows and three callbacks
// and calls them. Which client sends the upload, where the PUT goes, and what a failure
// means are the app's business, so `packages/ui` imports no api package and no http
// client — the same rule the waitlist and flags blocks follow.
// `apps/admin/src/routes/files.tsx` supplies the functions.
//
// The three-step upload the callbacks hide is worth knowing about anyway, because it is
// why `onUpload` takes a whole `File` rather than a form value: the app asks the api for a
// target, PUTs the bytes straight to it, then calls `complete`. The bytes never pass
// through this component.
//
// Several files go up in one submit. The block calls `onUpload` once per file, in order,
// and waits for each before it starts the next, so a failure stops the run with the
// remaining files still in the list. `FileDrop` comes from the `storage` module.

/** `STORAGE_MAX_UPLOAD_BYTES`'s default, 100 MiB. */
const DEFAULT_MAX_BYTES = 104_857_600;

/** The FileDrop copy for this screen. */
const dropLabels: FileDropLabels = {
  prompt: "Drop files here, or {action}",
  action: "choose them",
  dropActive: "Drop them to add them",
  hint: "Up to {max} files, {size} MB each",
  addMore: "Add more, or drop files here",
  sizeKb: "{size} KB",
  sizeMb: "{size} MB",
  remove: "Remove {name}",
  progress: "{done} of {total} MB · {percent}%",
  badType: "{name} is not a type this screen takes.",
  empty: "{name} is empty.",
  tooLarge: "{name} is over the {max} MB limit.",
  tooMany: "You can upload at most {max} files at once. {name} was not added.",
};

export interface FileRow {
  id: string;
  key: string;
  /** The name the user gave the file, recovered from the key's last segment. */
  filename: string;
  contentType: string;
  size: number;
  visibility: "private" | "public";
  status: string;
  createdAt: string;
  /** Present on a public row only: the world-readable URL that serves the object. */
  url?: string;
}

export interface FileUploadsProps {
  files: FileRow[];
  /**
   * Ask the app to run one upload. Return a promise that settles once the file is
   * `ready`, so the block can start the next file; a rejection stops the run.
   */
  onUpload: (
    file: File,
    visibility: "private" | "public"
  ) => void | Promise<void>;
  /** Ask the app for a signed link and follow it. Private rows only. */
  onDownload: (id: string) => void;
  onDelete: (id: string) => void;
  /** Set while a call is in flight, so the controls can refuse a second click. */
  busy?: boolean;
  /** Shown above the list when the last action failed. */
  error?: string | null;
  /**
   * `STORAGE_PUBLIC_URL` is set on the api, so a public upload is allowed. With it false
   * the visibility control says why it is disabled instead of failing on submit.
   */
  publicUploads?: boolean;
  /** `STORAGE_IMAGE_TRANSFORMS`, passed down so the avatar below can resize on the CDN. */
  imageTransforms?: boolean;
  /** The per-file cap the picker checks. The api checks `STORAGE_MAX_UPLOAD_BYTES` again. */
  maxBytes?: number;
  /** The most files one submit takes. */
  maxFiles?: number;
}

export function FileUploads({
  files,
  onUpload,
  onDownload,
  onDelete,
  busy = false,
  error = null,
  publicUploads = false,
  imageTransforms = false,
  maxBytes = DEFAULT_MAX_BYTES,
  maxFiles = 10,
}: FileUploadsProps) {
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [picked, setPicked] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const locked = busy || sending;

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (picked.length === 0 || locked) {
      return;
    }
    setSending(true);
    let remaining = picked;
    try {
      // One at a time, in order. A finished file leaves the list; a failure leaves the
      // file it stopped on and every file after it, ready to send again.
      for (const file of picked) {
        // oxlint-disable-next-line no-await-in-loop -- the uploads run in order on purpose
        await onUpload(file, visibility);
        remaining = remaining.slice(1);
        setPicked(remaining);
      }
    } catch {
      // The app reports the failure through `error`.
    }
    setSending(false);
  }

  // The file going up shows as started. The api's PUT gives no byte count, so there is
  // no percentage to show beyond "on its way".
  const progress = picked.map((_, index) =>
    sending && index === 0 ? 0 : undefined
  );

  const images = files.filter(
    (file) => file.url !== undefined && file.contentType.startsWith("image/")
  );

  return (
    <div className="grid gap-6">
      {typeof error === "string" && error.length > 0 ? (
        <p
          role="alert"
          className="border-destructive/40 text-destructive rounded-lg border px-3 py-2 text-sm"
        >
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Upload a file</CardTitle>
          <CardDescription>
            A private file is served through a short-lived signed link. A public
            one gets a stable URL a CDN can cache, and that choice cannot be
            changed afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              void submit(event);
            }}
            className="grid gap-4 sm:max-w-md"
          >
            <div className="grid min-w-0 gap-2">
              <span className="text-sm font-medium">Files</span>
              <FileDrop
                id="file-uploads-files"
                multiple
                files={picked}
                onFilesChange={setPicked}
                accept={[]}
                maxBytes={maxBytes}
                maxFiles={maxFiles}
                progress={progress}
                disabled={locked}
                labels={{
                  ...dropLabels,
                  hint: interpolate(dropLabels.hint, {
                    max: maxFiles,
                    size: Math.round(maxBytes / 1024 / 1024),
                  }),
                }}
              />
            </div>

            <fieldset className="grid gap-2">
              <legend className="text-sm font-medium">Visibility</legend>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="file-uploads-visibility"
                    value="private"
                    checked={visibility === "private"}
                    onChange={() => {
                      setVisibility("private");
                    }}
                    disabled={locked}
                  />
                  Private
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="file-uploads-visibility"
                    value="public"
                    checked={visibility === "public"}
                    onChange={() => {
                      setVisibility("public");
                    }}
                    disabled={locked || !publicUploads}
                  />
                  Public
                </label>
              </div>
              {publicUploads ? null : (
                <p className="text-muted-foreground text-sm">
                  Public uploads are off until STORAGE_PUBLIC_URL names the
                  origin that serves your bucket.
                </p>
              )}
            </fieldset>

            <Button type="submit" disabled={locked || picked.length === 0}>
              {locked
                ? "Uploading…"
                : picked.length > 1
                  ? `Upload ${picked.length} files`
                  : "Upload"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/*
        The worked caller for the image path. Every tile here is an ordinary public
        object: the api put its URL on the row, and `imageUrl` asks the CDN for a 96px
        square of it. With STORAGE_IMAGE_TRANSFORMS off the same URL renders at full size,
        which is why this panel needs no fallback of its own.
      */}
      {images.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Images</CardTitle>
            <CardDescription>
              Served straight from the bucket, resized on the way out when image
              transformations are enabled.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-wrap gap-3">
              {images.map((file) => (
                <li key={file.id}>
                  <img
                    src={imageUrl(
                      file.url ?? "",
                      { fit: "cover", height: 96, width: 96 },
                      imageTransforms
                    )}
                    alt={file.filename}
                    width={96}
                    height={96}
                    loading="lazy"
                    className="size-24 rounded-md object-cover"
                  />
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Files</CardTitle>
          <CardDescription>
            {files.length === 1 ? "1 file" : `${files.length} files`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Nothing uploaded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Visibility</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="font-medium">
                      {file.filename}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {file.contentType}
                    </TableCell>
                    <TableCell>{formatBytes(file.size)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          file.visibility === "public" ? "default" : "secondary"
                        }
                      >
                        {file.visibility}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {file.status}
                    </TableCell>
                    <TableCell className="space-x-2 text-right">
                      {file.url === undefined ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={busy || file.status !== "ready"}
                          onClick={() => {
                            onDownload(file.id);
                          }}
                        >
                          Download
                        </Button>
                      ) : (
                        <a
                          href={file.url}
                          rel="noreferrer"
                          target="_blank"
                          className={cn(
                            buttonVariants({ size: "sm", variant: "outline" })
                          )}
                        >
                          Open
                        </a>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          onDelete(file.id);
                        }}
                      >
                        Delete
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Bytes as the shortest readable unit. Display only — the row keeps the real number. */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}
