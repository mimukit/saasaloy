import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { EcommerceError } from "@repo/ecommerce";
import { users } from "../../schema/auth";
import { customerAddresses, orders } from "../../schema/ecommerce";
import { newId } from "./shared";
import type { Executor } from "./shared";

// Customers. There is no `customers` table and no customer role (plan 0106, "Customers"):
// a buyer is a client user with role `"user"`, and the admin Customers screen lists the
// users with at least one order. Every figure is computed from `orders` at read time.
//
//   orderCount    every order the user placed, whatever its status
//   totalSpent    the totals of the orders that were not cancelled or returned
//   codRefusals   the COD orders that came back `returned`
//
// The staff "New order" page (Q34) looks a phone up here, and a new phone becomes a client
// user with an unverified phone. That user's placeholder email comes from the caller,
// because the rule that builds it lives in `@repo/auth/phone-rules`, which `@repo/db` may
// not import.

/** A user as the shop's staff screens show one. */
export interface CustomerUser {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  phoneNumberVerified: boolean;
  role: string | null;
  createdAt: Date;
}

/** The figures computed from a user's orders. */
export interface CustomerStats {
  orderCount: number;
  totalSpent: number;
  codRefusals: number;
  lastOrderAt: Date | null;
}

export type CustomerSummary = CustomerUser & CustomerStats;

export interface CustomerPage {
  customers: CustomerSummary[];
  page: number;
  pageCount: number;
  total: number;
}

export type CustomerAddressRow = typeof customerAddresses.$inferSelect;

const userColumns = {
  createdAt: users.createdAt,
  email: users.email,
  id: users.id,
  name: users.name,
  phoneNumber: users.phoneNumber,
  phoneNumberVerified: users.phoneNumberVerified,
  role: users.role,
};

