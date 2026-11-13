// Open the browser's file chooser once and resolve with the picked file, or null when the
// person cancels. The rich-text editor's image tool and the media field's Replace button
// call it, so neither keeps a hidden input of its own in the page.
export function pickFile(accept: readonly string[]): Promise<File | null> {
  // oxlint-disable-next-line promise/avoid-new -- the file chooser reports through events, not a promise
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept.join(",");
    input.addEventListener(
      "change",
      () => {
        resolve(input.files?.[0] ?? null);
      },
      { once: true }
    );
    input.addEventListener(
      "cancel",
      () => {
        resolve(null);
      },
      { once: true }
    );
    input.click();
  });
}
