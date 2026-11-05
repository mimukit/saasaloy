// Copy a string to the clipboard, with a fallback for a page that is not a secure context.
//
// `navigator.clipboard` exists only on https and localhost. A dev server opened over a
// plain-http address (a remote dev box, a phone on the LAN) has none, so the fallback
// selects the text in a hidden textarea and runs the copy command instead.

/** Copy `text`. Rejects when neither the clipboard api nor the copy command takes it. */
export async function copyText(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard !== undefined) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Permission refused: try the fallback below.
    }
  }
  if (!copyWithTextarea(text)) {
    throw new Error("Copy failed: the browser refused the clipboard write.");
  }
}

function copyWithTextarea(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  // oxlint-disable-next-line unicorn/prefer-modern-dom-apis -- the Workers types apps/web loads redeclare `append` for HTMLRewriter elements, so `append(area)` fails its typecheck.
  document.body.insertAdjacentElement("beforeend", area);
  area.select();
  try {
    // oxlint-disable-next-line typescript/no-deprecated -- the only copy path outside a secure context, where navigator.clipboard is undefined.
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
  }
}