const statColumns = {
  codRefusals: sql<number>`count(*) filter (where ${orders.paymentMethod} = 'cod' and ${orders.status} = 'returned')::int`,
  lastOrderAt: sql<Date | null>`max(${orders.createdAt})`,
  orderCount: sql<number>`count(*)::int`,
  totalSpent: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} not in ('cancelled', 'returned')), 0)::int`,
};

function toStats(row: {
  codRefusals: number;
  lastOrderAt: Date | string | null;
  orderCount: number;
  totalSpent: number;
}): CustomerStats {
  return {
    codRefusals: Number(row.codRefusals),
    lastOrderAt: row.lastOrderAt === null ? null : new Date(row.lastOrderAt),
    orderCount: Number(row.orderCount),
    totalSpent: Number(row.totalSpent),
  };
}

/** The user whose phone is `phone` (E.164), or null. */
export async function findUserByPhone(
  db: Executor,
  phone: string
): Promise<CustomerUser | null> {
  const [row] = await db
    .select(userColumns)
    .from(users)
    .where(eq(users.phoneNumber, phone));
  return row ?? null;
}

/**
 * A client user for a phone staff typed on the "New order" page (Q34): role `"user"`, the
 * typed name, and an unverified phone. The buyer verifies it later by signing in with a
 * code. Throws `conflict` when the phone or the email already belongs to someone.
 */
export async function createPhoneCustomer(
  db: Executor,
  input: { phone: string; name: string; email: string }
): Promise<CustomerUser> {
  try {
    const [row] = await db
      .insert(users)
      .values({
        email: input.email,
        emailVerified: false,
        id: newId(),
        name: input.name,
        phoneNumber: input.phone,
        phoneNumberVerified: false,
        role: "user",
      })
      .returning(userColumns);
    return row as CustomerUser;
  } catch (error) {
    const text = String((error as { cause?: unknown }).cause ?? error);
    if (text.includes("duplicate key") || text.includes("unique constraint")) {
      throw new EcommerceError(
        "conflict",
        `An account already uses ${input.phone} or its email.`
      );
    }
    throw error;
  }
}

/**
 * A page of the users with at least one order, the most recent buyer first. `query`
 * matches the name, the email or the phone.
 */
export async function listCustomers(
  db: Executor,
  input: { page?: number; pageSize: number; query?: string }
): Promise<CustomerPage> {
  const page = Math.max(1, input.page ?? 1);
  const term = input.query?.trim();
  const where = term
    ? or(
        ilike(users.name, `%${term}%`),
        ilike(users.email, `%${term}%`),
        ilike(users.phoneNumber, `%${term}%`)
      )
    : undefined;
  const buyers = db
    .selectDistinct({ userId: orders.userId })
    .from(orders)
    .as("buyers");
  const [totalRow] = await db
    .select({ n: count() })
    .from(buyers)
    .innerJoin(users, eq(users.id, buyers.userId))
    .where(where);
  const total = totalRow?.n ?? 0;
  const rows = await db
    .select({ ...userColumns, ...statColumns })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(where)
    .groupBy(users.id)
    .orderBy(desc(sql`max(${orders.createdAt})`), desc(users.id))
    .limit(input.pageSize)
    .offset((page - 1) * input.pageSize);
  return {
    customers: rows.map((row) => ({ ...row, ...toStats(row) })),
    page,
    pageCount: Math.max(1, Math.ceil(total / input.pageSize)),
    total,
  };
}

/** One user's figures. A user with no order has zero of each. */
export async function customerStats(
  db: Executor,
  userId: string
): Promise<CustomerStats> {
  const [row] = await db
    .select(statColumns)
    .from(orders)
    .where(eq(orders.userId, userId));
  return toStats(
    row ?? { codRefusals: 0, lastOrderAt: null, orderCount: 0, totalSpent: 0 }
  );
}

/** A user with their figures and saved addresses, or null for an unknown id. */
export async function getCustomer(
  db: Executor,
  userId: string
): Promise<(CustomerSummary & { addresses: CustomerAddressRow[] }) | null> {
  const [user] = await db
    .select(userColumns)
    .from(users)
    .where(eq(users.id, userId));
  if (!user) {
    return null;
  }
  const [stats, addresses] = await Promise.all([
    customerStats(db, userId),
    db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.userId, userId))
      .orderBy(
        desc(customerAddresses.isDefault),
        desc(customerAddresses.createdAt)
      ),
  ]);
  return { ...user, ...stats, addresses };
}

/** Save an address for a user. `isDefault` clears the flag on their other addresses. */
export async function saveAddress(
  db: Executor,
  userId: string,
  input: Omit<CustomerAddressRow, "id" | "userId" | "createdAt" | "updatedAt">
): Promise<CustomerAddressRow> {
  return db.transaction(async (tx) => {
    if (input.isDefault) {
      await tx
        .update(customerAddresses)
        .set({ isDefault: false })
        .where(eq(customerAddresses.userId, userId));
    }
    const [row] = await tx
      .insert(customerAddresses)
      .values({ ...input, id: newId(), userId })
      .returning();
    return row as CustomerAddressRow;
  });
}

/** One of the user's own saved addresses, or null. */
export async function getOwnAddress(
  db: Executor,
  userId: string,
  addressId: string
): Promise<CustomerAddressRow | null> {
  const [row] = await db
    .select()
    .from(customerAddresses)
    .where(
      and(
        eq(customerAddresses.id, addressId),
        eq(customerAddresses.userId, userId)
      )
    );
  return row ?? null;
}

/** The user's saved addresses, the default first. */
export async function listAddresses(
  db: Executor,
  userId: string
): Promise<CustomerAddressRow[]> {
  return db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.userId, userId))
    .orderBy(
      desc(customerAddresses.isDefault),
      desc(customerAddresses.createdAt)
    );
}

/** The names of the given users, for an order's history ("Confirmed by …"). */
export async function userNames(
  db: Executor,
  userIds: readonly string[]
): Promise<Map<string, string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}
