import { useEffect, useMemo, useState } from "react";
import { FileTextIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import { useDropzone } from "react-dropzone";
import type { FileRejection } from "react-dropzone";

import { Button } from "@repo/ui/components/button";
import {
  fileDropError,
  fileSize,
  uploadedMegabytes,
} from "@repo/ui/lib/file-drop";
import type { FileDropErrorCode } from "@repo/ui/lib/file-drop";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// A file picker people can tap or drop files on. The `storage` module ships it.
//
// Single mode (the default) holds one file: a dashed zone, then one row with a
// thumbnail, the name, the size and a remove button. Multiple mode holds up to
// `maxFiles`: the zone while the list is empty, then the rows and a one-line "add more"
// bar under them, which takes drops too.
//
// It checks each file with fileDropError() from ../lib/file-drop.ts as it is picked, so
// a refused file never reaches the caller, and the reason stays on screen until the
// next pick. **It does no IO.** Uploading is the caller's job: it passes `progress`
// while a file is on its way. It holds no copy either; every string is a label prop.
// The server checks again, so treat the type and size checks here as a courtesy.

export interface FileDropLabels {
  /** "Drop a file here, or {action}". */
  prompt: string;
  /** The underlined part of the prompt: "choose one". */
  action: string;
  /** Shown while a file is dragged over the zone. */
  dropActive: string;
  /** The type and size limits under the prompt. */
  hint: string;
  /** Multiple mode: the bar under the list, "Add more, or drop files here". */
  addMore?: string;
  /** "{size} KB" and "{size} MB". */
  sizeKb: string;
  sizeMb: string;
  /** "Remove {name}". */
  remove: string;
  /** "{done} of {total} MB · {percent}%". */
  progress: string;
  /** "{name}". */
  badType: string;
  /** "{name}". */
  empty: string;
  /** "{name}", "{max}" in megabytes. */
  tooLarge: string;
  /** Multiple mode: "{name}", "{max}" files. */
  tooMany?: string;
}

interface FileDropBase {
  id?: string;
  /** MIME types, such as `image/jpeg`. An empty list takes every type. */
  accept: readonly string[];
  /** The cap per file, in bytes. */
  maxBytes: number;
  labels: FileDropLabels;
  disabled?: boolean;
  /** A refusal the caller found after the pick. It replaces the zone's own. */
  error?: string;
  "aria-describedby"?: string;
  className?: string;
}

export interface SingleFileDropProps extends FileDropBase {
  multiple?: false;
  file?: File;
  onFileChange: (file?: File) => void;
  /** 0 to 100 while the caller uploads the file; leave unset otherwise. */
  progress?: number;
  /** The size of what goes up, when the caller shrank the file first. */
  uploadBytes?: number;
}

export interface MultipleFileDropProps extends FileDropBase {
  multiple: true;
  files: readonly File[];
  onFilesChange: (files: File[]) => void;
  /** The most files the list holds. */
  maxFiles: number;
  /** One entry per file: 0 to 100 while it uploads, `undefined` otherwise. */
  progress?: readonly (number | undefined)[];
}

export type FileDropProps = SingleFileDropProps | MultipleFileDropProps;

function sizeText(bytes: number, labels: FileDropLabels): string {
  const { unit, size } = fileSize(bytes);
  return interpolate(unit === "kb" ? labels.sizeKb : labels.sizeMb, { size });
}

function errorText(
  code: FileDropErrorCode,
  name: string,
  maxBytes: number,
  maxFiles: number,
  labels: FileDropLabels
): string {
  if (code === "tooMany") {
    return interpolate(labels.tooMany ?? "", { name, max: maxFiles });
  }
  if (code === "tooLarge") {
    return interpolate(labels.tooLarge, {
      name,
      max: Math.round(maxBytes / 1024 / 1024),
    });
  }
  return interpolate(code === "empty" ? labels.empty : labels.badType, {
    name,
  });
}

function Thumbnail({ file }: { file: File }) {
  const isImage = file.type.startsWith("image/");
  const url = useMemo(
    () => (isImage ? URL.createObjectURL(file) : null),
    [file, isImage]
  );

  // Free the preview when the row goes.
  useEffect(
    () => () => {
      if (url !== null) {
        URL.revokeObjectURL(url);
      }
    },
    [url]
  );

  if (url === null) {
    return (
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-lg"
      >
        <FileTextIcon className="size-5" />
      </span>
    );
  }
  return (
    <img
      src={url}
      alt=""
      className="bg-muted size-14 shrink-0 rounded-lg object-cover"
    />
  );
}

function FileRow({
  file,
  progress,
  uploadBytes,
  labels,
  disabled,
  onRemove,
}: {
  file: File;
  progress?: number;
  uploadBytes?: number;
  labels: FileDropLabels;
  disabled: boolean;
  onRemove: () => void;
}) {
  const uploading = progress !== undefined;
  return (
    <div className="flex items-center gap-3 rounded-xl border p-2">
      <Thumbnail file={file} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {file.name}
        </span>
        <span className="text-muted-foreground block text-sm">
          {uploading
            ? interpolate(labels.progress, {
                ...uploadedMegabytes(uploadBytes ?? file.size, progress),
                percent: Math.round(progress),
              })
            : sizeText(file.size, labels)}
        </span>
        {uploading && (
          <span
            role="progressbar"
            aria-label={file.name}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            className="bg-muted mt-1.5 block h-1.5 overflow-hidden rounded-full"
          >
            <span
              className="bg-primary block h-full rounded-full transition-[width] motion-reduce:transition-none"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </span>
        )}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-lg"
        className="size-11 shrink-0"
        aria-label={interpolate(labels.remove, { name: file.name })}
        disabled={disabled || uploading}
        onClick={onRemove}
      >
        <XIcon />
      </Button>
    </div>
  );
}

export function FileDrop(props: FileDropProps) {
  const {
    id,
    accept,
    maxBytes,
    labels,
    disabled = false,
    error,
    "aria-describedby": describedBy,
    className,
  } = props;
  const [refusal, setRefusal] = useState<string | null>(null);
  const shownError = error ?? refusal;

  const files: readonly File[] =
    props.multiple === true
      ? props.files
      : props.file === undefined
        ? []
        : [props.file];
  const maxFiles = props.multiple === true ? props.maxFiles : 1;
  const uploading =
    props.multiple === true
      ? (props.progress ?? []).some((value) => value !== undefined)
      : props.progress !== undefined;

  function pick(accepted: File[], rejected: FileRejection[]) {
    const picked = [...accepted, ...rejected.map((entry) => entry.file)];
    const [file] = picked;
    if (file === undefined) {
      return;
    }
    if (props.multiple !== true) {
      const code = fileDropError(file, accept, maxBytes);
      if (code !== null) {
        setRefusal(errorText(code, file.name, maxBytes, 1, labels));
        return;
      }
      setRefusal(null);
      props.onFileChange(file);
      return;
    }
    // Take files in order until one is refused, so the reason names the first file
    // that did not make it and every file before it is kept.
    const next = [...props.files];
    let reason: string | null = null;
    for (const candidate of picked) {
      const code = fileDropError(
        candidate,
        accept,
        maxBytes,
        next.length,
        maxFiles
      );
      if (code !== null) {
        reason = errorText(code, candidate.name, maxBytes, maxFiles, labels);
        break;
      }
      next.push(candidate);
    }
    setRefusal(reason);
    if (next.length !== props.files.length) {
      props.onFilesChange(next);
    }
  }

  function remove(index: number) {
    setRefusal(null);
    if (props.multiple === true) {
      props.onFilesChange(props.files.filter((_, at) => at !== index));
    } else {
      props.onFileChange();
    }
  }

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept:
      accept.length === 0
        ? undefined
        : Object.fromEntries(accept.map((type) => [type, []])),
    multiple: props.multiple === true,
    disabled: disabled || uploading,
    onDrop: pick,
  });

  const [promptStart, promptEnd = ""] = labels.prompt.split("{action}");
  const errorId = id === undefined ? undefined : `${id}-error`;
  const describedByIds =
    [describedBy, shownError === null ? undefined : errorId]
      .filter(Boolean)
      .join(" ") || undefined;
  const zoneProps = getRootProps({
    "aria-describedby": describedByIds,
    "aria-invalid": shownError !== null,
  });
  const input = <input {...getInputProps({ id })} />;
  const progressAt = (index: number) =>
    props.multiple === true ? props.progress?.[index] : props.progress;

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      {files.length === 0 ? (
        <div
          {...zoneProps}
          className={cn(
            "border-input flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors outline-none motion-reduce:transition-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
            isDragActive && "border-primary bg-primary/10",
            !isDragActive && shownError !== null && "border-destructive",
            disabled && "cursor-not-allowed opacity-50"
          )}
        >
          {input}
          <span
            aria-hidden="true"
            className={cn(
              "bg-muted text-muted-foreground flex size-11 items-center justify-center rounded-full transition-colors motion-reduce:transition-none",
              isDragActive && "bg-primary text-primary-foreground"
            )}
          >
            <UploadIcon className="size-5" />
          </span>
          <span className="text-[0.9375rem] font-semibold">
            {isDragActive ? (
              labels.dropActive
            ) : (
              <>
                {promptStart}
                <span className="underline underline-offset-4">
                  {labels.action}
                </span>
                {promptEnd}
              </>
            )}
          </span>
          <span className="text-muted-foreground text-sm">{labels.hint}</span>
        </div>
      ) : (
        <>
          {files.map((file, index) => (
            <FileRow
              // A name can repeat, so the position joins it in the key.
              key={`${index}-${file.name}`}
              file={file}
              progress={progressAt(index)}
              uploadBytes={
                props.multiple === true ? undefined : props.uploadBytes
              }
              labels={labels}
              disabled={disabled}
              onRemove={() => {
                remove(index);
              }}
            />
          ))}
          {props.multiple === true && (
            <div
              {...zoneProps}
              className={cn(
                "border-input flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-3 text-sm font-semibold transition-colors outline-none motion-reduce:transition-none",
                "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-3",
                isDragActive && "border-primary bg-primary/10",
                !isDragActive && shownError !== null && "border-destructive",
                (disabled || uploading) && "cursor-not-allowed opacity-50"
              )}
            >
              {input}
              <PlusIcon
                aria-hidden="true"
                className="text-muted-foreground size-5"
              />
              {isDragActive ? labels.dropActive : labels.addMore}
            </div>
          )}
        </>
      )}
      {shownError !== null && (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {shownError}
        </p>
      )}
    </div>
  );
}
