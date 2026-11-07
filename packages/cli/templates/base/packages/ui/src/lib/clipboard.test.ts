import { afterEach, describe, expect, it, vi } from "vitest";

import { copyText } from "./clipboard";

// `window`, `navigator` and `document` are plain stubs: the package has no DOM library.

function stubTextarea(copied: boolean | Error) {
  const area = {
    value: "",
    style: { position: "", opacity: "" },
    setAttribute: vi.fn<(name: string, value: string) => void>(),
    select: vi.fn<() => void>(),
    remove: vi.fn<() => void>(),
  };
  const document = {
    createElement: vi.fn<(tag: string) => typeof area>(() => area),
    body: {
      insertAdjacentElement:
        vi.fn<(where: string, node: typeof area) => void>(),
    },
    execCommand: vi.fn<(command: string) => boolean>(() => {
      if (copied instanceof Error) {
        throw copied;
      }
      return copied;
    }),
  };
  vi.stubGlobal("document", document);
  return { area, document };
}

function stubBrowser(
  isSecureContext: boolean,
  writeText?: (text: string) => Promise<void>
) {
  vi.stubGlobal("window", { isSecureContext });
  vi.stubGlobal(
    "navigator",
    writeText === undefined ? {} : { clipboard: { writeText } }
  );
}

describe(copyText, () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("writes through the clipboard api in a secure context", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>(async () => {
      // Copied.
    });
    stubBrowser(true, writeText);
    const { document } = stubTextarea(true);
    await expect(copyText("key_7K3M9QXD")).resolves.toBeUndefined();
    expect(writeText).toHaveBeenCalledWith("key_7K3M9QXD");
    expect(document.createElement).not.toHaveBeenCalled();
  });

  it("falls back to a hidden textarea outside a secure context", async () => {
    stubBrowser(false, vi.fn<(text: string) => Promise<void>>());
    const { area, document } = stubTextarea(true);
    await expect(copyText("key_7K3M9QXD")).resolves.toBeUndefined();
    expect(document.createElement).toHaveBeenCalledWith("textarea");
    expect(area.value).toBe("key_7K3M9QXD");
    expect(document.execCommand).toHaveBeenCalledWith("copy");
    expect(area.remove).toHaveBeenCalledOnce();
  });

  it("hides the fallback textarea, puts it in the page and selects it", async () => {
    stubBrowser(false, vi.fn<(text: string) => Promise<void>>());
    const { area, document } = stubTextarea(true);
    await copyText("key_7K3M9QXD");
    expect(area.setAttribute).toHaveBeenCalledWith("readonly", "");
    expect(area.style).toStrictEqual({ position: "fixed", opacity: "0" });
    expect(document.body.insertAdjacentElement).toHaveBeenCalledWith(
      "beforeend",
      area
    );
    expect(area.select).toHaveBeenCalledOnce();
  });

  it("falls back when the browser has no clipboard api", async () => {
    stubBrowser(true);
    const { document } = stubTextarea(true);
    await expect(copyText("x")).resolves.toBeUndefined();
    expect(document.execCommand).toHaveBeenCalledOnce();
  });

  it("falls back when the clipboard refuses the write", async () => {
    stubBrowser(true, async () => {
      throw new Error("NotAllowedError");
    });
    const { document } = stubTextarea(true);
    await expect(copyText("x")).resolves.toBeUndefined();
    expect(document.execCommand).toHaveBeenCalledOnce();
  });

  it("rejects when the copy command fails, and still removes the textarea", async () => {
    stubBrowser(false);
    const { area } = stubTextarea(false);
    await expect(copyText("x")).rejects.toThrow("Copy failed");
    expect(area.remove).toHaveBeenCalledOnce();
  });

  it("rejects when the copy command throws", async () => {
    stubBrowser(false);
    const { area } = stubTextarea(new Error("SecurityError"));
    await expect(copyText("x")).rejects.toThrow("Copy failed");
    expect(area.remove).toHaveBeenCalledOnce();
  });
});
