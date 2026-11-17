// Smoke checks for subscription (#187), run by `pnpm play:smoke` against a seeded playground.
import { pick } from "../../scripts/smoke.ts";
import type { SmokeScript } from "../../scripts/smoke.ts";

const smoke: SmokeScript = async (t) => {
  const anon = await t.anon("client").request("/subscription/subscription");
  t.equal("GET /subscription/subscription needs a session", 401, anon.status);

  const member = await t.as("client", "member@example.test");
  const reply = await member.request("/subscription/subscription");
  t.equal("GET /subscription/subscription answers a member", 200, reply.status);
  t.check(
    "it names the current plan",
    typeof pick(reply.body, "plan.id") === "string"
  );
  const plans = pick(reply.body, "plans");
  t.check(
    "it lists the configured plans",
    Array.isArray(plans) && plans.length >= 2,
    `got ${JSON.stringify(plans)?.slice(0, 80)}`
  );
};

export default smoke;
