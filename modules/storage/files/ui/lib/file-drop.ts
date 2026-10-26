// The checks behind the FileDrop primitive (../components/file-drop.tsx), kept free of
// React so they run in Node. The browser check is a convenience for the person picking
// the file: the server still caps the bytes and reads the signature, with `readLimited`
// and `sniffType` from `@repo/storage`.

export type FileDropErrorCode = "badType" | "empty" | "tooLarge" | "tooMany";

/**
 * Why a picked file is refused, or null when it may join the list.
 *
 * An empty `accept` list takes every type. `count` is how many files the list holds
 * already, and `maxFiles` the most it may hold; a single-file drop zone passes neither.
 */
export function fileDropError(
  file: Pick<File, "size" | "type">,
  accept: readonly string[],
  maxBytes: number,
  count = 0,
  maxFiles = Number.POSITIVE_INFINITY
): FileDropErrorCode | null {
  if (count >= maxFiles) {
    return "tooMany";
  }
  if (accept.length > 0 && !accept.includes(file.type)) {
    return "badType";
  }
  if (file.size === 0) {
    return "empty";
  }
  if (file.size > maxBytes) {
    return "tooLarge";
  }
  return null;
}

/** A size for a person to read: whole kilobytes under 1 MB, one decimal above it. */
export function fileSize(bytes: number): { unit: "kb" | "mb"; size: string } {
  const kb = bytes / 1024;
  if (kb < 1024) {
    return { unit: "kb", size: String(Math.max(1, Math.round(kb))) };
  }
  return { unit: "mb", size: (kb / 1024).toFixed(1) };
}

/** "2.1 of 3.4": the part of a file sent so far, in megabytes with one decimal. */
export function uploadedMegabytes(
  bytes: number,
  progress: number
): { done: string; total: string } {
  const total = bytes / 1024 / 1024;
  const share = Math.min(100, Math.max(0, progress)) / 100;
  return { done: (total * share).toFixed(1), total: total.toFixed(1) };
}
