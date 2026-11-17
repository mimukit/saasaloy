import { asc, eq } from "drizzle-orm";
import { EcommerceError } from "@repo/ecommerce";
import { shippingZones } from "../../schema/ecommerce";
import { newId } from "./shared";
import type { Executor } from "./shared";

// Shipping zones: a flat rate per order, staff-managed (plan 0106, "Shipping in the MVP").
// Checkout offers the active zones; an order copies the zone's name and rate, so an edit
// or a delete here leaves every past order as it was.

export type ShippingZoneRow = typeof shippingZones.$inferSelect;

export interface ZoneInput {
  name: string;
  /** Minor units of the store currency. */
  rate: number;
  active: boolean;
  position: number;
}

/** Every zone, or only the active ones, in position order. */
export async function listZones(
  db: Executor,
  options: { activeOnly?: boolean } = {}
): Promise<ShippingZoneRow[]> {
  return db
    .select()
    .from(shippingZones)
    .where(options.activeOnly ? eq(shippingZones.active, true) : undefined)
    .orderBy(asc(shippingZones.position), asc(shippingZones.name));
}

export async function getZone(
  db: Executor,
  zoneId: string
): Promise<ShippingZoneRow | null> {
  const [row] = await db
    .select()
    .from(shippingZones)
    .where(eq(shippingZones.id, zoneId));
  return row ?? null;
}

/** Add a zone in the store currency. */
export async function createZone(
  db: Executor,
  input: ZoneInput & { currency: string }
): Promise<ShippingZoneRow> {
  const [row] = await db
    .insert(shippingZones)
    .values({ ...input, id: newId() })
    .returning();
  return row as ShippingZoneRow;
}

/** Edit a zone. Throws `not_found` for an unknown id. */
export async function updateZone(
  db: Executor,
  zoneId: string,
  patch: Partial<ZoneInput>
): Promise<ShippingZoneRow> {
  const [row] = await db
    .update(shippingZones)
    .set(patch)
    .where(eq(shippingZones.id, zoneId))
    .returning();
  if (!row) {
    throw new EcommerceError("not_found", `No zone ${zoneId}.`);
  }
  return row;
}

/**
 * Delete a zone. Past orders keep the copied name and rate; their `zone_id` goes null.
 * Throws `not_found` for an unknown id.
 */
export async function deleteZone(db: Executor, zoneId: string): Promise<void> {
  const deleted = await db
    .delete(shippingZones)
    .where(eq(shippingZones.id, zoneId))
    .returning({ id: shippingZones.id });
  if (deleted.length === 0) {
    throw new EcommerceError("not_found", `No zone ${zoneId}.`);
  }
}
