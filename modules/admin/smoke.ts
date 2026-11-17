// Smoke checks for admin (#187), run by `pnpm play:smoke` against a seeded playground.
import { pick } from "../../scripts/smoke.ts";
import type { SmokeScript } from "../../scripts/smoke.ts";

const smoke: SmokeScript = async (t) => {
  const superadmin = await t.as("admin", "superadmin@example.test");
  const users = await superadmin.request("/admin/users");
  t.equal("GET /admin/users answers the superadmin", 200, users.status);
  const listed = pick(users.body, "users");
  t.check(
    "it lists the seeded users",
    Array.isArray(listed) && listed.length >= 4,
    `got ${JSON.stringify(listed)?.slice(0, 80)}`
  );

  const member = await t.as("client", "member@example.test");
  const refused = await member.request("/admin/users");
  t.equal("a client session cannot reach /admin/users", 401, refused.status);
};

export default smoke;
