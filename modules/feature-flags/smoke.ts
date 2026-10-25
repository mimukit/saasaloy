// Smoke checks for feature-flags (#187), run by `pnpm play:smoke` against a seeded
// playground.
import { pick } from "../../scripts/smoke.ts";
import type { SmokeScript } from "../../scripts/smoke.ts";

const smoke: SmokeScript = async (t) => {
  const anon = await t.anon("admin").request("/admin/flags");
  t.equal("GET /admin/flags needs an admin session", 401, anon.status);

  const superadmin = await t.as("admin", "superadmin@example.test");
  const reply = await superadmin.request("/admin/flags");
  t.equal("GET /admin/flags answers the superadmin", 200, reply.status);
  const flags = pick(reply.body, "flags");
  t.check(
    "it lists the seeded flags",
    Array.isArray(flags) && flags.some((flag) => pick(flag, "hasRow") === true),
    `got ${JSON.stringify(flags)?.slice(0, 80)}`
  );
};

export default smoke;
