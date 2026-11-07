// Smoke checks for waitlist (#187), run by `pnpm play:smoke` against a seeded playground.
// Each run joins with a new address, so a second run on the same database still passes.
import type { SmokeScript } from "../../scripts/smoke.ts";

const smoke: SmokeScript = async (t) => {
  const email = `smoke-${Date.now()}@example.test`;
  const joined = await t
    .anon("client")
    .request("/waitlist", { json: { email } });
  t.equal("POST /waitlist takes a new address", 201, joined.status);
  const again = await t
    .anon("client")
    .request("/waitlist", { json: { email } });
  t.equal(
    "a repeated address answers the same, so it leaks nothing",
    201,
    again.status
  );
  const bad = await t
    .anon("client")
    .request("/waitlist", { json: { email: "not-an-email" } });
  t.equal("a malformed address is 400", 400, bad.status);
};

export default smoke;
