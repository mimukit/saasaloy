// Smoke checks for payment (#187), run by `pnpm play:smoke` against a seeded playground.
import { pick } from "../../scripts/smoke.ts";
import type { SmokeScript } from "../../scripts/smoke.ts";

const smoke: SmokeScript = async (t) => {
  const anon = await t.anon("admin").request("/admin/payment/payments");
  t.equal(
    "GET /admin/payment/payments needs an admin session",
    401,
    anon.status
  );

  const superadmin = await t.as("admin", "superadmin@example.test");
  const reply = await superadmin.request("/admin/payment/payments");
  t.equal(
    "GET /admin/payment/payments answers the superadmin",
    200,
    reply.status
  );
  const payments = pick(reply.body, "payments");
  t.check(
    "it lists the seeded payments",
    Array.isArray(payments) && payments.length > 0,
    `got ${JSON.stringify(payments)?.slice(0, 80)}`
  );
};

export default smoke;
