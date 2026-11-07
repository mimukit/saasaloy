import { ImageIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import type { MediaValue } from "@repo/cms";
import type { PickedImage } from "@repo/cms/editor";
// oxlint-disable-next-line no-restricted-imports -- FileDrop is the storage module's picker, and the shell set has no twin of it
import { FileDrop } from "@repo/ui/components/file-drop";
// oxlint-disable-next-line no-restricted-imports -- the type of the same FileDrop
import type { FileDropLabels } from "@repo/ui/components/file-drop";
import { Button } from "@repo/ui/components/shell/button";
import { fileDropError } from "@repo/ui/lib/file-drop";
import { interpolate } from "@repo/ui/lib/interpolate";

import { pickFile } from "@admin/lib/cms-pick-file";

// One `media` field: the storage module's FileDrop while the field is empty or an image is
// on its way, and the stored image with Replace and Remove once it is set. FileDrop holds a
// picked `File` only, and a stored image is a `{ objectId, key }` pair with a URL, so this
// wrapper owns the second state. The upload itself is `file-uploads`' three-step one,
// passed in as `upload`.

/** The image types a post takes. The api checks the declared type again. */
export const IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

/** The per-image cap the picker checks. The api checks `STORAGE_MAX_UPLOAD_BYTES` again. */
export const IMAGE_MAX_BYTES = 10_485_760;

export const IMAGE_LABELS: FileDropLabels = {
  action: "choose one",
  addMore: "Replace, or drop an image here",
  badType: "{name} is not a PNG, JPEG, WebP or GIF image.",
  dropActive: "Drop it to use it",
  empty: "{name} is empty.",
  hint: "PNG, JPEG, WebP or GIF, up to 10 MB",
  progress: "{done} of {total} · {percent}%",
  prompt: "Drop an image here, or {action}",
  remove: "Remove {name}",
  sizeKb: "{size} KB",
  sizeMb: "{size} MB",
  tooLarge: "{name} is over the {max} MB limit.",
  tooMany: "Choose one image.",
};

/** The file name a storage key ends in. */
function nameOf(key: string): string {
  return key.slice(key.lastIndexOf("/") + 1) || key;
}

export function MediaPicker({
  id,
  label,
  value,
  url,
  upload,
  onChange,
  hint,
  disabled = false,
}: {
  id: string;
  /** The field's label, for the buttons' accessible names. */
  label: string;
  value: MediaValue | null;
  /** The stored image's public URL, when the api could build one. */
  url: string | undefined;
  upload: (file: File) => Promise<PickedImage>;
  onChange: (value: MediaValue | null, url?: string) => void;
  /** Replaces the FileDrop hint, e.g. what an empty field falls back to. */
  hint?: string;
  disabled?: boolean;
}) {
  const [pending, setPending] = useState<File | undefined>();
  const [refusal, setRefusal] = useState<string | undefined>();
  const labels = hint === undefined ? IMAGE_LABELS : { ...IMAGE_LABELS, hint };

  async function send(file: File) {
    setRefusal(undefined);
    setPending(file);
    try {
      const picked = await upload(file);
      onChange(
        {
          key: picked.key,
          objectId: picked.objectId,
          ...(value?.alt ? { alt: value.alt } : {}),
        },
        picked.url
      );
    } catch (error) {
      setRefusal(
        error instanceof Error ? error.message : "The image did not upload."
      );
    }
    setPending(undefined);
  }

  async function replace() {
    const file = await pickFile(IMAGE_TYPES);
    if (!file) {
      return;
    }
    const code = fileDropError(file, IMAGE_TYPES, IMAGE_MAX_BYTES);
    if (code !== null) {
      const message = {
        badType: IMAGE_LABELS.badType,
        empty: IMAGE_LABELS.empty,
        tooLarge: IMAGE_LABELS.tooLarge,
        tooMany: IMAGE_LABELS.tooMany ?? "",
      }[code];
      setRefusal(
        interpolate(message, {
          max: Math.round(IMAGE_MAX_BYTES / 1024 / 1024),
          name: file.name,
        })
      );
      return;
    }
    await send(file);
  }

  if (value && !pending) {
    const name = nameOf(value.key);
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <div className="border-border flex items-center gap-3 rounded-xl border p-2">
          {url ? (
            <img
              src={url}
              alt=""
              className="bg-muted size-14 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span
              aria-hidden="true"
              className="bg-muted text-muted-foreground flex size-14 shrink-0 items-center justify-center rounded-lg"
            >
              <ImageIcon className="size-5" />
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="block truncate text-sm font-semibold">{name}</span>
            <span className="flex items-center gap-1.5">
              <Button
                type="button"
                size="xs"
                variant="outline"
                aria-label={`Replace ${label.toLowerCase()}`}
                disabled={disabled}
                onClick={() => {
                  void replace();
                }}
              >
                <RefreshCwIcon />
                Replace
              </Button>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                aria-label={`Remove ${label.toLowerCase()}`}
                disabled={disabled}
                onClick={() => {
                  setRefusal(undefined);
                  onChange(null);
                }}
              >
                <Trash2Icon />
                Remove
              </Button>
            </span>
          </span>
        </div>
        {refusal === undefined ? null : (
          <p role="alert" className="text-destructive text-sm">
            {refusal}
          </p>
        )}
      </div>
    );
  }

  return (
    <FileDrop
      id={id}
      accept={IMAGE_TYPES}
      maxBytes={IMAGE_MAX_BYTES}
      labels={labels}
      file={pending}
      progress={pending ? 0 : undefined}
      disabled={disabled}
      error={refusal}
      className="w-full"
      onFileChange={(file) => {
        if (file) {
          void send(file);
        }
      }}
    />
  );
}
