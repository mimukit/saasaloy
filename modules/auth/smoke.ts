// Smoke checks for auth (#187), run by `pnpm play:smoke` against a seeded playground.
import { pick } from "../../scripts/smoke.ts";
import type { SmokeScript } from "../../scripts/smoke.ts";

const smoke: SmokeScript = async (t) => {
  const superadmin = t.anon("client");
  const reply = await superadmin.signIn("superadmin@example.test");
  t.equal("superadmin signs in", 200, reply.status);
  t.equal(
    "superadmin has the superadmin role",
    "superadmin",
    pick(reply.body, "user.role")
  );

  const member = await t.as("client", "member@example.test");
  const session = await member.request("/auth/get-session");
  t.equal(
    "the session cookie names the member",
    "member@example.test",
    pick(session.body, "user.email")
  );

  const banned = await t.anon("client").signIn("banned@example.test");
  t.equal("a banned user is refused", 403, banned.status);
  t.equal("with BANNED_USER", "BANNED_USER", pick(banned.body, "code"));

  const wrong = await t
    .anon("client")
    .signIn("member@example.test", "not-the-password");
  t.equal("a wrong password is refused", 401, wrong.status);
};

export default smoke;
