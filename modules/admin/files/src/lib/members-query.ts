import { queryOptions } from "@tanstack/react-query";

import { api } from "@admin/lib/api";

// The members list request: the admin group from `GET /admin/members`, split into active
// and removed members, plus who is asking. The Members screen reads it, and every write
// on that screen marks it stale. The row types come from the query's own return type, so
// a field the api drops lands as a typecheck failure here.
export const membersQuery = queryOptions({
  queryKey: ["admin", "members"],
  queryFn: async () => {
    const res = await api.admin.members.$get();
    if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
    return res.json();
  },
});

type MembersBody = Awaited<
  ReturnType<NonNullable<(typeof membersQuery)["queryFn"]>>
>;

/** A member who can sign in. */
export type ActiveMember = MembersBody["members"][number];

/** A removed member, with when and by whom. */
export type RemovedMember = MembersBody["removed"][number];

/** The signed-in member: their id and role. */
export type Viewer = MembersBody["me"];

/** The api's error message from a failed answer's body, or `fallback`. */
export async function failureMessage(
  res: { json: () => Promise<unknown> },
  fallback: string
): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown } };
    return typeof body.error?.message === "string"
      ? body.error.message
      : fallback;
  } catch {
    return fallback;
  }
}
