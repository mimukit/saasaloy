import { createHash } from "node:crypto";

// Seed row ids. A row's id is a pure function of its table and its slug, so a slice that
// points at another slice's row computes the same id the other slice wrote:
//
//   userId: seedId("users", "superadmin"),
//
// No insert returns an id, no slug-to-id map is passed around, and every id is known before
// the first write. That last part is what lets the D1 runner send the whole seed as one
// atomic `db.batch`: D1 has no interactive transaction to read an id back inside.
//
// The id is a UUIDv5 (RFC 9562, section 5.5): the SHA-1 of a fixed namespace and the name
// `<table>:<slug>`, with the version and variant bits set. It is a valid UUID string, so it
// fits a `text` id column and a `uuid` one alike.
//
// The seed runs in Node only, never in a Worker, so `node:crypto` is safe here.

/** The namespace every seed id hashes under. Changing it changes every seeded id. */
const SEED_NAMESPACE = "6f1d3c2e-8a4b-5c7d-9e0f-1a2b3c4d5e6f";

function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll("-", "");
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) =>
    Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  );
}

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

/**
 * The id of the seed row `slug` in the table named `table` (the SQL name, such as
 * `"users"` or `"organization_roles"`).
 *
 * The same pair always gives the same id, on every machine and on both drivers.
 */
export function seedId(table: string, slug: string): string {
  const hash = createHash("sha1")
    .update(uuidBytes(SEED_NAMESPACE))
    .update(`${table}:${slug}`, "utf-8")
    .digest();
  const bytes = new Uint8Array(hash.subarray(0, 16));
  // Version 5 in the high nibble of byte 6, the RFC variant in the top bits of byte 8.
  // oxlint-disable-next-line no-bitwise -- RFC 9562 defines these fields as bits.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  // oxlint-disable-next-line no-bitwise -- as above.
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return formatUuid(bytes);
}
