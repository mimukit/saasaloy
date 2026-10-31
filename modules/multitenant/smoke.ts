// Smoke checks for multitenant (#187), run by `pnpm play:smoke` against a seeded
// playground. They carry over the read-only half of scripts/qa-tenant-scoping.sh; the
// half that creates organizations by slug needs an empty database and stays there.
import { pick } from "../../scripts/smoke.ts";
import type { Session, SmokeScript } from "../../scripts/smoke.ts";

interface Organization {
  id: string;
  slug: string;
}

async function organizations(session: Session): Promise<Organization[]> {
  const reply = await session.request("/auth/organization/list");
  return Array.isArray(reply.body) ? (reply.body as Organization[]) : [];
}

const smoke: SmokeScript = async (t) => {
  const member = await t.as("client", "member@example.test");
  const none = await member.request("/tenant");
  t.equal("GET /tenant with no active organization is 403", 403, none.status);
  t.equal(
    "with the fixed message",
    "no active organization",
    pick(none.body, "error.message")
  );

  const orgs = await organizations(member);
  const [first] = orgs;
  t.check("the member belongs to an organization", first !== undefined);
  if (!first) {
    return;
  }
  await member.request("/auth/organization/set-active", {
    json: { organizationId: first.id },
  });
  const tenant = await member.request("/tenant");
  t.equal(
    "GET /tenant resolves the active organization",
    first.id,
    pick(tenant.body, "organizationId")
  );
  t.equal(
    "the principal is a member",
    "member",
    pick(tenant.body, "principal.kind")
  );

  const projects = await member.request("/projects");
  const rows = pick(projects.body, "projects");
  t.check(
    "GET /projects lists only the active organization's rows",
    Array.isArray(rows) &&
      rows.length > 0 &&
      rows.every((row) => pick(row, "organizationId") === first.id),
    `got ${JSON.stringify(rows)?.slice(0, 120)}`
  );

  const other = orgs.find((org) => org.id !== first.id);
  t.check("the seed holds a second organization", other !== undefined);
  if (!other) {
    return;
  }
  // The header is superadmin-only: a member is refused even for an organization it is in.
  const refused = await member.request("/tenant", {
    headers: { "x-organization-id": other.id },
  });
  t.equal("a member sending x-organization-id is 403", 403, refused.status);
};

export default smoke;
