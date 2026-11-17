import { useQueryClient } from "@tanstack/react-query";
import { ImageIcon, XIcon } from "lucide-react";
import { useState } from "react";

// oxlint-disable-next-line no-restricted-imports -- FileDrop is the storage module's picker, and the shell set has no twin of it
import { FileDrop } from "@repo/ui/components/file-drop";
// oxlint-disable-next-line no-restricted-imports -- the type of the same FileDrop
import type { FileDropLabels } from "@repo/ui/components/file-drop";
import { Badge } from "@repo/ui/components/shell/badge";
import { Button } from "@repo/ui/components/shell/button";
import { toastManager } from "@repo/ui/components/shell/toast";

import { uploadImage } from "@admin/lib/cms-api";
import {
  addProductImage,
  refreshShop,
  removeProductImage,
  shopKeys,
} from "@admin/lib/shop-api";
import type { Product } from "@admin/lib/shop-api";

// A product's images: the storage module's FileDrop takes new ones, and each goes up in
// `file-uploads`' three steps (the same `uploadImage` the CMS uses) before the api links it
// to the product. The first image is the cover the lists and the shop show.

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const IMAGE_MAX_BYTES = 6_291_456;

const LABELS: FileDropLabels = {
  action: "choose files",
  addMore: "Add more, or drop images here",
  badType: "{name} is not a JPG, PNG or WebP image.",
  dropActive: "Drop them to add them",
  empty: "{name} is empty.",
  hint: "JPG, PNG or WebP, up to 6 MB each",
  progress: "{done} of {total} · {percent}%",
  prompt: "Drop images here, or {action}",
  remove: "Remove {name}",
  sizeKb: "{size} KB",
  sizeMb: "{size} MB",
  tooLarge: "{name} is over the {max} MB limit.",
  tooMany: "Add at most 10 images at once. {name} was not added.",
};

export function ProductImages({ product }: { product: Product }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  async function settle(next: Product) {
    queryClient.setQueryData(shopKeys.product(next.id), next);
    await refreshShop(queryClient);
  }

  async function upload(files: readonly File[]) {
    setBusy(true);
    let position = product.images.length;
    for (const file of files) {
      try {
        const picked = await uploadImage(file);
        await settle(
          await addProductImage(product.id, picked.objectId, position)
        );
        position += 1;
      } catch (error) {
        toastManager.add({
          description: error instanceof Error ? error.message : undefined,
          title: `${file.name} did not upload`,
          type: "error",
        });
        break;
      }
    }
    setPending([]);
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await settle(await removeProductImage(id));
      toastManager.add({ title: "Image removed", type: "success" });
    } catch (error) {
      toastManager.add({
        description: error instanceof Error ? error.message : undefined,
        title: "The image was not removed",
        type: "error",
      });
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <FileDrop
        id={`product-images-${product.id}`}
        multiple
        accept={IMAGE_TYPES}
        maxBytes={IMAGE_MAX_BYTES}
        maxFiles={10}
        labels={LABELS}
        files={pending}
        disabled={busy}
        className="w-full"
        onFilesChange={(files) => {
          setPending(files);
          if (files.length > 0) {
            void upload(files);
          }
        }}
      />
      {product.images.length === 0 ? null : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {product.images.map((image, index) => (
            <li
              key={image.id}
              className="border-border bg-muted relative aspect-square overflow-hidden rounded-lg border"
            >
              {image.url === null ? (
                <span
                  aria-hidden="true"
                  className="text-muted-foreground flex size-full items-center justify-center"
                >
                  <ImageIcon className="size-6" />
                </span>
              ) : (
                <img
                  src={image.url}
                  alt={image.alt}
                  className="size-full object-cover"
                />
              )}
              {index === 0 ? (
                <Badge variant="success" className="absolute top-2 left-2">
                  Cover
                </Badge>
              ) : null}
              <Button
                type="button"
                size="icon-xs"
                variant="outline"
                className="absolute top-2 right-2"
                aria-label={`Remove image ${String(index + 1)}`}
                disabled={busy}
                onClick={() => {
                  void remove(image.id);
                }}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
