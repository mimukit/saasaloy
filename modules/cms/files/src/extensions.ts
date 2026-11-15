// The one Tiptap extension list. The editor and the renderer both build their schema from
// it, so a node the editor can write is a node the renderer knows.
//
// Every package here is MIT. No Tiptap Pro extension is used, and none may be added without
// a licence decision (plan 0105, the Editor row).

import { Image } from "@tiptap/extension-image";
import { StarterKit } from "@tiptap/starter-kit";
import type { Extensions } from "@tiptap/core";
import { isSafeHref } from "./links";

/**
 * The image node, with the storage key and object id beside `src`. A stored body keeps the
 * key, never a finished URL, so a `STORAGE_PUBLIC_URL` change is a re-render
 * (`pnpm cms:rerender`) rather than a rewrite of every document.
 */
export const CmsImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      objectId: { default: null },
      storageKey: { default: null },
    };
  },
});

/** The extensions the editor runs and the renderer reads the schema from. */
export function cmsExtensions(): Extensions {
  return [
    StarterKit.configure({
      link: {
        autolink: true,
        defaultProtocol: "https",
        // The same rule the renderer applies. The editor refuses the link as it is typed or
        // pasted; the renderer drops whatever got past it.
        isAllowedUri: (url) => isSafeHref(url),
        openOnClick: false,
      },
    }),
    CmsImage,
  ];
}
